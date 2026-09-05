-- PayRaksha Demo Seed
-- Run after 0001: supabase/migrations/0002_demo_seed.sql
-- Creates demo tenant, policies, and 500 payment histories with multi-event event sourcing.

-- ============================================================
-- 1. Demo tenant
-- ============================================================
insert into tenants (slug, name) values ('demo', 'PayRaksha Demo')
on conflict (slug) do nothing;

-- ============================================================
-- 2. Demo policies
-- ============================================================
do $$
declare
  v_tenant uuid;
begin
  select id into v_tenant from tenants where slug = 'demo';

  insert into policies (tenant_id, name, description, rule) values
    (v_tenant, 'Auto-retry failed captures', 'Automatically retry capture on transient failures',
      '{"trigger": "payment.failed", "condition": "error_code in (NETWORK_TIMEOUT, GATEWAY_503)", "action": "recovery.initiated", "max_retries": 3}'),
    (v_tenant, 'Escalate high-value failures', 'Escalate failures above $5000 threshold',
      '{"trigger": "payment.failed", "condition": "amount > 5000", "action": "system.escalated"}'),
    (v_tenant, 'Block duplicate velocity', 'Block when >10 payments from same card in 1hr',
      '{"trigger": "payment.created", "condition": "velocity_1h(card) > 10", "action": "system.blocked"}'),
    (v_tenant, 'Review first-time merchants', 'Route first payment of new merchant to review',
      '{"trigger": "payment.created", "condition": "merchant_age_days < 7", "action": "review.queued"}'),
    (v_tenant, 'Release blocked after 24h', 'Auto-release blocked payments after 24 hours',
      '{"trigger": "system.released", "condition": "blocked_duration > 24h", "action": "system.released"}')
  on conflict do nothing;
end $$;

-- ============================================================
-- 3. Generate 500 payment histories
-- ============================================================
do $$
declare
  v_tenant uuid;
  v_payment_id uuid;
  v_ref text;
  v_amount numeric;
  v_method text;
  v_methods text[];
  v_bank text;
  v_banks text[];
  v_psp text;
  v_psps text[];
  v_currency text;
  v_status payment_status;
  v_i int;
  v_j int;
  v_event_count int;
  v_events text[];
  v_event text;
  v_provider_event_id text;
  v_event_ts timestamptz;
  v_base_ts timestamptz;
  v_error_code text;
  v_error_desc text;
  v_raw jsonb;
  v_states payment_status[];
