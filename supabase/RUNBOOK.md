# PayRaksha Supabase Migration Runbook

Supabase PostgreSQL + Supabase Auth + RLS become the sole application backend and source of truth. Convex stays untouched and is simply ignored.

## 1. Run the migrations (in this exact order)

Supabase Dashboard → SQL Editor → paste each file in order:

1. `supabase/migrations/0001_payraksha_foundation.sql` — schema, RLS, triggers, contract, ingest function
2. `supabase/migrations/0002_demo_seed.sql` — tenant, policies, 500 payment histories, situations, audit, stats

Each file is idempotent (safe to re-run). If the SQL editor reports an error, stop and read the message — do not re-run blindly.

## 2. Provision the org admin — never a plaintext password in code

The plaintext password must never appear in source, migrations, or Git.

**Recommended: Supabase Dashboard → Authentication → Users → Add user.**
Type the org email + password directly in the dashboard. This is the secure Supabase Auth setup mechanism. After the user exists, `on_auth_user_created` → `on_profile_created` triggers automatically create the profile and grant a viewer role in the demo tenant.

## 3. Assign the admin role (SQL editor, after step 2 and after the seed)

```sql
update user_roles
   set role = 'admin'
 where user_id = (select id from auth.users where email = 'admin@yourcompany.com')
   and tenant_id = (select id from tenants where slug = 'demo');
```

## 4. Add the keys in the Freebuff Keys tab

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://hlvmuljzdmvvvcqhrzst.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_w7VqbKHG213yGAg4UmVifA_LfYRXXCL` |

The publishable/anon key is safe for the browser. The service-role key must never reach the client and is not used by this app.

## 5. Verify after seeding

```sql
-- Row counts
select count(*) from payments;        -- expect 500
select count(*) from payment_events;  -- expect ~2000 (multi-event histories)

-- The critical check — multiple events per payment:
select p.payment_ref, count(*) as events
from payments p
join payment_events e on e.payment_id = p.id
group by p.payment_ref
order by p.payment_ref
limit 10;
```

The duplicate-webhook showcase (PAY-001): run

```sql
select p.payment_ref, e.provider_event_id, e.event_type, e.occurred_at
from payments p
join payment_events e on e.payment_id = p.id
where p.payment_ref = 'PAY-001'
order by e.occurred_at;
```

Expected: 5 stored rows (created → authorized → failed → recovery.initiated → captured). The retransmitted `payment.failed` webhook carrying the same `provider_event_id` (`evt_1_3`) was absorbed by the dedup contract `UNIQUE(tenant_id, provider_event_id)` — PAY-001 ends in `CAPTURED_AFTER_FAILURE`.

Status distribution:

```sql
select status, count(*) from payments group by 1 order by 2 desc;
```

Expected mix across all nine states — CAPTURED / CAPTURED_AFTER_FAILURE / RECOVERY_PENDING dominate, with smaller numbers of BLOCKED / ESCALATED / PENDING_REVIEW / RECOVERY_CANCELLED / AUTHORIZED / FAILED.

Also verify the transition + situation + audit tables are populated:

```sql
select count(*) from state_transitions; -- ~1 event per stored payment_event
select kind, severity, count(*) from situations group by 1, 2 order by 3 desc;
select action, count(*) from audit_events group by 1;
```

## 6. After verification: switch the UI to Supabase

Once data is seeded and the admin is provisioned, the app switches from Convex to Supabase (auth via `supabase.auth`, queries via `@supabase/supabase-js` with RLS enforced server-side). The landing → /auth → /dashboard flow stays identical; only the data source changes.

## File map

- `supabase/migrations/0001_payraksha_foundation.sql` — schema + RLS + triggers + state-transition contract + `ingest_payment_event()`
- `supabase/migrations/0002_demo_seed.sql` — demo tenant + 500 event histories + situations + audit + stats
