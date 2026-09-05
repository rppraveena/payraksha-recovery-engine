-- =============================================================================
-- PayRaksha — Payment State & Recovery Intelligence
-- 0002_demo_seed.sql
--
-- Seeds the demo tenant with 500 payment histories (PAY-001..PAY-500). Every
-- history is a sequence of REAL payment_events rows folded through the
-- state_transition_contract — the same validation the ingest function applies.
-- Nothing here writes payments.status directly as a shortcut; status is the
-- deterministic fold of the stored events, computed and written in the same
-- pass (as the server-side ingest does for live events).
--
-- Showcases included:
--   PAY-001  duplicate webhook  — 5 stored events; the retransmitted
--            payment.failed (same provider_event_id evt_1_3) is absorbed by
--            UNIQUE(tenant_id, provider_event_id) and surfaced in audit.
--   PAY-002  failed -> recovery.initiated -> captured (multi-event recovery)
--   PAY-003  out-of-order guardrail — a late payment.expired after CAPTURED is
--            stored but rejected by the contract (state_transitions valid=false
--            + open situation); payments.status is NOT overwritten.
--
-- Idempotent: if the demo tenant already has payments, the seed skips itself.
-- =============================================================================

do $$
declare
    v_tenant       uuid;
    v_existing     bigint;

    -- shared payment fields
    v_ref          text;
    v_amount       numeric(14, 2);
    v_currency     text;
    v_method       text;
    v_bank         text;
    v_psp          text;
    v_t0           timestamptz;
    v_ts           timestamptz;

    -- generator state
    i              int;
    j              int;
    v_mod          int;
    v_init         text;
    v_status       text;
    v_to           text;
    v_events       text[];
    v_evt          text;
    v_payment_id   uuid;
    v_event_id     uuid;
    v_evt_seq      int;

    -- timestamps captured mid-walk for situations / actions
    v_failed_at    timestamptz;
    v_blocked_at   timestamptz;
    v_esc_at       timestamptz;
    v_queue_at     timestamptz;
    v_rejected_at  timestamptz;
    v_captured_at  timestamptz;
    v_sit_id       uuid;

    v_currencies   text[] := array['USD', 'EUR', 'GBP', 'INR', 'SGD'];
    v_methods      text[] := array['card', 'bank_transfer', 'wallet', 'upi'];
    v_banks        text[] := array['Chase', 'Barclays', 'HDFC', 'DBS', 'BNP Paribas'];
    v_psps         text[] := array['Stripe', 'Adyen', 'Razorpay', 'Checkout.com', 'Worldpay'];
