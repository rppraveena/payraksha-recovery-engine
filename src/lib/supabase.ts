import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * PayRaksha data layer — Supabase PostgreSQL + Auth + RLS.
 *
 * The client is created lazily from Vite environment variables:
 *   - VITE_SUPABASE_URL              — Project URL, e.g. https://abc123.supabase.co
 *   - VITE_SUPABASE_ANON_KEY         — Public anon key (preferred)
 *   - VITE_SUPABASE_PUBLISHABLE_KEY  — Same value under Supabase's new key name; fallback
 *
 * Add the keys in the project's Keys tab, and apply the schema once via the SQL
 * editor (files in supabase/migrations/, in order 0001 then 0002). Until keys
 * exist every helper returns { ok: false, reason: "config" } so callers can
 * render a clear "connect Supabase" state.
 *
 * Security contract:
 *   - Identity and role are derived server-side from the Supabase session
 *     (auth.uid()); the browser never supplies tenant_id / role claims.
 *   - This module is READ-ONLY. Every read goes through PostgREST under RLS
 *     (viewer+ role). Writes happen only through server-side SECURITY DEFINER
 *     functions (ingest_payment_event, set_user_role) which enforce operator+ /
 *     admin+ server-side. No anonymous policies exist in the schema.
 *   - payments.status is never written here — it only changes when validated
 *     events pass through the state-transition contract server-side.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

export const supabaseConfig = {
  url: url ?? "",
  anonKey: anonKey ?? "",
  configured: Boolean(url && anonKey),
};

/** Client instance, or null until VITE_SUPABASE_URL and an anon/publishable key are set. */
export const supabase: SupabaseClient | null = supabaseConfig.configured
  ? createClient(url!, anonKey!)
  : null;

export type SupabaseResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "config" | "request"; error: string };

function configError(): SupabaseResult<never> {
  return { ok: false, reason: "config", error: "Supabase keys are not configured." };
}

function requestError(err: unknown, fallback = "Unexpected Supabase error."): SupabaseResult<never> {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : fallback;
  return { ok: false, reason: "request", error: message };
}

/** The caller's tenants + role, derived server-side from the Supabase session. */
export interface PayRakshaTenant {
  tenant_id: string;
  slug: string;
  name: string;
  role: "viewer" | "operator" | "admin" | "super_admin" | null;
}

export async function listMyTenants(): Promise<SupabaseResult<PayRakshaTenant[]>> {
  if (!supabase) return configError();
  try {
    const { data, error } = await supabase.rpc("list_my_tenants");
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: (data ?? []) as unknown as PayRakshaTenant[] };
  } catch (err) {
    return requestError(err);
  }
}

export interface AuditEventRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_role: string | null;
  details: Record<string, unknown> | null;
  occurred_at: string;
}

/** Most recent rows from audit_events for a tenant (viewer+). */
export async function fetchAuditEvents(
  tenantId: string,
  limit = 25,
): Promise<SupabaseResult<AuditEventRow[]>> {
  if (!supabase) return configError();
  try {
    const { data, error } = await supabase
      .from("audit_events")
      .select("id, action, entity_type, entity_id, actor_role, details, occurred_at")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: (data ?? []) as unknown as AuditEventRow[] };
  } catch (err) {
    return requestError(err);
  }
}

export type PaymentStatus =
  | "FAILED"
  | "RECOVERY_PENDING"
  | "PENDING_REVIEW"
  | "AUTHORIZED"
  | "CAPTURED"
  | "CAPTURED_AFTER_FAILURE"
  | "RECOVERY_CANCELLED"
  | "ESCALATED"
  | "BLOCKED";

export interface PaymentRow {
  id: string;
  payment_ref: string;
  amount: number;
  currency: string;
  method: string | null;
  bank: string | null;
  psp: string | null;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

/** Payments for a tenant (viewer+). Status is the server-folded current state. */
export async function fetchPayments(
  tenantId: string,
  opts: { limit?: number; status?: PaymentStatus } = {},
): Promise<SupabaseResult<PaymentRow[]>> {
  if (!supabase) return configError();
  try {
    let query = supabase
      .from("payments")
      .select(
        "id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.limit) query = query.limit(opts.limit);
    const { data, error } = await query;
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: (data ?? []) as unknown as PaymentRow[] };
  } catch (err) {
    return requestError(err);
  }
}

export interface PaymentEventRow {
  id: string;
  payment_id: string;
  provider_event_id: string;
  event_type: string;
  occurred_at: string;
  raw_payload: Record<string, unknown>;
}

/** Full persisted event history for one payment, chronological (viewer+). */
export async function fetchPaymentEvents(
  paymentId: string,
): Promise<SupabaseResult<PaymentEventRow[]>> {
  if (!supabase) return configError();
  try {
    const { data, error } = await supabase
      .from("payment_events")
      .select("id, payment_id, provider_event_id, event_type, occurred_at, raw_payload")
      .eq("payment_id", paymentId)
      .order("occurred_at", { ascending: true });
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: (data ?? []) as unknown as PaymentEventRow[] };
  } catch (err) {
    return requestError(err);
  }
}

