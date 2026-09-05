-- =============================================================================
-- PayRaksha — Payment State & Recovery Intelligence
-- 0001_payraksha_foundation.sql
--
-- Schema + Row Level Security + Auth triggers + state-transition contract +
-- server-side ingest/role functions.
--
-- Security model (read before editing):
--   * Supabase Auth is the ONLY identity source. tenant_id / user_id / role are
--     NEVER accepted from the browser. Every tenant-sensitive row carries a
--     tenant_id and RLS derives the caller's tenant role from auth.uid() via
--     SECURITY DEFINER helpers.
--   * Roles: viewer (read) < operator (ingest + operations) < admin (policies,
--     roles) < super_admin (platform).
--   * payments.status is NEVER written directly by clients. It only changes
--     through ingest_payment_event(), which validates each event against the
--     state_transition_contract and persists a state_transitions row.
--   * No anonymous read/write policies exist. Service-role keys never reach the
--     browser; the client only ever talks to PostgREST as anon/authenticated.
--
-- Idempotent: safe to re-run in the Supabase SQL editor.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Reference / contract tables (not tenant-sensitive)
-- ---------------------------------------------------------------------------

-- Explicit, persisted state-transition contract. Mirrors
-- src/lib/payment-states.ts TRANSITIONS 1:1. A missing (event_type, from_state)
-- pair means the transition is invalid.
create table if not exists public.state_transition_contract (
    event_type text not null,
    from_state text not null,
    to_state   text not null,
    note       text,
    primary key (event_type, from_state)
);

insert into public.state_transition_contract (event_type, from_state, to_state, note) values
    ('payment.created',        'FAILED',                'PENDING_REVIEW',        'Payment attempt registered'),
    ('payment.authorized',     'FAILED',                'AUTHORIZED',            'Recovery retry authorized'),
    ('payment.authorized',     'PENDING_REVIEW',        'AUTHORIZED',            'Funds hold confirmed'),
    ('payment.captured',       'FAILED',                'CAPTURED_AFTER_FAILURE','Capture succeeds after earlier failure'),
    ('payment.captured',       'AUTHORIZED',            'CAPTURED',              'Normal capture'),
    ('payment.captured',       'PENDING_REVIEW',        'CAPTURED',              'Instant capture'),
    ('payment.captured',       'RECOVERY_PENDING',      'CAPTURED_AFTER_FAILURE','Recovery capture succeeds'),
    ('payment.failed',         'AUTHORIZED',            'RECOVERY_PENDING',      'Authorized payment failed -> recoverable'),
    ('payment.failed',         'PENDING_REVIEW',        'FAILED',                'Attempt failed'),
    ('payment.failed',         'RECOVERY_PENDING',      'RECOVERY_PENDING',      'Idempotent provider retransmission'),
    ('payment.expired',        'AUTHORIZED',            'RECOVERY_PENDING',      'Auth window lapsed -> recoverable'),
    ('payment.expired',        'RECOVERY_PENDING',      'FAILED',                'Recovery window lapsed'),
    ('payment.expired',        'PENDING_REVIEW',        'FAILED',                'Attempt lapsed'),
    ('recovery.initiated',     'FAILED',                'RECOVERY_PENDING',      'Recovery started for failed payment'),
    ('recovery.initiated',     'AUTHORIZED',            'RECOVERY_PENDING',      'Auto-recovery started'),
    ('recovery.initiated',     'RECOVERY_PENDING',      'RECOVERY_PENDING',      'Idempotent: already in recovery'),
    ('recovery.cancelled',     'RECOVERY_PENDING',      'RECOVERY_CANCELLED',    'Operator cancels recovery'),
    ('review.queued',          'FAILED',                'PENDING_REVIEW',        'Failed payment queued for manual review'),
    ('review.queued',          'AUTHORIZED',            'PENDING_REVIEW',        'Flagged for manual review'),
    ('review.queued',          'RECOVERY_PENDING',      'PENDING_REVIEW',        'Recovery paused for review'),
    ('review.queued',          'RECOVERY_CANCELLED',    'PENDING_REVIEW',        'Re-opened for review'),
    ('review.approved',        'PENDING_REVIEW',        'RECOVERY_PENDING',      'Review approves recovery path'),
    ('review.rejected',        'PENDING_REVIEW',        'FAILED',                'Review rejects recovery'),
    ('system.escalated',       'RECOVERY_PENDING',      'ESCALATED',             'Auto-recovery exhausted -> escalation'),
    ('system.escalated',       'PENDING_REVIEW',        'ESCALATED',             'Escalated during review'),
    ('system.escalated',       'FAILED',                'ESCALATED',             'Failed payment escalated'),
    ('system.blocked',         'FAILED',                'BLOCKED',               'Risk rule blocks payment'),
    ('system.blocked',         'RECOVERY_PENDING',      'BLOCKED',               'Risk rule blocks recovery'),
    ('system.blocked',         'PENDING_REVIEW',        'BLOCKED',               'Risk rule blocks during review'),
    ('system.blocked',         'AUTHORIZED',            'BLOCKED',               'Risk rule blocks authorized hold'),
    ('system.released',        'BLOCKED',               'RECOVERY_PENDING',      'Super admin releases block'),
    ('system.released',        'ESCALATED',             'RECOVERY_PENDING',      'Escalation resolved -> back to recovery'),
    ('system.released',        'RECOVERY_CANCELLED',    'RECOVERY_PENDING',      'Re-opens recovery')