begin
    -- Idempotence guard ------------------------------------------------------
    select id into v_tenant from public.tenants where slug = 'demo';
    if v_tenant is null then
        insert into public.tenants (slug, name)
        values ('demo', 'Demo Tenant')
        returning id into v_tenant;
    end if;
    select count(*) into v_existing from public.payments where tenant_id = v_tenant;
    if v_existing > 0 then
        raise notice 'Demo seed already present (% payments for tenant %) — skipping.', v_existing, v_tenant;
        return;
    end if;

    ---------------------------------------------------------------------------
    -- PAY-001 — duplicate webhook showcase. Stored events:
    -- created -> authorized -> failed -> recovery.initiated -> captured
    -- (5 rows). The retransmitted payment.failed (evt_1_3) is absorbed.
    ---------------------------------------------------------------------------
    v_ref := 'PAY-001';
    v_amount := 1240.00;
    v_currency := 'USD';
    v_method := 'card';
    v_bank := 'Chase';
    v_psp := 'Stripe';
    v_t0 := now() - interval '88 days 4 hours';
    v_status := 'FAILED'; -- implicit pre-history state

    insert into public.payments (tenant_id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at)
    values (v_tenant, v_ref, v_amount, v_currency, v_method, v_bank, v_psp, v_status, v_t0, v_t0)
    returning id into v_payment_id;

    for j in 1..5 loop
        v_evt := (array['payment.created', 'payment.authorized', 'payment.failed',
                        'recovery.initiated', 'payment.captured'])[j];
        v_ts := v_t0 + ((j - 1) || ' minutes')::interval + (j || ' seconds')::interval;
        select to_state into v_to
          from public.state_transition_contract
         where event_type = v_evt and from_state = v_status;
        if v_to is null then
            raise exception 'PAY-001 generator violates contract: % from %', v_evt, v_status;
        end if;

        insert into public.payment_events
            (id, tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
        values
            (gen_random_uuid(), v_tenant, v_payment_id,
             'evt_1_' || j, v_evt, v_ts,
             jsonb_build_object('payment_ref', v_ref, 'amount', v_amount,
                                'currency', v_currency, 'method', v_method,
                                'psp', v_psp, 'sequence', j,
                                'error_code', case when v_evt = 'payment.failed' then 'issuer_decline' end,
                                'error_description', case when v_evt = 'payment.failed' then 'Card declined by issuer on retry attempt' end))
        returning id into v_event_id;

        insert into public.state_transitions
            (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason, created_at)
        values (v_tenant, v_payment_id, v_event_id, v_status, v_to, true, v_evt, v_ts);

        if v_evt = 'payment.failed' then v_failed_at := v_ts; end if;
        if v_evt = 'payment.captured' then v_captured_at := v_ts; end if;
        v_status := v_to;
    end loop;

    -- The duplicate delivery: same provider_event_id as stored event #3.
    v_ts := v_t0 + interval '3 minutes 30 seconds';
    insert into public.payment_events
        (tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
    values
        (v_tenant, v_payment_id, 'evt_1_3', 'payment.failed', v_ts,
         jsonb_build_object('payment_ref', v_ref, 'duplicate', true, 'error_code', 'issuer_decline'))
    on conflict (tenant_id, provider_event_id) do nothing;

    insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
    values (v_tenant, null, 'webhook.duplicate_suppressed', 'payment_events', v_payment_id::text,
            jsonb_build_object('provider_event_id', 'evt_1_3', 'event_type', 'payment.failed', 'payment_ref', v_ref),
            v_ts);

    insert into public.situations
        (tenant_id, payment_id, kind, severity, status, summary, detected_at, resolved_at)
    values (v_tenant, v_payment_id, 'duplicate_webhook', 'medium', 'resolved',
            'Retransmitted payment.failed webhook (evt_1_3) absorbed by dedup contract; state unaffected.',
            v_ts, v_ts + interval '1 minute');

    -- final status: CAPTURED_AFTER_FAILURE
    update public.payments set status = v_status, updated_at = now() where id = v_payment_id;
    insert into public.recovery_actions
        (tenant_id, payment_id, action, status, value_recovered, executed_at, created_at)
    values (v_tenant, v_payment_id, 'retry_capture', 'executed', v_amount, v_captured_at, v_captured_at);
    insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
    values (v_tenant, null, 'payment.recovered', 'payments', v_payment_id::text,
            jsonb_build_object('payment_ref', v_ref, 'status', 'CAPTURED_AFTER_FAILURE', 'amount', v_amount),
            v_captured_at);
    raise notice 'Seeded PAY-001 (duplicate webhook showcase) -> %', v_status;

    ---------------------------------------------------------------------------
    -- PAY-002 — failed -> recovery.initiated -> captured (multi-event recovery)
    ---------------------------------------------------------------------------
    v_ref := 'PAY-002';
    v_amount := 820.50;
    v_t0 := now() - interval '87 days 2 hours';
    v_status := 'FAILED';
    insert into public.payments (tenant_id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at)
    values (v_tenant, v_ref, v_amount, 'EUR', 'card', 'Barclays', 'Adyen', v_status, v_t0, v_t0)
    returning id into v_payment_id;

    for j in 1..4 loop
        v_evt := (array['payment.created', 'payment.failed', 'recovery.initiated', 'payment.captured'])[j];
        v_ts := v_t0 + ((j - 1) || ' minutes')::interval + (j || ' seconds')::interval;
        select to_state into v_to
          from public.state_transition_contract
         where event_type = v_evt and from_state = v_status;
        if v_to is null then
            raise exception 'PAY-002 generator violates contract: % from %', v_evt, v_status;
        end if;
        insert into public.payment_events
            (id, tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
        values
            (gen_random_uuid(), v_tenant, v_payment_id, 'evt_2_' || j, v_evt, v_ts,
             jsonb_build_object('payment_ref', v_ref, 'amount', v_amount, 'sequence', j,
                                'error_code', case when v_evt = 'payment.failed' then 'do_not_honor' end))
        returning id into v_event_id;
        insert into public.state_transitions
            (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason, created_at)
        values (v_tenant, v_payment_id, v_event_id, v_status, v_to, true, v_evt, v_ts);
        if v_evt = 'payment.failed' then v_failed_at := v_ts; end if;
        if v_evt = 'payment.captured' then v_captured_at := v_ts; end if;
        v_status := v_to;
    end loop;
    update public.payments set status = v_status, updated_at = now() where id = v_payment_id;
    insert into public.recovery_actions
        (tenant_id, payment_id, action, status, value_recovered, executed_at, created_at)
    values (v_tenant, v_payment_id, 'retry_capture', 'executed', v_amount, v_captured_at, v_captured_at);
    insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
    values (v_tenant, null, 'payment.recovered', 'payments', v_payment_id::text,
            jsonb_build_object('payment_ref', v_ref, 'status', 'CAPTURED_AFTER_FAILURE', 'amount', v_amount),
            v_captured_at);

    ---------------------------------------------------------------------------
    -- PAY-003 — out-of-order guardrail: late payment.expired after CAPTURED.
    ---------------------------------------------------------------------------
    v_ref := 'PAY-003';
    v_amount := 199.99;
    v_t0 := now() - interval '86 days 5 hours';
    v_status := 'FAILED';
    insert into public.payments (tenant_id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at)
    values (v_tenant, v_ref, v_amount, 'GBP', 'card', 'DBS', 'Checkout.com', v_status, v_t0, v_t0)
    returning id into v_payment_id;

    for j in 1..2 loop
        v_evt := (array['payment.authorized', 'payment.captured'])[j];
        v_ts := v_t0 + ((j - 1) || ' minutes')::interval;
        select to_state into v_to
          from public.state_transition_contract
         where event_type = v_evt and from_state = v_status;
        if v_to is null then
            raise exception 'PAY-003 generator violates contract: % from %', v_evt, v_status;
        end if;
        insert into public.payment_events
            (id, tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
        values (gen_random_uuid(), v_tenant, v_payment_id, 'evt_3_' || j, v_evt, v_ts,
                jsonb_build_object('payment_ref', v_ref, 'amount', v_amount, 'sequence', j))
        returning id into v_event_id;
        insert into public.state_transitions
            (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason, created_at)
        values (v_tenant, v_payment_id, v_event_id, v_status, v_to, true, v_evt, v_ts);
        if v_evt = 'payment.captured' then v_captured_at := v_ts; end if;
        v_status := v_to;
    end loop;
    update public.payments set status = v_status, updated_at = now() where id = v_payment_id;

    -- Guardrail attempt: expired arrives AFTER capture. Stored (raw truth) but
    -- rejected by the contract; status stays CAPTURED.
    v_ts := v_captured_at + interval '90 minutes';
    insert into public.payment_events
        (id, tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
    values (gen_random_uuid(), v_tenant, v_payment_id, 'evt_3_3', 'payment.expired', v_ts,
            jsonb_build_object('payment_ref', v_ref, 'out_of_order', true))
    returning id into v_event_id;
    insert into public.state_transitions
        (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason, created_at)
    values (v_tenant, v_payment_id, v_event_id, v_status, v_status, false,
            'Invalid transition: payment.expired not allowed from CAPTURED', v_ts);
    insert into public.situations
        (tenant_id, payment_id, kind, severity, status, summary, detected_at)
    values (v_tenant, v_payment_id, 'out_of_order_event', 'high', 'open',
            'Late payment.expired webhook arrived after CAPTURED — stored for audit, rejected by the state contract.',
            v_ts);
    insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
    values (v_tenant, null, 'state.conflict_rejected', 'payments', v_payment_id::text,
            jsonb_build_object('payment_ref', v_ref, 'event_type', 'payment.expired', 'from_state', 'CAPTURED'),
            v_ts);

    ---------------------------------------------------------------------------
    -- PAY-004 .. PAY-500 — deterministic mix of real event histories.
    ---------------------------------------------------------------------------
    for i in 4..500 loop
        v_mod := (i - 4) % 10;
        v_ref := 'PAY-' || lpad(i::text, 3, '0');
        v_amount := (((i * 37) % 4800) + 25 + ((i % 7)::numeric / 100.0))::numeric(14, 2);
        v_currency := v_currencies[1 + (i % 5)];
        v_method   := v_methods[1 + (i % 4)];
        v_bank     := v_banks[1 + (i % 5)];
        v_psp      := v_psps[1 + (i % 5)];
        v_t0 := now() - ((1 + ((i * 7) % 85)) || ' days')::interval
                     - (((i * 13) % 1400) || ' minutes')::interval;

        v_init := 'FAILED';
        if    v_mod in (0, 1, 8) then
            -- normal captures (0: authorized+captured, 1/8: created first)
            if v_mod = 0 then
                v_events := array['payment.authorized', 'payment.captured'];
            else
                v_events := array['payment.created', 'payment.authorized', 'payment.captured'];
            end if;
        elsif v_mod in (2, 9) then
            -- decline -> recovery.initiated -> captured (recovered)
            v_events := array['payment.created', 'payment.authorized', 'payment.failed',
                              'recovery.initiated', 'payment.captured'];
        elsif v_mod = 3 then
            -- decline -> recovery -> risk block (terminal-ish, releasable)
            v_events := array['payment.created', 'payment.authorized', 'payment.failed',
                              'recovery.initiated', 'system.blocked'];
        elsif v_mod = 4 then
            -- decline -> escalation
            v_events := array['payment.created', 'payment.authorized', 'payment.failed',
                              'system.escalated'];
        elsif v_mod = 5 then
            -- auth -> expired -> recovery -> captured after failure
            v_events := array['payment.created', 'payment.authorized', 'payment.expired',
                              'recovery.initiated', 'payment.captured'];
        elsif v_mod = 6 then
            -- recovery cancelled by operator
            v_events := array['payment.created', 'payment.authorized', 'payment.failed',
                              'recovery.cancelled'];
        else -- v_mod = 7
            -- declined -> review -> rejected (final FAILED)
            v_events := array['payment.created', 'payment.authorized', 'payment.failed',
                              'review.queued', 'review.rejected'];
        end if;

        v_status := v_init;
        v_failed_at := null; v_blocked_at := null; v_esc_at := null;
        v_queue_at := null; v_rejected_at := null; v_captured_at := null;

        -- Mid-flight cuts so AUTHORIZED, PENDING_REVIEW and RECOVERY_PENDING
        -- also appear as CURRENT states, not just waypoints.
        if v_mod = 0 and (i % 23) = 0 then
            v_events := v_events[1 : array_length(v_events, 1) - 1]; -- authorized only
        elsif v_mod = 1 and (i % 29) = 0 then
            v_events := v_events[1 : 1]; -- created only
        elsif v_mod = 2 and (i % 31) = 0 then
            v_events := v_events[1 : 3]; -- created, authorized, failed
        end if;

        insert into public.payments
            (tenant_id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at)
        values (v_tenant, v_ref, v_amount, v_currency, v_method, v_bank, v_psp, v_status, v_t0, v_t0)
        returning id into v_payment_id;

        j := 1;
        foreach v_evt in array v_events loop
            v_ts := v_t0 + (((j - 1) * 7 + (i * 3) % 40) || ' minutes')::interval
                         + (j || ' seconds')::interval;
            -- late-capture flavor: authorize then capture ~26h later
            if j = 3 and v_mod = 8 and (i % 17) = 0 and v_evt = 'payment.captured' then
                v_ts := v_t0 + interval '26 hours';
            end if;
            select to_state into v_to
              from public.state_transition_contract
             where event_type = v_evt and from_state = v_status;
            if v_to is null then
                raise exception 'Seed generator violates contract for %: % from %', v_ref, v_evt, v_status;
            end if;

            insert into public.payment_events
                (id, tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
            values (gen_random_uuid(), v_tenant, v_payment_id,
                    'evt_' || i || '_' || j, v_evt, v_ts,
                    jsonb_build_object('payment_ref', v_ref, 'amount', v_amount,
                                       'currency', v_currency, 'method', v_method,
                                       'bank', v_bank, 'psp', v_psp, 'sequence', j,
                                       'error_code', case when v_evt = 'payment.failed' and v_mod = 7
                                                            then (array['card_expired', 'insufficient_funds', 'generic_decline'])[1 + (i % 3)]
                                                           when v_evt = 'payment.failed' then 'issuer_decline'
                                                           when v_evt = 'payment.expired' then 'auth_window_lapsed'
                                                      end,
                                       'error_description', case when v_evt = 'payment.failed' and v_mod = 7 and (i % 3) = 0
                                                                  then 'Card expired — retry rejected by issuer'
                                                                  when v_evt = 'payment.failed' and v_mod = 7 and (i % 3) = 1
                                                                  then 'Insufficient balance at capture time'
                                                                  else null end))
            returning id into v_event_id;

            insert into public.state_transitions
                (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason, created_at)
            values (v_tenant, v_payment_id, v_event_id, v_status, v_to, true, v_evt, v_ts);

            if v_evt = 'payment.failed' then v_failed_at := coalesce(v_failed_at, v_ts); end if;
            if v_evt = 'system.blocked' then v_blocked_at := v_ts; end if;
            if v_evt = 'system.escalated' then v_esc_at := v_ts; end if;
            if v_evt = 'review.queued' then v_queue_at := v_ts; end if;
            if v_evt = 'review.rejected' then v_rejected_at := v_ts; end if;
            if v_evt = 'payment.captured' then v_captured_at := v_ts; end if;

            v_status := v_to;
            j := j + 1;
        end loop;

        -- Write the deterministic final state (equivalent of the ingest fold).
        update public.payments set status = v_status, updated_at = now() where id = v_payment_id;

        -- Situations / recovery actions / audit by outcome -------------------
        if v_status = 'CAPTURED_AFTER_FAILURE' then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at, resolved_at)
            values (v_tenant, v_payment_id, 'recovery_pending', 'medium', 'resolved',
                    'Capture failed then recovery retry succeeded.',
                    v_failed_at, v_captured_at)
            returning id into v_sit_id;
            insert into public.recovery_actions
                (tenant_id, payment_id, situation_id, action, status, value_recovered, executed_at, created_at)
            values (v_tenant, v_payment_id, v_sit_id, 'retry_capture', 'executed', v_amount, v_captured_at, v_captured_at);
            insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
            values (v_tenant, null, 'payment.recovered', 'payments', v_payment_id::text,
                    jsonb_build_object('payment_ref', v_ref, 'status', 'CAPTURED_AFTER_FAILURE', 'amount', v_amount),
                    v_captured_at);
        elsif v_status = 'RECOVERY_PENDING' then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at)
            values (v_tenant, v_payment_id, 'recovery_pending', 'medium', 'open',
                    'Capture failed — recovery retry queued and awaiting execution.',
                    v_failed_at);
            insert into public.recovery_actions
                (tenant_id, payment_id, action, status, value_recovered, executed_at, created_at)
            values (v_tenant, v_payment_id, 'retry_capture', 'pending', 0, null, now());
        elsif v_status = 'BLOCKED' then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at)
            values (v_tenant, v_payment_id, 'payment_blocked', 'critical', 'open',
                    'Risk rule blocked recovery path — requires release or manual review.',
                    v_blocked_at);
            insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
            values (v_tenant, null, 'payment.blocked', 'payments', v_payment_id::text,
                    jsonb_build_object('payment_ref', v_ref), v_blocked_at);
        elsif v_status = 'ESCALATED' then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at)
            values (v_tenant, v_payment_id, 'escalated_payment', 'high', 'open',
                    'Auto-recovery exhausted — escalated for specialist review.',
                    v_esc_at);
            insert into public.recovery_actions
                (tenant_id, payment_id, action, status, value_recovered, executed_at, created_at)
            values (v_tenant, v_payment_id, 'escalate', 'executed', 0, v_esc_at, v_esc_at);
            insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
            values (v_tenant, null, 'payment.escalated', 'payments', v_payment_id::text,
                    jsonb_build_object('payment_ref', v_ref), v_esc_at);
        elsif v_status = 'RECOVERY_CANCELLED' then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at)
            values (v_tenant, v_payment_id, 'recovery_pending', 'low', 'resolved',
                    'Recovery cancelled by operator decision.', v_failed_at, now() - interval '1 hour');
        elsif v_status = 'FAILED' then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at, resolved_at)
            values (v_tenant, v_payment_id, 'review_required', 'high', 'resolved',
                    'Declined payment reviewed and rejected — no recovery path.',
                    v_queue_at, v_rejected_at);
            if (i % 3) = 0 then
                insert into public.situations
                    (tenant_id, payment_id, kind, severity, status, summary, detected_at)
                values (v_tenant, v_payment_id, 'card_expired', 'medium', 'open',
                        'Issuer reported an expired card on the decline.',
                        v_failed_at);
            elsif (i % 3) = 1 then
                insert into public.situations
                    (tenant_id, payment_id, kind, severity, status, summary, detected_at)
                values (v_tenant, v_payment_id, 'insufficient_balance', 'medium', 'open',
                        'Issuer reported insufficient balance at capture time.',
                        v_failed_at);
            end if;
        end if;

        -- Guardrail showcase: late/terminal-state events on normal captures.
        if v_status = 'CAPTURED' and (v_mod in (0, 1, 8)) and (i % 13) = 0 then
            v_ts := v_captured_at + interval '2 hours';
            v_evt := case when (i % 2) = 0 then 'payment.expired' else 'system.escalated' end;
            insert into public.payment_events
                (id, tenant_id, payment_id, provider_event_id, event_type, occurred_at, raw_payload)
            values (gen_random_uuid(), v_tenant, v_payment_id, 'evt_' || i || '_' || j, v_evt, v_ts,
                    jsonb_build_object('payment_ref', v_ref, 'out_of_order', true))
            returning id into v_event_id;
            insert into public.state_transitions
                (tenant_id, payment_id, payment_event_id, from_state, to_state, valid, reason, created_at)
            values (v_tenant, v_payment_id, v_event_id, v_status, v_status, false,
                    'Invalid transition: ' || v_evt || ' not allowed from CAPTURED', v_ts);
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at)
            values (v_tenant, v_payment_id, 'out_of_order_event', 'high', 'open',
                    'Out-of-order ' || v_evt || ' after CAPTURED — stored, rejected by contract.',
                    v_ts);
            insert into public.audit_events (tenant_id, actor_role, action, entity_type, entity_id, details, occurred_at)
            values (v_tenant, null, 'state.conflict_rejected', 'payments', v_payment_id::text,
                    jsonb_build_object('payment_ref', v_ref, 'event_type', v_evt, 'from_state', 'CAPTURED'),
                    v_ts);
        end if;

        -- Late-capture flavor situation.
        if v_mod = 8 and (i % 17) = 0 and v_captured_at is not null then
            insert into public.situations
                (tenant_id, payment_id, kind, severity, status, summary, detected_at, resolved_at)
            values (v_tenant, v_payment_id, 'late_capture', 'info', 'resolved',
                    'Authorized hold captured ~26h later than typical.',
                    v_t0 + interval '1 hour', v_captured_at);
        end if;
    end loop;

    ---------------------------------------------------------------------------
    -- Recovery-rate stats (daily buckets from executed retry captures).
    ---------------------------------------------------------------------------
    insert into public.recovery_rate_stats
        (tenant_id, bucket_date, attempted, recovered, recovered_amount, rate)
    select
        t.id,
        date(ra.executed_at),
        count(*)::int,
        count(*) filter (where p.status in ('CAPTURED', 'CAPTURED_AFTER_FAILURE'))::int,
        coalesce(sum(ra.value_recovered) filter (where p.status in ('CAPTURED', 'CAPTURED_AFTER_FAILURE')), 0),
        case when count(*) > 0
             then (count(*) filter (where p.status in ('CAPTURED', 'CAPTURED_AFTER_FAILURE')))::numeric / count(*)
             else 0 end
    from public.recovery_actions ra
    join public.payments p   on p.id = ra.payment_id
    cross join public.tenants t
    where t.id = v_tenant
      and ra.action = 'retry_capture'
      and ra.executed_at is not null
    group by t.id, date(ra.executed_at)
    order by 2;

    ---------------------------------------------------------------------------
    -- Demo policies.
    ---------------------------------------------------------------------------
    insert into public.policies (tenant_id, name, description, enabled, conditions, action) values
        (v_tenant, 'Auto-retry capture once', 'Retry capture once when a payment enters RECOVERY_PENDING with an issuer decline.',
         true, jsonb_build_object('trigger', 'recovery.initiated', 'max_retries', 1, 'error_codes', jsonb_build_array('issuer_decline')), 'retry_capture'),
        (v_tenant, 'Escalate after 3 recovery attempts', 'Escalate to specialist review when three recovery attempts fail.',
         true, jsonb_build_object('trigger', 'recovery.failed', 'threshold', 3), 'escalate'),
        (v_tenant, 'Block suspected fraud velocity', 'Block recovery when the same instrument fails more than 5 times in an hour.',
         true, jsonb_build_object('trigger', 'payment.failed', 'window_minutes', 60, 'threshold', 5), 'system.blocked'),
        (v_tenant, 'Card-expired auto review', 'Queue declined payments with card_expired for manual review instead of retry.',
         true, jsonb_build_object('error_codes', jsonb_build_array('card_expired')), 'review.queued')
    on conflict do nothing;

    raise notice 'Demo seed complete: 500 payment histories for tenant %', v_tenant;
end;
$$;
