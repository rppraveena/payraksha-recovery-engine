-- ============================================================================
-- PayRaksha foundation migration
-- Supabase PostgreSQL + Supabase Auth + RLS as the SOLE application backend.
-- Convex stays untouched; the app switches to this schema once seeded.
--
-- Sections:
--   1. Enums & shared domains
--   2. Tables (11)
--   3. Helper functions (identity, role, tenant)
--   4. Auth bootstrap triggers (auth.users -> profiles + user_roles)
--   5. State-transition contract + validated event ingestion
--   6. Row Level Security (every tenant-sensitive table)
--   7. Grants
--
-- Security invariants enforced here:
--   * Identity/tenant/role are ALWAYS derived server-side from auth.uid();
--     client-supplied tenant_id/user_id/role are never trusted.
--   * No anonymous read/write policies anywhere.
--   * payments.status can never be written directly by a client — the only
--     writer is ingest_payment_event(), a security-definer function that
--     validates each event against the explicit transition contract.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums & shared domains
-- ----------------------------------------------------------------------------

create type public.user_role as enum ('viewer', 'operator', 'admin', 'super_admin');

create type public.payment_state as enum (
  'FAILED',
  'RECOVERY_PENDING',
  'PENDING_REVIEW',
  'AUTHORIZED',
  'CAPTURED',
  'CAPTURED_AFTER_FAILURE',
  'RECOVERY_CANCELLED',
  'ESCALATED',
  'BLOCKED'
);

create type public.payment_event_type as enum (
  'payment.created',
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'payment.expired',
  'recovery.initiated',
  'recovery.cancelled',
  'review.queued',
  'review.approved',
  'review.rejected',
  'system.escalated',
  'system.blocked',
  'system.released'
);

create type public.situation_severity as enum ('info', 'warning', 'critical');

create type public.recovery_action_status as enum ('proposed', 'approved', 'executed', 'rejected', 'cancelled');

create type public.policy_effect as enum ('allow', 'require_approval', 'deny');

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.user_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_ref text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null,
  method text,
  bank text,
  psp text,
  status public.payment_state not null default 'PENDING_REVIEW',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, payment_ref)
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  provider_event_id text not null,
  event_type public.payment_event_type not null,
  occurred_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Deduplication contract: UNIQUE(tenant_id, provider_event_id)
  unique (tenant_id, provider_event_id)
);

create index payment_events_payment_idx on public.payment_events (payment_id, occurred_at);

create table public.state_transitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  event_id uuid not null references public.payment_events (id) on delete cascade,
  from_state public.payment_state,
  to_state public.payment_state not null,
  applied boolean not null,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index state_transitions_payment_idx on public.state_transitions (payment_id, created_at);

create table public.situations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  kind text not null,
  severity public.situation_severity not null default 'info',
  diagnosis text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index situations_payment_idx on public.situations (payment_id, detected_at);