/** True when a Supabase session exists (used before showing data panels). */
export async function hasSupabaseSession(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

// ── Dashboard metrics ──────────────────────────────────────────────

export interface DashboardMetrics {
  totalPayments: number;
  totalVolume: number;
  successRate: number;
  underReview: number;
  statusDistribution: Record<string, number>;
}

/** Aggregate dashboard metrics for a tenant. */
export async function fetchDashboardMetrics(
  tenantId: string,
): Promise<SupabaseResult<DashboardMetrics>> {
  if (!supabase) return configError();
  try {
    const { data: payments, error } = await supabase
      .from("payments")
      .select("status, amount")
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, reason: "request", error: error.message };
    const rows = (payments ?? []) as { status: string; amount: number }[];
    const totalPayments = rows.length;
    const totalVolume = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const captured = rows.filter((r) => r.status === "CAPTURED" || r.status === "CAPTURED_AFTER_FAILURE").length;
    const successRate = totalPayments > 0 ? captured / totalPayments : 0;
    const underReview = rows.filter((r) => r.status === "PENDING_REVIEW").length;
    const statusDistribution: Record<string, number> = {};
    for (const r of rows) {
      statusDistribution[r.status] = (statusDistribution[r.status] ?? 0) + 1;
    }
    return {
      ok: true,
      data: { totalPayments, totalVolume, successRate, underReview, statusDistribution },
    };
  } catch (err) {
    return requestError(err);
  }
}

// ── Situations ─────────────────────────────────────────────────────

export interface SituationRow {
  id: string;
  kind: string;
  severity: string;
  description: string | null;
  resolved: boolean;
  created_at: string;
  payment_id: string | null;
}

/** Fetch situations for a tenant. */
export async function fetchSituations(
  tenantId: string,
  opts: { limit?: number; resolved?: boolean } = {},
): Promise<SupabaseResult<SituationRow[]>> {
  if (!supabase) return configError();
  try {
    let query = supabase
      .from("situations")
      .select("id, kind, severity, description, resolved, created_at, payment_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (opts.resolved !== undefined) query = query.eq("resolved", opts.resolved);
    if (opts.limit) query = query.limit(opts.limit);
    const { data, error } = await query;
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: (data ?? []) as unknown as SituationRow[] };
  } catch (err) {
    return requestError(err);
  }
}

// ── User roles (admin panel) ───────────────────────────────────────

export interface UserRoleRow {
  user_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
}

/** Fetch user roles for a tenant (admin+). */
export async function fetchUserRoles(
  tenantId: string,
): Promise<SupabaseResult<UserRoleRow[]>> {
  if (!supabase) return configError();
  try {
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, reason: "request", error: error.message };
    // Enrich with profile data
    const rows = (data ?? []) as { user_id: string; role: string; created_at: string }[];
    const enriched: UserRoleRow[] = [];
    for (const row of rows) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", row.user_id)
        .single();
      enriched.push({
        ...row,
        full_name: profile?.full_name ?? null,
        email: null, // email is in auth.users, not accessible via RLS
      });
    }
    return { ok: true, data: enriched };
  } catch (err) {
    return requestError(err);
  }
}

// ── Payment detail (single payment + events) ───────────────────────

/** Fetch a single payment by ID (viewer+). */
export async function fetchPaymentById(
  paymentId: string,
): Promise<SupabaseResult<PaymentRow | null>> {
  if (!supabase) return configError();
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("id, payment_ref, amount, currency, method, bank, psp, status, created_at, updated_at")
      .eq("id", paymentId)
      .single();
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: data as unknown as PaymentRow };
  } catch (err) {
    return requestError(err);
  }
}

// ── Policies ───────────────────────────────────────────────────────

export interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  rule: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

/** Fetch policies for a tenant. */
export async function fetchPolicies(
  tenantId: string,
): Promise<SupabaseResult<PolicyRow[]>> {
  if (!supabase) return configError();
  try {
    const { data, error } = await supabase
      .from("policies")
      .select("id, name, description, rule, enabled, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, reason: "request", error: error.message };
    return { ok: true, data: (data ?? []) as unknown as PolicyRow[] };
  } catch (err) {
    return requestError(err);
  }
}
