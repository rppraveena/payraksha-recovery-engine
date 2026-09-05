import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mocked server result + builder state, hoisted so vi.mock can use them.
const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as { message: string } | null },
  authUser: null as { id: string } | null,
}));

const query = vi.hoisted(() => {
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
  };
  // PostgREST builders are thenable; resolve with the configured result.
  q.then = (resolve: (value: unknown) => void) => resolve(state.result);
  return q;
});

const from = vi.hoisted(() => vi.fn(() => query));
const rpc = vi.hoisted(() => vi.fn(() => query));
const getUser = vi.hoisted(() =>
  vi.fn(async () => ({ data: { user: state.authUser }, error: null })),
);

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from, rpc, auth: { getUser } })),
}));

// Fresh module instance per test so module-level env reads see stubbed values.
const importFresh = async () => {
  vi.resetModules();
  return await import("./supabase");
};

const envs = {
  url: "https://example.supabase.co",
  key: "sb_publishable_test",
};

describe("supabase helpers — PayRaksha data layer (mocked client)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.result = { data: null, error: null };
    state.authUser = null;
    vi.unstubAllEnvs();
  });

  it("reports config reason when keys are missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const mod = await importFresh();
    expect(await mod.listMyTenants()).toEqual({
      ok: false,
      reason: "config",
      error: "Supabase keys are not configured.",
    });
    expect(await mod.fetchAuditEvents("t1")).toEqual({
      ok: false,
      reason: "config",
      error: "Supabase keys are not configured.",
    });
    expect(mod.supabase).toBeNull();
    expect(mod.supabaseConfig.configured).toBe(false);
  });

  it("is configured when URL + publishable key are present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    const mod = await importFresh();
    expect(mod.supabaseConfig.configured).toBe(true);
    expect(mod.supabase).not.toBeNull();
  });

  it("is configured when URL + anon key are present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon_test");
    const mod = await importFresh();
    expect(mod.supabaseConfig.configured).toBe(true);
  });

  it("listMyTenants returns tenants resolved server-side via RPC", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    const rows = [
      { tenant_id: "t1", slug: "demo", name: "Demo Tenant", role: "admin" },
    ];
    state.result = { data: rows, error: null };
    const mod = await importFresh();
    const result = await mod.listMyTenants();
    expect(result).toEqual({ ok: true, data: rows });
    expect(rpc).toHaveBeenCalledWith("list_my_tenants");
  });

  it("fetchAuditEvents filters by tenant and orders by occurred_at desc", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    const rows = [
      { id: "a", action: "payment.recovered", entity_type: null, entity_id: null, actor_role: "system", details: null, occurred_at: "2026-01-02T00:00:00Z" },
    ];
    state.result = { data: rows, error: null };
    const mod = await importFresh();
    const result = await mod.fetchAuditEvents("t1", 10);
    expect(result).toEqual({ ok: true, data: rows });
    expect(from).toHaveBeenCalledWith("audit_events");
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "t1");
    expect(query.order).toHaveBeenCalledWith("occurred_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(10);
  });

  it("fetchAuditEvents maps PostgREST errors to a request failure", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    state.result = { data: null, error: { message: "new row violates row-level security policy" } };
    const mod = await importFresh();
    const result = await mod.fetchAuditEvents("t1");
    expect(result).toEqual({
      ok: false,
      reason: "request",
      error: "new row violates row-level security policy",
    });
  });

  it("fetchPayments applies tenant, optional status filter and limit", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    state.result = { data: [], error: null };
    const mod = await importFresh();
    const result = await mod.fetchPayments("t1", { status: "CAPTURED", limit: 5 });
    expect(result.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("payments");
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "t1");
    expect(query.eq).toHaveBeenCalledWith("status", "CAPTURED");
    expect(query.limit).toHaveBeenCalledWith(5);
  });

  it("fetchPaymentEvents returns the chronological event history", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    const rows = [
      { id: "e1", payment_id: "p1", provider_event_id: "evt_1", event_type: "payment.created", occurred_at: "2026-01-01T00:00:00Z", raw_payload: {} },
    ];
    state.result = { data: rows, error: null };
    const mod = await importFresh();
    const result = await mod.fetchPaymentEvents("p1");
    expect(result).toEqual({ ok: true, data: rows });
    expect(query.eq).toHaveBeenCalledWith("payment_id", "p1");
    expect(query.order).toHaveBeenCalledWith("occurred_at", { ascending: true });
  });

  it("hasSupabaseSession reports false without keys and without a user", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const mod = await importFresh();
    expect(await mod.hasSupabaseSession()).toBe(false);

    vi.unstubAllEnvs();
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    state.authUser = null;
    const mod2 = await importFresh();
    expect(await mod2.hasSupabaseSession()).toBe(false);
    expect(getUser).toHaveBeenCalled();
  });

  it("hasSupabaseSession is true when a session user exists", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", envs.url);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envs.key);
    state.authUser = { id: "u1" };
    const mod = await importFresh();
    expect(await mod.hasSupabaseSession()).toBe(true);
  });
});