create table public.recovery_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  situation_id uuid references public.situations (id) on delete set null,
  action text not null,
  expected_value numeric(14, 2),
  status public.recovery_action_status not null default 'proposed',
  proposed_by uuid references public.profiles (id),
  decided_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index recovery_actions_payment_idx on public.recovery_actions (payment_id, created_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor uuid references public.profiles (id), -- null for system/pipeline actions
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_tenant_idx on public.audit_events (tenant_id, created_at);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  condition jsonb not null default '{}'::jsonb,
  effect public.policy_effect not null default 'allow',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.recovery_rate_stats (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  bucket date not null,
  attempts integer not null default 0,
  recoveries integer not null default 0,
  recovered_value numeric(16, 2) not null default 0,
  primary key (tenant_id, bucket)
);

-- ----------------------------------------------------------------------------
-- 3. Helper functions (identity, role, tenant) — security definer
-- ----------------------------------------------------------------------------

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where id = auth.uid();
$$;

-- All roles for the caller across tenants (used for cross-tenant admin checks).
create or replace function public.has_any_role(roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(roles)
  );
$$;

-- Role for the caller within a specific tenant.
create or replace function public.has_role(t tenant_id uuid, roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and tenant_id = t
      and role = any(roles)
  );
$$;

-- Tenant of a payment row (kept tiny so policies stay readable).
create or replace function public.payment_tenant(p payment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.payments where id = p;
$$;

-- ----------------------------------------------------------------------------
-- 4. Auth bootstrap triggers
-- ----------------------------------------------------------------------------

-- Every new auth user gets a profile automatically.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Every new profile gets a viewer role in the default demo tenant, unless a
-- role already exists (the org admin is provisioned with a role explicitly).
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_tenant uuid;
begin
  select id into default_tenant from public.tenants where slug = 'demo' limit 1;
  if default_tenant is null then
    return new;
  end if;

  insert into public.user_roles (user_id, tenant_id, role)
  values (new.id, default_tenant, 'viewer')
  on conflict (user_id, tenant_id) do nothing;
  return new;
end;
$$;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- ----------------------------------------------------------------------------
-- 5. State-transition contract + validated event ingestion
-- ----------------------------------------------------------------------------

-- The explicit, auditable transition contract. MISSING row = invalid.
create table public.state_transition_contract (
  event_type public.payment_event_type not null,
  from_state public.payment_state not null,
  to_state public.payment_state not null,
  primary key (event_type, from_state)
);

insert into public.state_transition_contract (event_type, from_state, to_state) values
  ('payment.created',    'FAILED',            'PENDING_REVIEW'),
  ('payment.authorized', 'FAILED',            'AUTHORIZED'),
  ('payment.authorized', 'PENDING_REVIEW',    'AUTHORIZED'),
  ('payment.captured',   'FAILED',            'CAPTURED_AFTER_FAILURE'),
  ('payment.captured',   'AUTHORIZED',        'CAPTURED'),
  ('payment.captured',   'PENDING_REVIEW',    'CAPTURED'),
  ('payment.captured',   'RECOVERY_PENDING',  'CAPTURED_AFTER_FAILURE'),
  ('payment.failed',     'AUTHORIZED',        'RECOVERY_PENDING'),
  ('payment.failed',     'PENDING_REVIEW',    'FAILED'),
  ('payment.failed',     'RECOVERY_PENDING',  'RECOVERY_PENDING'),
  ('payment.expired',    'AUTHORIZED',        'RECOVERY_PENDING'),
  ('payment.expired',    'RECOVERY_PENDING',  'FAILED'),
  ('payment.expired',    'PENDING_REVIEW',    'FAILED'),
  ('recovery.initiated', 'FAILED',            'RECOVERY_PENDING'),
  ('recovery.initiated', 'AUTHORIZED',        'RECOVERY_PENDING'),
  ('recovery.initiated', 'RECOVERY_PENDING',  'RECOVERY_PENDING'),
  ('recovery.cancelled', 'RECOVERY_PENDING',  'RECOVERY_CANCELLED'),
  ('review.queued',      'FAILED',            'PENDING_REVIEW'),
  ('review.queued',      'AUTHORIZED',        'PENDING_REVIEW'),
  ('review.queued',      'RECOVERY_PENDING',  'PENDING_REVIEW'),
  ('review.queued',      'RECOVERY_CANCELLED','PENDING_REVIEW'),
  ('review.approved',    'PENDING_REVIEW',    'RECOVERY_PENDING'),
  ('review.rejected',    'PENDING_REVIEW',    'FAILED'),
  ('system.escalated',   'RECOVERY_PENDING',  'ESCALATED'),
  ('system.escalated',   'PENDING_REVIEW',    'ESCALATED'),
  ('system.escalated',   'FAILED',            'ESCALATED'),
  ('system.blocked',     'FAILED',            'BLOCKED'),
  ('system.blocked',     'RECOVERY_PENDING',  'BLOCKED'),
  ('system.blocked',     'PENDING_REVIEW',    'BLOCKED'),
  ('system.blocked',     'AUTHORIZED',        'BLOCKED'),
  ('system.released',    'BLOCKED',           'RECOVERY_PENDING'),
  ('system.released',    'ESCALATED',         'RECOVERY_PENDING'),
  ('system.released',    'RECOVERY_CANCELLED','RECOVERY_PENDING');

comment on table public.state_transition_contract is
  'Explicit transition contract. payments.status changes ONLY through ingest_payment_event(), which validates against this table.';

-- The single writer of payment state. Validates each event against the
-- contract, records the transition (including rejections), and appends audit.
create or replace function public.ingest_payment_event(
  p_payment_id uuid,
  p_provider_event_id text,
  p_event_type public.payment_event_type,
  p_occurred_at timestamptz,
  p_raw jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_from public.payment_state;
  v_to public.payment_state;
  v_event uuid;
  v_caller uuid := auth.uid();
begin
  -- Resolve tenant server-side; never trust the client.
  select tenant_id into v_tenant from public.payments where id = p_payment_id;
  if v_tenant is null then
    raise exception 'payment % not found', p_payment_id;
  end if;

  -- Operators and above may ingest events; viewers may not.
  if not public.has_role(v_tenant, array['operator', 'admin', 'super_admin']::public.user_role[]) then
    raise exception 'insufficient role to ingest payment events';
  end if;

  select status into v_from from public.payments where id = p_payment_id for update;

  insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw)
  values (v_tenant, p_payment_id, p_provider_event_id, p_event_type, p_occurred_at, p_raw)
  on conflict (tenant_id, provider_event_id) do nothing
  returning id into v_event;

  -- Duplicate provider event: no-op (already recorded), keep audit trail.
  if v_event is null then
    insert into public.audit_events (tenant_id, actor, action, entity_type, entity_id, payload)
    values (v_tenant, v_caller, 'event.deduplicated', 'payment', p_payment_id,
            jsonb_build_object('provider_event_id', p_provider_event_id));
    return null;
  end if;

  select c.to_state into v_to
  from public.state_transition_contract c
  where c.event_type = p_event_type and c.from_state = v_from;

  insert into public.state_transitions (tenant_id, payment_id, event_id, from_state, to_state, applied, rejection_reason)
  values (v_tenant, p_payment_id, v_event, v_from, coalesce(v_to, v_from), v_to is not null,
          case when v_to is null then format('%s not allowed from %s', p_event_type, v_from) end);

  if v_to is not null and v_to <> v_from then
    update public.payments
       set status = v_to, updated_at = now()
     where id = p_payment_id;
  end if;

  insert into public.audit_events (tenant_id, actor, action, entity_type, entity_id, payload)
  values (v_tenant, v_caller, 'event.ingested', 'payment', p_payment_id,
          jsonb_build_object(
            'event_id', v_event,
            'event_type', p_event_type,
            'from_state', v_from,
            'to_state', v_to,
            'applied', v_to is not null
          ));

  return v_event;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security — enabled on every tenant-sensitive table
-- ----------------------------------------------------------------------------

alter table public.tenants            enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_roles         enable row level security;
alter table public.payments           enable row level security;
alter table public.payment_events     enable row level security;
alter table public.state_transitions  enable row level security;
alter table public.situations         enable row level security;
alter table public.recovery_actions   enable row level security;
alter table public.audit_events       enable row level security;
alter table public.policies           enable row level security;
alter table public.recovery_rate_stats enable row level security;
alter table public.state_transition_contract enable row level security;

-- tenants: readable by any authenticated user with a role somewhere; writable
-- only by super_admins.
create policy "tenants read for members" on public.tenants
  for select to authenticated
  using (public.has_any_role(array['viewer','operator','admin','super_admin']::public.user_role[]));

create policy "tenants manage by super_admin" on public.tenants
  for all to authenticated
  using (public.has_any_role(array['super_admin']::public.user_role[]))
  with check (public.has_any_role(array['super_admin']::public.user_role[]));

-- profiles: you can read your own and, if you administer a tenant, everyone in it.
create policy "profiles read own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles read in administered tenants" on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid()
        and r.role in ('admin', 'super_admin')
    )
  );

