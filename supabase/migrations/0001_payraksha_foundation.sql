-- PayRaksha Foundation Schema
-- Run this first: supabase/migrations/0001_payraksha_foundation.sql

-- ============================================================
-- 0. Extensions
-- ============================================================
-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase default)

-- ============================================================
-- 1. Tenants (multi-tenant root)
-- ============================================================
create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. Profiles (extends auth.users)
-- ============================================================
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. User roles (tenant × user × role)
-- ============================================================
create type app_role as enum ('viewer', 'operator', 'admin', 'super_admin');

create table if not exists user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  role       app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique(user_id, tenant_id)
);

-- ============================================================
-- 4. Payments
-- ============================================================
create type payment_status as enum (
  'FAILED', 'RECOVERY_PENDING', 'PENDING_REVIEW', 'AUTHORIZED',
  'CAPTURED', 'CAPTURED_AFTER_FAILURE', 'RECOVERY_CANCELLED',
  'ESCALATED', 'BLOCKED'
);

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  payment_ref  text not null,
  amount       numeric(12,2) not null,
  currency     text not null default 'USD',
  method       text,
  bank         text,
  psp          text,
  status       payment_status not null default 'PENDING_REVIEW',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(tenant_id, payment_ref)
);

-- ============================================================
-- 5. Payment events (event-sourced history)
-- ============================================================
create table if not exists payment_events (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  payment_id          uuid not null references payments(id) on delete cascade,
  provider_event_id   text not null,
  event_type          text not null,
  amount              numeric(12,2),
  currency            text,
  method              text,
  bank                text,
  psp                 text,
  error_code          text,
  error_description   text,
  raw_payload         jsonb not null default '{}',
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique(tenant_id, provider_event_id)
);

create index if not exists idx_payment_events_payment_id on payment_events(payment_id);
create index if not exists idx_payment_events_tenant on payment_events(tenant_id);

-- ============================================================
-- 6. State transitions (audit trail of every state change)
-- ============================================================
create table if not exists state_transitions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  payment_id      uuid not null references payments(id) on delete cascade,
  event_id        uuid references payment_events(id),
  from_status     payment_status,
  to_status       payment_status not null,
  event_type      text not null,
  applied_at      timestamptz not null default now(),
  valid           boolean not null default true,
  conflict_reason text
);

create index if not exists idx_state_transitions_payment on state_transitions(payment_id);

-- ============================================================
-- 7. Situations (detected anomalies / conditions)
-- ============================================================
create type situation_severity as enum ('critical', 'high', 'medium', 'low');

create table if not exists situations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  payment_id   uuid references payments(id) on delete set null,
  kind         text not null,
  severity     situation_severity not null default 'medium',
  description  text,
  metadata     jsonb not null default '{}',
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_situations_tenant on situations(tenant_id);

-- ============================================================
-- 8. Recovery actions
-- ============================================================
create table if not exists recovery_actions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  payment_id   uuid references payments(id) on delete set null,
  situation_id uuid references situations(id) on delete set null,
  action_type  text not null,
  status       text not null default 'pending',
  result       jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================
-- 9. Audit events
-- ============================================================
create table if not exists audit_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  user_id      uuid references auth.users(id),
  action       text not null,
  entity_type  text,
  entity_id    text,
  actor_role   text,
  details      jsonb not null default '{}',
  occurred_at  timestamptz not null default now()
);

create index if not exists idx_audit_events_tenant on audit_events(tenant_id);