on conflict (event_type, from_state) do update
    set to_state = excluded.to_state, note = excluded.note;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

create table if not exists public.tenants (
    id         uuid primary key default gen_random_uuid(),
    slug       text not null unique,
    name       text not null,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (identity, user-global; membership lives in user_roles)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
    id         uuid primary key references auth.users (id) on delete cascade,
    email      text not null,
    full_name  text,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Roles / memberships
-- ---------------------------------------------------------------------------

create table if not exists public.user_roles (
    user_id    uuid not null references auth.users (id) on delete cascade,
    tenant_id  uuid not null references public.tenants (id) on delete cascade,
    role       text not null check (role in ('viewer', 'operator', 'admin', 'super_admin')),
    created_at timestamptz not null default now(),
    primary key (user_id, tenant_id)
);

-- ---------------------------------------------------------------------------
-- Payments — denormalized CURRENT state, maintained ONLY by ingest.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references public.tenants (id) on delete cascade,
    payment_ref  text not null,
    amount       numeric(14, 2) not null check (amount > 0),
    currency     text not null default 'USD',
    method       text,
    bank         text,
    psp          text,
    status       text not null default 'PENDING_REVIEW' check (status in (
                     'FAILED', 'RECOVERY_PENDING', 'PENDING_REVIEW', 'AUTHORIZED',
                     'CAPTURED', 'CAPTURED_AFTER_FAILURE', 'RECOVERY_CANCELLED',
                     'ESCALATED', 'BLOCKED'
                 )),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (tenant_id, payment_ref)
);

