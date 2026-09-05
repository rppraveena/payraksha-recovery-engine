import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase (Postgres) integration for Meridian.
 *
 * The client is created lazily from Vite environment variables:
 *   - VITE_SUPABASE_URL        — Project URL, e.g. https://abc123.supabase.co
 *   - VITE_SUPABASE_ANON_KEY          — Public anon key (preferred)
 *   - VITE_SUPABASE_PUBLISHABLE_KEY   — Same value under Supabase's new key name; used as fallback
 *
 * Add both in the project's Keys tab. Until they exist the app keeps working
 * and every helper returns { ok: false, reason: "config" } so callers can
 * render a clear "connect Supabase" state.
 *
 * Expected schema (run once in the Supabase SQL editor):
 *   create table if not exists audit_log (
 *     id bigint generated always as identity primary key,
 *     created_at timestamptz not null default now(),
 *     workspace text,
 *     actor text not null,
 *     event_type text not null,
 *     payload jsonb
 *   );
 *   alter table audit_log enable row level security;
 *   create policy "anon can read audit_log" on audit_log
 *     for select using (true);
 *   create policy "anon can insert audit_log" on audit_log
 *     for insert with check (true);
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

export interface AuditRow {
  id: number;
  created_at: string;
  workspace: string | null;
  actor: string;
  event_type: string;
  payload: Record<string, unknown> | null;
}

/** Fetch the most recent rows from the `audit_log` table. */
export async function fetchAuditLog(limit = 25): Promise<SupabaseResult<AuditRow[]>> {
  if (!supabase) {
    return {
      ok: false,
      reason: "config",
      error: "Supabase keys are not configured.",
    };
  }
  try {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      return { ok: false, reason: "request", error: error.message };
    }
    return { ok: true, data: (data ?? []) as unknown as AuditRow[] };
  } catch (err) {
    return {
      ok: false,
      reason: "request",
      error: err instanceof Error ? err.message : "Unexpected Supabase error.",
    };
  }
}

/** Insert one row into the `audit_log` table. */
export async function writeAuditLog(
  entry: {
    workspace?: string;
    actor: string;
    event_type: string;
    payload?: Record<string, unknown>;
  },
): Promise<SupabaseResult<AuditRow>> {
  if (!supabase) {
    return {
      ok: false,
      reason: "config",
      error: "Supabase keys are not configured.",
    };
  }
  try {
    const { data, error } = await supabase
      .from("audit_log")
      .insert({
        workspace: entry.workspace ?? null,
        actor: entry.actor,
        event_type: entry.event_type,
        payload: entry.payload ?? null,
      })
      .select()
      .single();
    if (error) {
      return { ok: false, reason: "request", error: error.message };
    }
    return { ok: true, data: data as unknown as AuditRow };
  } catch (err) {
    return {
      ok: false,
      reason: "request",
      error: err instanceof Error ? err.message : "Unexpected Supabase error.",
    };
  }
}