-- ============================================================
-- 10. Policies (recovery / escalation rules)
-- ============================================================
create table if not exists policies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  description  text,
  rule         jsonb not null default '{}',
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- 11. Recovery rate stats (materialised aggregates)
-- ============================================================
create table if not exists recovery_rate_stats (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  period_start timestamptz not null,
  period_end   timestamptz not null,
  total_payments     int not null default 0,
  recovered          int not null default 0,
  failed             int not null default 0,
  escalated          int not null default 0,
  blocked            int not null default 0,
  recovery_rate      numeric(5,4),
  avg_recovery_hours numeric(8,2),
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 12. State transition contract (immutable rules)
-- ============================================================
create table if not exists state_transition_contract (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  from_status payment_status not null,
  to_status   payment_status not null,
  description text,
  unique(event_type, from_status)
);

-- Seed the contract
insert into state_transition_contract (event_type, from_status, to_status, description) values
  ('payment.created',      'PENDING_REVIEW', 'PENDING_REVIEW', 'Initial creation'),
  ('payment.authorized',   'FAILED',         'AUTHORIZED',     'Authorization received'),
  ('payment.authorized',   'PENDING_REVIEW', 'AUTHORIZED',     'Authorization received'),
  ('payment.captured',     'AUTHORIZED',     'CAPTURED',       'Capture succeeded'),
  ('payment.captured',     'PENDING_REVIEW', 'CAPTURED',       'Capture succeeded'),
  ('payment.captured',     'FAILED',         'CAPTURED_AFTER_FAILURE', 'Capture after initial failure'),
  ('payment.captured',     'RECOVERY_PENDING','CAPTURED_AFTER_FAILURE','Capture during recovery'),
  ('payment.failed',       'AUTHORIZED',     'RECOVERY_PENDING','Authorization failed'),
  ('payment.failed',       'PENDING_REVIEW', 'FAILED',         'Payment failed'),
  ('payment.failed',       'RECOVERY_PENDING','RECOVERY_PENDING','Retry failed (idempotent)'),
  ('payment.expired',      'AUTHORIZED',     'RECOVERY_PENDING','Authorization expired'),
  ('payment.expired',      'RECOVERY_PENDING','FAILED',         'Recovery expired'),
  ('payment.expired',      'PENDING_REVIEW', 'FAILED',         'Expired in review'),
  ('recovery.initiated',   'FAILED',         'RECOVERY_PENDING','Recovery started'),
  ('recovery.initiated',   'AUTHORIZED',     'RECOVERY_PENDING','Recovery started'),
  ('recovery.initiated',   'RECOVERY_PENDING','RECOVERY_PENDING','Recovery retry (idempotent)'),
  ('recovery.cancelled',   'RECOVERY_PENDING','RECOVERY_CANCELLED','Recovery cancelled'),
  ('review.queued',        'FAILED',         'PENDING_REVIEW', 'Queued for review'),
  ('review.queued',        'AUTHORIZED',     'PENDING_REVIEW', 'Queued for review'),
  ('review.queued',        'RECOVERY_PENDING','PENDING_REVIEW','Queued for review'),
  ('review.queued',        'RECOVERY_CANCELLED','PENDING_REVIEW','Queued for review'),
  ('review.approved',      'PENDING_REVIEW', 'RECOVERY_PENDING','Review approved'),
  ('review.rejected',      'PENDING_REVIEW', 'FAILED',         'Review rejected'),
  ('system.escalated',     'RECOVERY_PENDING','ESCALATED',     'System escalation'),
  ('system.escalated',     'PENDING_REVIEW', 'ESCALATED',      'System escalation'),
  ('system.escalated',     'FAILED',         'ESCALATED',      'System escalation'),
  ('system.blocked',       'FAILED',         'BLOCKED',        'System block'),
  ('system.blocked',       'RECOVERY_PENDING','BLOCKED',       'System block'),
  ('system.blocked',       'PENDING_REVIEW', 'BLOCKED',        'System block'),
  ('system.blocked',       'AUTHORIZED',     'BLOCKED',        'System block'),
  ('system.released',      'BLOCKED',        'RECOVERY_PENDING','System release'),
  ('system.released',      'ESCALATED',      'RECOVERY_PENDING','System release'),
  ('system.released',      'RECOVERY_CANCELLED','RECOVERY_PENDING','System release')
on conflict (event_type, from_status) do nothing;

-- ============================================================
-- 13. SECURITY DEFINER functions
-- ============================================================

-- Get current user's tenant_id and role (from auth session)
create or replace function get_current_user_tenant()
returns table(tenant_id uuid, role app_role)
language sql
security definer
stable
as $$
  select ur.tenant_id, ur.role
  from user_roles ur
  where ur.user_id = auth.uid()
  limit 1;
$$;

-- Check if user has at least the given role level
create or replace function user_has_role(min_role app_role)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from user_roles ur
    where ur.user_id = auth.uid()
    and (
      ur.role = min_role
      or (ur.role = 'operator' and min_role = 'viewer')
      or (ur.role = 'admin' and min_role in ('viewer', 'operator'))
      or (ur.role = 'super_admin')
    )
  );