begin
  select id into v_tenant from tenants where slug = 'demo';
  if v_tenant is null then
    raise notice 'Demo tenant not found — skipping seed.';
    return;
  end if;

  v_base_ts := now() - interval '30 days';
  v_methods := array['card', 'ach', 'wire', 'wallet'];
  v_banks := array['Chase', 'BofA', 'Wells Fargo', 'Citi', 'Capital One', 'US Bank', 'PNC', 'TD Bank'];
  v_psps := array['Stripe', 'Adyen', 'Braintree', 'Square', 'PayPal', 'Checkout.com'];

  for v_i in 1..500 loop
    v_ref := 'PAY-' || lpad(v_i::text, 3, '0');
    v_amount := (random() * 9900 + 10)::numeric(12,2);
    v_method := v_methods[1 + (random() * 3)::int];
    v_bank := v_banks[1 + (random() * 7)::int];
    v_psp := v_psps[1 + (random() * 5)::int];
    v_currency := 'USD';
    v_event_ts := v_base_ts + (random() * 30 || ' days')::interval;

    -- Determine scenario pattern
    case (v_i % 12)
      when 0 then
        -- PAY-001 style: created → authorized → failed (dup) → recovery → captured
        v_events := array['payment.created', 'payment.authorized', 'payment.failed', 'payment.failed', 'recovery.initiated', 'payment.captured'];
        v_status := 'CAPTURED_AFTER_FAILURE';
      when 1 then
        -- Clean success: created → authorized → captured
        v_events := array['payment.created', 'payment.authorized', 'payment.captured'];
        v_status := 'CAPTURED';
      when 2 then
        -- Hard failure: created → failed
        v_events := array['payment.created', 'payment.failed'];
        v_status := 'FAILED';
      when 3 then
        -- Recovery path: created → failed → recovery → captured
        v_events := array['payment.created', 'payment.failed', 'recovery.initiated', 'payment.captured'];
        v_status := 'CAPTURED_AFTER_FAILURE';
      when 4 then
        -- Escalated: created → failed → recovery → escalated
        v_events := array['payment.created', 'payment.failed', 'recovery.initiated', 'system.escalated'];
        v_status := 'ESCALATED';
      when 5 then
        -- Blocked: created → failed → blocked
        v_events := array['payment.created', 'payment.failed', 'system.blocked'];
        v_status := 'BLOCKED';
      when 6 then
        -- Review pending: created → failed → review.queued
        v_events := array['payment.created', 'payment.failed', 'review.queued'];
        v_status := 'PENDING_REVIEW';
      when 7 then
        -- Recovery cancelled: created → failed → recovery → cancelled
        v_events := array['payment.created', 'payment.failed', 'recovery.initiated', 'recovery.cancelled'];
        v_status := 'RECOVERY_CANCELLED';
      when 8 then
        -- Review then recovery: created → failed → review → approved → recovery → captured
        v_events := array['payment.created', 'payment.failed', 'review.queued', 'review.approved', 'recovery.initiated', 'payment.captured'];
        v_status := 'CAPTURED_AFTER_FAILURE';
      when 9 then
        -- Out-of-order: created → captured (skip auth)
        v_events := array['payment.created', 'payment.captured'];
        v_status := 'CAPTURED';
      when 10 then
        -- Recovery pending: created → failed → recovery
        v_events := array['payment.created', 'payment.failed', 'recovery.initiated'];
        v_status := 'RECOVERY_PENDING';
      when 11 then
        -- Authorized only: created → authorized
        v_events := array['payment.created', 'payment.authorized'];
        v_status := 'AUTHORIZED';
    end case;

    -- Insert payment
    insert into payments (id, tenant_id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at)
    values (gen_random_uuid(), v_tenant, v_ref, v_amount, v_currency, v_method, v_bank, v_psp, v_status, v_event_ts, v_event_ts + interval '1 hour')
    returning id into v_payment_id;

    -- Insert events
    v_event_count := array_length(v_events, 1);
    for v_j in 1..v_event_count loop
      v_event := v_events[v_j];
      v_provider_event_id := 'evt_' || v_i || '_' || v_j;

      -- Determine error info for failed events
      v_error_code := null;
      v_error_desc := null;
      if v_event = 'payment.failed' then
        v_error_code := (array['NETWORK_TIMEOUT', 'GATEWAY_503', 'INSUFFICIENT_FUNDS', 'CARD_DECLINED', 'EXPIRED_CARD'])[1 + (random() * 4)::int];
        v_error_desc := 'Error: ' || v_error_code;
      end if;

      v_raw := jsonb_build_object(
        'event_type', v_event,
        'amount', v_amount,
        'currency', v_currency,
        'provider', v_psp,
        'error_code', v_error_code
      );

      insert into payment_events (tenant_id, payment_id, provider_event_id, event_type, amount, currency, method, bank, psp, error_code, error_description, raw_payload, occurred_at)
      values (v_tenant, v_payment_id, v_provider_event_id, v_event, v_amount, v_currency, v_method, v_bank, v_psp, v_error_code, v_error_desc, v_raw, v_event_ts + ((v_j - 1) * interval '5 minutes'));

      -- Record state transition
      if v_j > 1 then
        insert into state_transitions (tenant_id, payment_id, from_status, to_status, event_type, valid, applied_at)
        values (v_tenant, v_payment_id, 'PENDING_REVIEW', v_status, v_event, true, v_event_ts + ((v_j - 1) * interval '5 minutes'));
      end if;
    end loop;
  end loop;

  -- ============================================================
  -- 4. Generate situations
  -- ============================================================
  insert into situations (tenant_id, payment_id, kind, severity, description)
  select v_tenant, p.id,
    case (random() * 3)::int
      when 0 then 'duplicate_webhook'
      when 1 then 'high_velocity'
      when 2 then 'out_of_order_events'
      else 'recovery_failure'
    end,
    case (random() * 3)::int
      when 0 then 'critical'::situation_severity
      when 1 then 'high'::situation_severity
      when 2 then 'medium'::situation_severity
      else 'low'::situation_severity
    end,
    'Detected anomaly on payment ' || p.payment_ref
  from payments p
  where p.tenant_id = v_tenant
  and p.status in ('FAILED', 'RECOVERY_PENDING', 'ESCALATED', 'BLOCKED')
  order by random()
  limit 80;

  -- ============================================================
  -- 5. Generate audit events
  -- ============================================================
  insert into audit_events (tenant_id, action, entity_type, entity_id, actor_role, details, occurred_at)
  select v_tenant,
    (array['payment.ingested', 'situation.detected', 'recovery.initiated', 'policy.applied', 'status.changed', 'review.queued', 'escalation.triggered', 'admin.login'])[1 + (random() * 7)::int],
    'payment',
    p.id::text,
    'admin',
    jsonb_build_object('payment_ref', p.payment_ref, 'status', p.status),
    p.created_at + (random() * interval '2 hours')
  from payments p
  where p.tenant_id = v_tenant
  order by random()
  limit 100;

  -- ============================================================
  -- 6. Generate recovery rate stats
  -- ============================================================
  insert into recovery_rate_stats (tenant_id, period_start, period_end, total_payments, recovered, failed, escalated, blocked, recovery_rate, avg_recovery_hours)
  select
    v_tenant,
    (date_trunc('week', now()) - (n || ' weeks')::interval)::timestamptz,
    (date_trunc('week', now()) - ((n - 1) || ' weeks')::interval)::timestamptz,
    (50 + random() * 50)::int,
    (10 + random() * 30)::int,
    (2 + random() * 10)::int,
    (random() * 5)::int,
    (random() * 3)::int,
    (0.4 + random() * 0.5)::numeric(5,4),
    (0.5 + random() * 48)::numeric(8,2)
  from generate_series(0, 11) as n;

  raise notice 'PayRaksha demo seed complete: 500 payments, ~% events, situations, audit, stats.',
    (select count(*) from payment_events where tenant_id = v_tenant);
end $$;