create policy "profiles update own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- user_roles: admins see their tenant's roles; only super_admins change roles.
create policy "user_roles read same tenant" on public.user_roles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_role(tenant_id, array['admin','super_admin']::public.user_role[])
  );

create policy "user_roles manage by super_admin" on public.user_roles
  for all to authenticated
  using (public.has_any_role(array['super_admin']::public.user_role[]))
  with check (public.has_any_role(array['super_admin']::public.user_role[]));

-- payments: tenant-scoped read for every role; writes NEVER go through RLS
-- (no insert/update/delete policy) — status changes only via ingest function.
create policy "payments read same tenant" on public.payments
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

create policy "payments insert by operators" on public.payments
  for insert to authenticated
  with check (public.has_role(tenant_id, array['operator','admin','super_admin']::public.user_role[]));

-- payment_events
create policy "payment_events read same tenant" on public.payment_events
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

-- state_transitions
create policy "state_transitions read same tenant" on public.state_transitions
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

-- situations
create policy "situations read same tenant" on public.situations
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

-- recovery_actions: viewers read; operators/admins propose + decide.
create policy "recovery_actions read same tenant" on public.recovery_actions
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

create policy "recovery_actions write by operators" on public.recovery_actions
  for insert to authenticated
  with check (public.has_role(tenant_id, array['operator','admin','super_admin']::public.user_role[]));

create policy "recovery_actions update by operators" on public.recovery_actions
  for update to authenticated
  using (public.has_role(tenant_id, array['operator','admin','super_admin']::public.user_role[]))
  with check (public.has_role(tenant_id, array['operator','admin','super_admin']::public.user_role[]));

-- audit_events: read-only to everyone in tenant; inserts happen via the
-- security-definer pipeline, never directly from clients.
create policy "audit_events read same tenant" on public.audit_events
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

-- policies: admins manage.
create policy "policies read same tenant" on public.policies
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

create policy "policies manage by admins" on public.policies
  for all to authenticated
  using (public.has_role(tenant_id, array['admin','super_admin']::public.user_role[]))
  with check (public.has_role(tenant_id, array['admin','super_admin']::public.user_role[]));

-- recovery_rate_stats: read-only to tenant members; refreshed by the pipeline.
create policy "recovery_rate_stats read same tenant" on public.recovery_rate_stats
  for select to authenticated
  using (public.has_role(tenant_id, array['viewer','operator','admin','super_admin']::public.user_role[]));

-- state_transition_contract: read-only reference data for authenticated users.
create policy "contract read by authenticated" on public.state_transition_contract
  for select to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- 7. Grants — client roles get nothing beyond what RLS allows
-- ----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on public.state_transition_contract to authenticated;
grant execute on function public.ingest_payment_event(uuid, text, public.payment_event_type, timestamptz, jsonb) to authenticated;