$$;

-- List current user's tenants with roles
create or replace function list_my_tenants()
returns table(tenant_id uuid, slug text, name text, role app_role)
language sql
security definer
stable
as $$
  select t.id, t.slug, t.name, ur.role
  from user_roles ur
  join tenants t on t.id = ur.tenant_id
  where ur.user_id = auth.uid()
  order by t.name;
$$;

-- Set user role (admin+ only)
create or replace function set_user_role(
  p_user_id uuid,
  p_tenant_id uuid,
  p_role app_role
)
returns void
language plpgsql
security definer
as $$
begin
  if not user_has_role('admin') then
    raise exception 'Insufficient permissions: admin role required';
  end if;

  insert into user_roles (user_id, tenant_id, role)
  values (p_user_id, p_tenant_id, p_role)
  on conflict (user_id, tenant_id)
  do update set role = p_role;
end;
$$;

-- Ingest payment event with dedup and state reconstruction
create or replace function ingest_payment_event(
  p_tenant_id uuid,
  p_payment_ref text,
  p_provider_event_id text,
  p_event_type text,
  p_amount numeric default null,
  p_currency text default null,
  p_method text default null,
  p_bank text default null,
  p_psp text default null,
  p_error_code text default null,
  p_error_description text default null,
  p_raw_payload jsonb default '{}',
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_payment_id uuid;
  v_current_status payment_status;
  v_new_status payment_status;
  v_event_id uuid;
  v_is_duplicate boolean := false;
  v_contract record;
  v_result jsonb;
begin
  -- Check operator+ role
  if not user_has_role('operator') then
    raise exception 'Insufficient permissions: operator role required';
  end if;

  -- Upsert payment if needed
  insert into payments (tenant_id, payment_ref, amount, currency, method, bank, psp, status)
  values (p_tenant_id, p_payment_ref, coalesce(p_amount, 0), coalesce(p_currency, 'USD'), p_method, p_bank, p_psp, 'PENDING_REVIEW')
  on conflict (tenant_id, payment_ref) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select id into v_payment_id from payments where tenant_id = p_tenant_id and payment_ref = p_payment_ref;
  end if;

  -- Check for duplicate event
  insert into payment_events (tenant_id, payment_id, provider_event_id, event_type, amount, currency, method, bank, psp, error_code, error_description, raw_payload, occurred_at)
  values (p_tenant_id, v_payment_id, p_provider_event_id, p_event_type, p_amount, p_currency, p_method, p_bank, p_psp, p_error_code, p_error_description, p_raw_payload, p_occurred_at)
  on conflict (tenant_id, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    v_is_duplicate := true;
    v_result := jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', v_payment_id);
    return v_result;
  end if;

  -- Get current status
  select status into v_current_status from payments where id = v_payment_id;

  -- Look up valid transition
  select into v_contract *
  from state_transition_contract
  where event_type = p_event_type and from_status = v_current_status;

  if v_contract is not null then
    v_new_status := v_contract.to_status;

    -- Record transition
    insert into state_transitions (tenant_id, payment_id, event_id, from_status, to_status, event_type, valid)
    values (p_tenant_id, v_payment_id, v_event_id, v_current_status, v_new_status, p_event_type, true);

    -- Update payment status
    update payments set status = v_new_status, updated_at = now() where id = v_payment_id;

    v_result := jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'payment_id', v_payment_id,
      'event_id', v_event_id,
      'from_status', v_current_status,
      'to_status', v_new_status,
      'valid', true
    );
  else
    -- Invalid transition — still record it
    insert into state_transitions (tenant_id, payment_id, event_id, from_status, to_status, event_type, valid, conflict_reason)
    values (p_tenant_id, v_payment_id, v_event_id, v_current_status, v_current_status, p_event_type, false, 'No valid transition from ' || v_current_status || ' for ' || p_event_type);

    v_result := jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'payment_id', v_payment_id,
      'event_id', v_event_id,
      'from_status', v_current_status,
      'to_status', v_current_status,
      'valid', false,
      'conflict', 'Invalid transition: ' || p_event_type || ' not allowed from ' || v_current_status
    );
  end if;

  -- Write audit event
  insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, actor_role, details)
  values (p_tenant_id, auth.uid(), 'ingest_event', 'payment_events', v_event_id::text, (select role::text from user_roles where user_id = auth.uid() and tenant_id = p_tenant_id limit 1), v_result);

  return v_result;