create index if not exists idx_payments_tenant_status on public.payments (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Payment events — the persisted source of truth.
-- Dedup contract: UNIQUE(tenant_id, provider_event_id).
-- ---------------------------------------------------------------------------

create table if not exists public.payment_events (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references public.tenants (id) on delete cascade,
    payment_id        uuid not null references public.payments (id) on delete cascade,
    provider_event_id text not null,
    event_type        text not null check (event_type in (
                          'payment.created', 'payment.authorized', 'payment.captured',
                          'payment.failed', 'payment.expired', 'recovery.initiated',
                          'recovery.cancelled', 'review.queued', 'review.approved',
                          'review.rejected', 'system.escalated', 'system.blocked',
                          'system.released'
                      )),
    occurred_at       timestamptz not null,
    raw_payload       jsonb not null default '{}'::jsonb,
    ingested_at       timestamptz not null default now(),
    unique (tenant_id, provider_event_id)
);

create index if not exists idx_payment_events_payment_time
    on public.payment_events (payment_id, occurred_at);

-- ---------------------------------------------------------------------------
-- State transitions — every applied or rejected transition, for audit/replay.
-- ---------------------------------------------------------------------------

create table if not exists public.state_transitions (
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null references public.tenants (id) on delete cascade,
    payment_id       uuid not null references public.payments (id) on delete cascade,
    payment_event_id uuid not null references public.payment_events (id) on delete cascade,
    from_state       text not null,
    to_state         text not null,
    valid            boolean not null default true,
    reason           text,
    created_at       timestamptz not null default now()
);

create index if not exists idx_state_transitions_payment
    on public.state_transitions (payment_id, created_at);

-- ---------------------------------------------------------------------------
-- Situations — detected anomalies tied to a payment (or systemic).
-- ---------------------------------------------------------------------------

create table if not exists public.situations (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants (id) on delete cascade,
    payment_id  uuid references public.payments (id) on delete cascade,
    kind        text not null check (kind in (
                    'duplicate_webhook', 'out_of_order_event', 'state_conflict',
                    'card_expired', 'insufficient_balance', 'late_capture',
                    'malformed_provider_response', 'systemic_psp_degradation',
                    'payment_blocked', 'recovery_pending', 'escalated_payment',
                    'review_required', 'unknown'
                )),
    severity    text not null default 'medium' check (severity in ('info', 'low', 'medium', 'high', 'critical')),
    status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
    summary     text,
    detected_at timestamptz not null default now(),
    resolved_at timestamptz
);

create index if not exists idx_situations_tenant_status
    on public.situations (tenant_id, status, detected_at);

-- ---------------------------------------------------------------------------
-- Recovery actions — executed / pending recovery steps.
-- ---------------------------------------------------------------------------

create table if not exists public.recovery_actions (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants (id) on delete cascade,
    payment_id      uuid not null references public.payments (id) on delete cascade,
    situation_id    uuid references public.situations (id) on delete set null,
    action          text not null check (action in (
                        'retry_capture', 'retry_authorization', 'reinitiate_recovery',
                        'cancel_recovery', 'escalate', 'approve_review',
                        'release_block', 'manual_review'
                    )),
    status          text not null default 'pending' check (status in ('pending', 'executed', 'skipped', 'failed')),
    value_recovered numeric(14, 2) not null default 0,
    executed_at     timestamptz,
    created_at      timestamptz not null default now()
);

create index if not exists idx_recovery_actions_tenant_status
    on public.recovery_actions (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Audit events — written ONLY server-side (never by a client insert).
-- ---------------------------------------------------------------------------

create table if not exists public.audit_events (
    id            uuid primary key default gen_random_uuid(),
    tenant_id     uuid not null references public.tenants (id) on delete cascade,
    actor_user_id uuid references auth.users (id) on delete set null,
    actor_role    text check (actor_role in ('viewer', 'operator', 'admin', 'super_admin')),
    action        text not null,
    entity_type   text,
    entity_id     text,
    details       jsonb not null default '{}'::jsonb,
    occurred_at   timestamptz not null default now()
);

create index if not exists idx_audit_events_tenant_time
    on public.audit_events (tenant_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Policies (recovery policy rules) and recovery-rate stats.
-- ---------------------------------------------------------------------------

create table if not exists public.policies (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants (id) on delete cascade,
    name        text not null,
    description text,
    enabled     boolean not null default true,
    conditions  jsonb not null default '{}'::jsonb,
    action      text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.recovery_rate_stats (
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null references public.tenants (id) on delete cascade,
    bucket_date      date not null,
    attempted        integer not null default 0,
    recovered        integer not null default 0,
    recovered_amount numeric(14, 2) not null default 0,
    rate             numeric(5, 4) not null default 0,
    unique (tenant_id, bucket_date)
);

-- ---------------------------------------------------------------------------
-- Grants. RLS (below) does the actual per-row enforcement.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.state_transition_contract to anon, authenticated;

grant select, insert, update, delete on
    public.tenants, public.profiles, public.user_roles, public.payments,
    public.payment_events, public.state_transitions, public.situations,
    public.recovery_actions, public.audit_events, public.policies,
    public.recovery_rate_stats
    to authenticated;

-- ---------------------------------------------------------------------------
-- RLS enablement + policies. NO anonymous access anywhere.
-- ---------------------------------------------------------------------------

alter table public.tenants              enable row level security;
alter table public.profiles             enable row level security;
alter table public.user_roles           enable row level security;
alter table public.payments             enable row level security;
alter table public.payment_events       enable row level security;
alter table public.state_transitions    enable row level security;
alter table public.situations           enable row level security;
alter table public.recovery_actions     enable row level security;
alter table public.audit_events         enable row level security;
alter table public.policies             enable row level security;
alter table public.recovery_rate_stats  enable row level security;

-- Security helper functions used by policies and RPCs.
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
    select case p_role
        when 'viewer'      then 1
        when 'operator'    then 2
        when 'admin'       then 3
        when 'super_admin' then 4
        else 0
    end;
$$;

create or replace function public.current_tenant_role(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_role text;
begin
    select role into v_role
      from public.user_roles
     where user_id = auth.uid() and tenant_id = p_tenant_id
     limit 1;
    return v_role;
end;
$$;

create or replace function public.has_role(p_tenant_id uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p_min_role in ('viewer', 'operator', 'admin', 'super_admin')
       and public.role_rank(public.current_tenant_role(p_tenant_id)) >= public.role_rank(p_min_role);
$$;

create or replace function public.shares_tenant(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
          from public.user_roles a
          join public.user_roles b on b.tenant_id = a.tenant_id
         where a.user_id = p_user_a and b.user_id = p_user_b
    );
$$;

-- Helpers are called from policy expressions by anon/authenticated, so they
-- need execute. They are read-only and derive everything from auth.uid().
grant execute on function public.role_rank(text) to anon, authenticated;
grant execute on function public.current_tenant_role(uuid) to anon, authenticated;
grant execute on function public.has_role(uuid, text) to anon, authenticated;
grant execute on function public.shares_tenant(uuid, uuid) to anon, authenticated;

-- tenants: visible to members
drop policy if exists "tenant select for members" on public.tenants;
create policy "tenant select for members" on public.tenants
    for select using (public.has_role(id, 'viewer'));

-- profiles: self, or shares a tenant (roster/audit display)
drop policy if exists "profile select own or shared tenant" on public.profiles;
create policy "profile select own or shared tenant" on public.profiles
    for select using (auth.uid() = id or public.shares_tenant(id, auth.uid()));

drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

-- user_roles: members see their own memberships; admins see the tenant roster.
-- All writes go through set_user_role().
drop policy if exists "role select own or admin roster" on public.user_roles;
create policy "role select own or admin roster" on public.user_roles
    for select using (auth.uid() = user_id or public.has_role(tenant_id, 'admin'));

-- Tenant data tables: viewer reads; writes only via server-side RPCs.
drop policy if exists "payments select viewer" on public.payments;
create policy "payments select viewer" on public.payments
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "payment_events select viewer" on public.payment_events;
create policy "payment_events select viewer" on public.payment_events
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "state_transitions select viewer" on public.state_transitions;
create policy "state_transitions select viewer" on public.state_transitions
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "situations select viewer" on public.situations;
create policy "situations select viewer" on public.situations
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "recovery_actions select viewer" on public.recovery_actions;
create policy "recovery_actions select viewer" on public.recovery_actions
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "audit_events select viewer" on public.audit_events;
create policy "audit_events select viewer" on public.audit_events
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "policies select viewer" on public.policies;
create policy "policies select viewer" on public.policies
    for select using (public.has_role(tenant_id, 'viewer'));

drop policy if exists "recovery_rate_stats select viewer" on public.recovery_rate_stats;
create policy "recovery_rate_stats select viewer" on public.recovery_rate_stats
    for select using (public.has_role(tenant_id, 'viewer'));

-- ---------------------------------------------------------------------------
-- Server-side RPCs (SECURITY DEFINER; identity always from auth.uid()).
-- ---------------------------------------------------------------------------

-- Internal audit writer used by RPCs.
create or replace function public.record_audit(
    p_tenant_id   uuid,
    p_action      text,
    p_entity_type text default null,
    p_entity_id   text default null,
    p_details     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
    values (
        p_tenant_id,
        auth.uid(),
        public.current_tenant_role(p_tenant_id),
        p_action,
        p_entity_type,
        p_entity_id,
        coalesce(p_details, '{}'::jsonb)
    );
end;
$$;

-- List the caller's tenants + role. The browser never supplies a tenant_id to
-- "choose" — the server derives membership from the Supabase session.
create or replace function public.list_my_tenants()
returns table (tenant_id uuid, slug text, name text, role text)
language sql
security definer
set search_path = public, pg_temp
as $$
    select t.id, t.slug, t.name, ur.role
      from public.user_roles ur
      join public.tenants t on t.id = ur.tenant_id
     where ur.user_id = auth.uid()
     order by ur.role desc, t.name;
$$;

-- Grant or change a role inside a tenant (admin+; only super_admin manages
-- super_admin). Never trusts a role claim from the client.
create or replace function public.set_user_role(
    p_tenant_id     uuid,
    p_target_user_id uuid,
    p_new_role      text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_actor_role text := public.current_tenant_role(p_tenant_id);
begin
    if auth.uid() is null then
        raise exception 'Not signed in' using errcode = '42501';
    end if;
    if v_actor_role is null or public.role_rank(v_actor_role) < public.role_rank('admin') then
        raise exception 'Admin or super_admin role required to manage roles' using errcode = '42501';
    end if;
    if p_new_role not in ('viewer', 'operator', 'admin', 'super_admin') then
        raise exception 'Unknown role: %', p_new_role;
    end if;
    if p_new_role = 'super_admin' and v_actor_role <> 'super_admin' then
        raise exception 'Only a super_admin can grant super_admin' using errcode = '42501';
    end if;

    -- The target must exist as a profile; never fabricate identity.
    if not exists (select 1 from auth.users where id = p_target_user_id) then
        raise exception 'Target user does not exist in Supabase Auth' using errcode = 'P0001';
    end if;
    insert into public.profiles (id, email)
    values (p_target_user_id, coalesce((select email from auth.users where id = p_target_user_id), 'unknown'))
    on conflict (id) do nothing;

    insert into public.user_roles (user_id, tenant_id, role)
    values (p_target_user_id, p_tenant_id, p_new_role)
    on conflict (user_id, tenant_id)
    do update set role = excluded.role;

    perform public.record_audit(
        p_tenant_id,
        'role.assigned',
        'user_roles',
        p_target_user_id::text,
        jsonb_build_object('target_user_id', p_target_user_id, 'role', p_new_role, 'by_user_id', auth.uid())
    );
    return p_new_role;
end;
$$;

-- Ingest a single provider payment event (operator+). This is the ONLY path
-- that changes payments.status. Steps: verify role -> ensure payment -> dedup
-- event on UNIQUE(tenant_id, provider_event_id) -> validate against the
-- transition contract -> persist state_transitions + audit. Invalid and
-- duplicate events are surfaced, never swallowed.
create or replace function public.ingest_payment_event(
    p_tenant_id          uuid,
    p_payment_ref        text,
    p_provider_event_id  text,
    p_event_type         text,
    p_occurred_at        timestamptz default now(),
    p_amount             numeric(14, 2) default null,
    p_currency           text default 'USD',
    p_method             text default null,
    p_bank               text default null,
    p_psp                text default null,
    p_error_code         text default null,
    p_error_description  text default null,
    p_raw_payload        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_payment_id      uuid;
    v_event_id        uuid;
    v_current_status  text;
    v_to_state        text;
    v_payload         jsonb := coalesce(p_raw_payload, '{}'::jsonb);
begin
    if auth.uid() is null then
        raise exception 'Not signed in' using errcode = '42501';
    end if;
    if not public.has_role(p_tenant_id, 'operator') then
        raise exception 'Operator or above role required to ingest events' using errcode = '42501';
    end if;
    if not exists (select 1 from public.state_transition_contract where event_type = p_event_type) then
        raise exception 'Unknown event type: %', p_event_type;
    end if;
    if p_payment_ref is null or p_provider_event_id is null then
        raise exception 'payment_ref and provider_event_id are required';
    end if;
    if p_amount is null or p_amount <= 0 then
        raise exception 'A positive amount is required when ingesting an event';
    end if;

    -- Ensure the payment shell exists WITHOUT touching its status.
    insert into public.payments (tenant_id, payment_ref, amount, currency, method, bank, psp)
    values (p_tenant_id, p_payment_ref, p_amount, coalesce(p_currency, 'USD'),
            p_method, p_bank, p_psp)
    on conflict (tenant_id, payment_ref) do update
        set method = coalesce(excluded.method, payments.method),
            bank   = coalesce(excluded.bank, payments.bank),
            psp    = coalesce(excluded.psp, payments.psp),
            updated_at = now()
    returning id, status into v_payment_id, v_current_status;

    v_payload := v_payload
        || jsonb_build_object(
               'amount', p_amount,
               'currency', p_currency,
               'method', p_method,
               'bank', p_bank,
               'psp', p_psp,
               'error_code', p_error_code,
               'error_description', p_error_description
           );

    -- Dedup contract: UNIQUE(tenant_id, provider_event_id). A retransmitted
    -- webhook is absorbed here and surfaced as an audit event.
    insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
    values (p_tenant_id, v_payment_id, p_provider_event_id, p_event_type, coalesce(p_occurred_at, now()), v_payload)
    on conflict (tenant_id, provider_event_id) do nothing
    returning id into v_event_id;

    if v_event_id is null then
        perform public.record_audit(
            p_tenant_id, 'webhook.duplicate_suppressed', 'payment_events',
            v_payment_id::text,
            jsonb_build_object('provider_event_id', p_provider_event_id, 'event_type', p_event_type)
        );
        return jsonb_build_object(
            'payment_id', v_payment_id,
            'status', v_current_status,
            'applied', false,
            'deduplicated', true,
            'payment_event_id', null
        );
    end if;

    -- Validate against the persisted transition contract.
    select to_state into v_to_state
      from public.state_transition_contract
     where event_type = p_event_type and from_state = v_current_status;

    if v_to_state is null then
        insert into public.state_transitions
            (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason)
        values (p_tenant_id, v_payment_id, v_event_id, v_current_status, v_current_status, false,
                'Invalid transition: ' || p_event_type || ' not allowed from ' || v_current_status);

        if not exists (
            select 1 from public.situations
             where tenant_id = p_tenant_id and payment_id = v_payment_id
               and kind = 'state_conflict' and status = 'open'
        ) then
            insert into public.situations (tenant_id, payment_id, kind, severity, status, summary)
            values (p_tenant_id, v_payment_id, 'state_conflict', 'high', 'open',
                    p_event_type || ' rejected from ' || v_current_status || ' — guardrail enforced');
        end if;

        perform public.record_audit(
            p_tenant_id, 'state.conflict_rejected', 'payments',
            v_payment_id::text,
            jsonb_build_object('event_type', p_event_type, 'from_state', v_current_status, 'provider_event_id', p_provider_event_id)
        );
        return jsonb_build_object(
            'payment_id', v_payment_id,
            'status', v_current_status,
            'applied', false,
            'conflict', true,
            'payment_event_id', v_event_id
        );
    end if;

    -- The only writer of payments.status in the whole system.
    update public.payments
       set status = v_to_state, updated_at = now()
     where id = v_payment_id;

    insert into public.state_transitions
        (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason)
    values (p_tenant_id, v_payment_id, v_event_id, v_current_status, v_to_state, true,
            p_event_type);

    perform public.record_audit(
        p_tenant_id, 'event.applied', 'payments',
        v_payment_id::text,
        jsonb_build_object('event_type', p_event_type, 'from_state', v_current_status,
                           'to_state', v_to_state, 'provider_event_id', p_provider_event_id)
    );

    return jsonb_build_object(
        'payment_id', v_payment_id,
        'payment_ref', p_payment_ref,
        'from_status', v_current_status,
        'status', v_to_state,
        'applied', true,
        'deduplicated', false,
        'conflict', false,
        'payment_event_id', v_event_id
    );
end;
$$;

grant execute on function public.record_audit(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.list_my_tenants() to authenticated;
grant execute on function public.set_user_role(uuid, uuid, text) to authenticated;
grant execute on function public.ingest_payment_event(uuid, text, text, text, timestamptz, numeric, text, text, text, text, text, text, jsonb) to authenticated;

-- Explicitly keep RPCs out of anon's hands (policies still need the helpers).
revoke execute on function public.record_audit(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.list_my_tenants() from public, anon;
revoke execute on function public.set_user_role(uuid, uuid, text) from public, anon;
revoke execute on function public.ingest_payment_event(uuid, text, text, text, timestamptz, numeric, text, text, text, text, text, text, jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- Auth triggers: every new Supabase Auth user gets a profile + a viewer role
-- in the demo tenant (if it exists). The org admin is later promoted with a
-- one-line UPDATE — the plaintext password never appears in code or SQL.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_demo_tenant uuid;
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
    )
    on conflict (id) do nothing;

    select id into v_demo_tenant from public.tenants where slug = 'demo';
    if v_demo_tenant is not null then
        insert into public.user_roles (user_id, tenant_id, role)
        values (new.id, v_demo_tenant, 'viewer')
        on conflict (user_id, tenant_id) do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();

commit;
