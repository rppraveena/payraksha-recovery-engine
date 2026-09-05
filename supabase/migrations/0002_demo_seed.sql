-- ============================================================================
-- PayRaksha demo seed
-- Idempotent: skips entirely if the demo tenant already exists.
--
-- Seeds:
--   * demo tenant + starter policies
--   * 500 payment histories (PAY-001 .. PAY-500) built from REAL payment_events
--     across 8 scenarios incl. duplicate webhooks and out-of-order arrivals
--   * payments.status DERIVED by folding the event history through the
--     state_transition_contract (never hardcoded)
--   * situations, recovery_actions, audit_events, recovery_rate_stats
--
-- The org admin account is NOT created here — it is provisioned through
-- Supabase Auth (see RUNBOOK). handle_new_profile() grants every new auth
-- user a viewer role in this tenant automatically.
-- ============================================================================

do $$
declare
  v_tenant uuid;
  v_payment uuid;
  v_scenario text;
  v_state public.payment_state;
  v_next public.payment_state;
  v_seq int;
  v_amount numeric(14,2);
  v_currency char(3);
  v_method text;
  v_bank text;
  v_psp text;
  v_base timestamptz;
  v_situation uuid;
  i int;
  r record;
begin
  -- Skip if already seeded -------------------------------------------------
  if exists (select 1 from public.tenants where slug = 'demo') then
    raise notice 'demo tenant already seeded — skipping';
    return;
  end if;

  insert into public.tenants (name, slug)
  values ('PayRaksha Demo', 'demo')
  returning id into v_tenant;

  -- Starter policies --------------------------------------------------------
  insert into public.policies (tenant_id, name, description, condition, effect) values
    (v_tenant, 'standard_retry',
     'Auto-retry failed payments up to the configured limit.',
     '{"max_retries": 3, "window_hours": 24}', 'allow'),
    (v_tenant, 'high_value_manual_review',
     'Recovery above the threshold requires operator approval.',
     '{"amount_gte": 100000}', 'require_approval'),
    (v_tenant, 'duplicate_webhook_reject',
     'Never act on duplicate provider events.',
     '{"event_kind": "duplicate"}', 'deny'),
    (v_tenant, 'late_capture_auto_review',
     'Captures arriving after a failure are queued for review.',
     '{"situation": "late_capture_after_failure"}', 'require_approval')
  on conflict (tenant_id, name) do nothing;

  -- 500 payment histories ----------------------------------------------------
  for i in 1..500 loop
    v_scenario := case
      when i = 1 then 'duplicate_webhook'        -- showcase payment
      when i % 100 = 2 then 'duplicate_webhook'  -- 4 more
      when i % 50 = 3 then 'out_of_order'        -- ~10
      when i % 37 = 5 then 'late_capture'        -- ~13
      when i % 11 = 6 then 'card_expired'        -- ~45
      when i % 9 = 7 then 'insufficient_balance' -- ~55
      when i % 17 = 8 then 'review_queue'        -- ~29
      when i % 7 = 0 then 'happy_path'           -- remainder share
      else 'recovery_flow'
    end;

    v_amount    := 250 + ((i * 7919) % 199500);           -- 250 .. 199,750
    v_currency  := case when i % 23 = 0 then 'USD' else 'INR' end;
    v_method    := (array['card','upi','netbanking'])[1 + (i % 3)];
    v_bank      := (array['HDFC','ICICI','SBI','Axis'])[1 + (i % 4)];
    v_psp       := (array['razorpay','payu','cashfree'])[1 + (i % 3)];
    v_base      := now() - ((500 - i) || ' hours')::interval;

    insert into public.payments (tenant_id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at)
    values (v_tenant, 'PAY-' || lpad(i::text, 3, '0'), v_amount, v_currency, v_method, v_bank, v_psp, 'FAILED', v_base, v_base)
    returning id into v_payment;

    -- Raw event history per scenario (occurred_at ordering is authoritative).
    if v_scenario = 'happy_path' then
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',   v_base,                  '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.authorized',v_base + interval '2 min', '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.captured',  v_base + interval '5 min', '{"source":"seed"}');
      v_seq := 3;

    elsif v_scenario = 'recovery_flow' then
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',    v_base,                    '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.authorized', v_base + interval '2 min', '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.failed',     v_base + interval '6 min', '{"error_code":"insufficient_funds","source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_4', 'recovery.initiated', v_base + interval '30 min','{"source":"seed"}');
      v_seq := 4;
      if i % 5 <> 0 then  -- ~80% eventually recover
        insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
          (v_tenant, v_payment, 'evt_' || i || '_5', 'payment.captured', v_base + interval '2 hours', '{"source":"seed","recovered":true}');
        v_seq := 5;
      end if;

    elsif v_scenario = 'card_expired' then
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',   v_base,                     '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.authorized',v_base + interval '1 min',  '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.expired',   v_base + interval '40 min', '{"error_code":"card_expired","source":"seed"}');
      v_seq := 3;

    elsif v_scenario = 'insufficient_balance' then
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',    v_base,                     '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.authorized', v_base + interval '1 min',  '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.failed',     v_base + interval '3 min',  '{"error_code":"insufficient_balance","source":"seed"}');
      v_seq := 3;

    elsif v_scenario = 'duplicate_webhook' then
      -- Same provider_event_id twice: UNIQUE(tenant_id, provider_event_id)
      -- absorbs the duplicate — the visible dedup story for PAY-001.
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',    v_base,                      '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.authorized', v_base + interval '2 min',   '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.failed',     v_base + interval '7 min',   '{"error_code":"gateway_timeout","source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.failed',     v_base + interval '7 min',   '{"error_code":"gateway_timeout","source":"seed","duplicate_of":"evt_' || i || '_3"}')
      on conflict (tenant_id, provider_event_id) do nothing;
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_4', 'recovery.initiated', v_base + interval '25 min',  '{"source":"seed"}');
      v_seq := 4;

    elsif v_scenario = 'out_of_order' then
      -- Webhook ARRIVAL order differs from occurred_at; raw preserves arrival.
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.authorized', v_base + interval '3 min', '{"source":"seed","arrival_seq":2,"note":"arrived before created"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.created',    v_base,                    '{"source":"seed","arrival_seq":1}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.captured',   v_base + interval '9 min', '{"source":"seed","arrival_seq":3}');
      v_seq := 3;

    elsif v_scenario = 'late_capture' then
      -- Capture lands AFTER a failure: CAPTURED_AFTER_FAILURE story.
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',    v_base,                      '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.authorized', v_base + interval '2 min',   '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'payment.failed',     v_base + interval '8 min',   '{"error_code":"timeout","source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_4', 'payment.captured',   v_base + interval '50 min',  '{"source":"seed","late":true}');
      v_seq := 4;

    else -- review_queue
      insert into public.payment_events (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw) values
        (v_tenant, v_payment, 'evt_' || i || '_1', 'payment.created',  v_base,                     '{"source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_2', 'payment.failed',   v_base + interval '2 min',  '{"error_code":"risk_hold","source":"seed"}'),
        (v_tenant, v_payment, 'evt_' || i || '_3', 'review.queued',    v_base + interval '10 min', '{"source":"seed"}');
      v_seq := 3;
    end if;

    -- ------------------------------------------------------------------
    -- State reconstruction: fold the event history through the explicit
    -- transition contract, ordered by occurred_at. status is DERIVED.
    -- ------------------------------------------------------------------
    v_state := 'FAILED';
    for r in
      select e.event_type
      from public.payment_events e
      where e.payment_id = v_payment
      order by e.occurred_at, e.created_at
    loop
      select c.to_state into v_next
      from public.state_transition_contract c
      where c.event_type = r.event_type and c.from_state = v_state;
      if v_next is not null and v_next <> v_state then
        v_state := v_next;
      end if;
    end loop;

    update public.payments
       set status = v_state, updated_at = v_base + (v_seq || ' minutes')::interval
     where id = v_payment;

    -- Situations + proposed recovery actions for non-healthy stories ------
    if v_scenario in ('duplicate_webhook', 'late_capture', 'card_expired', 'insufficient_balance') then
      insert into public.situations (tenant_id, payment_id, kind, severity, diagnosis, detected_at, resolved_at)
      values (
        v_tenant, v_payment,
        case v_scenario
          when 'duplicate_webhook' then 'duplicate_webhook'
          when 'late_capture' then 'late_capture_after_failure'
          when 'card_expired' then 'expired_card'
          else 'insufficient_balance'
        end,
        case when v_scenario in ('late_capture', 'duplicate_webhook') then 'critical' else 'warning' end,
        case v_scenario
          when 'duplicate_webhook' then 'Duplicate provider webhook absorbed by dedup key; recovery initiated.'
          when 'late_capture' then 'Capture confirmed after a failure event — reconcile PSP settlement.'
          when 'card_expired' then 'Authorization expired; instrument needs refresh before retry.'
          else 'Insufficient balance at first attempt; scheduled retry recommended.'
        end,
        v_base + (v_seq || ' minutes')::interval,
        case when v_state in ('CAPTURED', 'CAPTURED_AFTER_FAILURE')
             then v_base + interval '3 hours' end
      )
      returning id into v_situation;

      if v_state not in ('CAPTURED', 'CAPTURED_AFTER_FAILURE') then
        insert into public.recovery_actions (tenant_id, payment_id, situation_id, action, expected_value, status, created_at)
        values (
          v_tenant, v_payment, v_situation,
          case v_scenario
            when 'card_expired' then 'request_instrument_refresh'
            when 'insufficient_balance' then 'scheduled_retry'
            else 'manual_review'
          end,
          round(v_amount * 0.92, 2),
          'proposed',
          v_base + (v_seq || ' minutes')::interval
        );
      end if;
    end if;

    -- Pipeline audit entry for the seed import -----------------------------
    insert into public.audit_events (tenant_id, actor, action, entity_type, entity_id, payload, created_at)
    values (v_tenant, null, 'seed.import', 'payment', v_payment,
            jsonb_build_object('scenario', v_scenario, 'final_state', v_state, 'events', v_seq),
            v_base + (v_seq || ' minutes')::interval);
  end loop;

  -- Recovery rate stats: 30 daily buckets -----------------------------------
  insert into public.recovery_rate_stats (tenant_id, bucket, attempts, recoveries, recovered_value)
  select
    v_tenant,
    current_date - g,
    18 + (g * 7) % 11,
    6 + (g * 5) % 7,
    (6 + (g * 5) % 7) * 2140.00
  from generate_series(0, 29) as g
  on conflict (tenant_id, bucket) do nothing;

  raise notice 'Seeded demo tenant %: 500 payments, events, situations, audit.', v_tenant;
end;
$$;

-- ============================================================================
-- Verification queries (run in the SQL editor after seeding):
--
--   -- multiple events per payment (the PayRaksha story):
--   select payment_id, count(*) from payment_events group by 1 order by 1 limit 10;
--
--   -- the PAY-001 duplicate-webhook showcase (3 events, one provider_event_id):
--   select p.payment_ref, e.provider_event_id, e.event_type, e.occurred_at
--   from payments p join payment_events e on e.payment_id = p.id
--   where p.payment_ref = 'PAY-001' order by e.occurred_at;
--
--   -- derived status distribution:
--   select status, count(*) from payments group by 1 order by 2 desc;
-- ============================================================================