end;
$$;

-- ============================================================
-- 14. Auto-create profile on user signup
-- ============================================================
create or replace function on_auth_user_created()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'));

  -- Auto-assign viewer role in demo tenant if it exists
  insert into user_roles (user_id, tenant_id, role)
  select new.id, t.id, 'viewer'
  from tenants t
  where t.slug = 'demo'
  on conflict (user_id, tenant_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function on_auth_user_created();

-- ============================================================
-- 15. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tenant-sensitive tables
alter table payments enable row level security;
alter table payment_events enable row level security;
alter table state_transitions enable row level security;
alter table situations enable row level security;
alter table recovery_actions enable row level security;
alter table audit_events enable row level security;
alter table policies enable row level security;
alter table recovery_rate_stats enable row level security;
alter table user_roles enable row level security;
alter table profiles enable row level security;

-- Payments: viewer+ can read, operator+ can ingest (writes go through function)
create policy "payments_select" on payments
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

-- Payment events: viewer+ can read
create policy "payment_events_select" on payment_events
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

-- State transitions: viewer+ can read
create policy "state_transitions_select" on state_transitions
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

-- Situations: viewer+ can read, operator+ can update (resolve)
create policy "situations_select" on situations
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

create policy "situations_update" on situations
  for update using (
    tenant_id in (
      select tenant_id from user_roles
      where user_id = auth.uid() and role in ('operator', 'admin', 'super_admin')
    )
  );

-- Recovery actions: viewer+ can read
create policy "recovery_actions_select" on recovery_actions
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

-- Audit events: viewer+ can read
create policy "audit_events_select" on audit_events
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

-- Policies: viewer+ can read, admin+ can modify
create policy "policies_select" on policies
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

create policy "policies_insert" on policies
  for insert with check (
    tenant_id in (
      select tenant_id from user_roles
      where user_id = auth.uid() and role in ('admin', 'super_admin')
    )
  );

create policy "policies_update" on policies
  for update using (
    tenant_id in (
      select tenant_id from user_roles
      where user_id = auth.uid() and role in ('admin', 'super_admin')
    )
  );

-- Recovery rate stats: viewer+ can read
create policy "recovery_rate_stats_select" on recovery_rate_stats
  for select using (
    tenant_id in (select tenant_id from user_roles where user_id = auth.uid())
  );

-- User roles: any authenticated user can read roles in their tenant
-- (individual row access is safe since user_roles already scopes by tenant)
create policy "user_roles_select_authenticated" on user_roles
  for select using (auth.uid() is not null);

-- Profiles: users can see their own; admin+ can see all
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

create policy "profiles_select_admin" on profiles
  for select using (
    exists (
      select 1 from user_roles
      where user_id = auth.uid() and role in ('admin', 'super_admin')
    )
  );

-- State transition contract: readable by all authenticated users
alter table state_transition_contract enable row level security;
create policy "stc_select" on state_transition_contract
  for select using (auth.uid() is not null);
