import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mocked query builder + server result, hoisted so vi.mock can use them.
const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as { message: string } | null },
}));

const query = vi.hoisted(() => {
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    insert: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
    single: vi.fn(() => q),
  };
  // PostgREST builders are thenable; resolve with the configured result.
  q.then = (resolve: (value: unknown) => void) => resolve(state.result);
  return q;
});

const from = vi.hoisted(() => vi.fn(() => query));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from })),
}));

// Fresh module instance per test so module-level env reads see stubbed values.
const importFresh = async () => {
  vi.resetModules();
  return await import("./supabase");
};

describe("supabase helpers (mocked client)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.result = { data: null, error: null };
    vi.unstubAllEnvs();
  });

  it("reports config reason when keys are missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const mod = await importFresh();
    const result = await mod.fetchAuditLog();
    expect(result).toEqual({
      ok: false,
      reason: "config",
      error: "Supabase keys are not configured.",
    });
    expect(mod.supabase).toBeNull();
    expect(mod.supabaseConfig.configured).toBe(false);
  });

  it("is configured when URL + publishable key are present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const mod = await importFresh();
    expect(mod.supabaseConfig.configured).toBe(true);
    expect(mod.supabase).not.toBeNull();
  });

  it("is configured when URL + anon key are present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon_test");
    const mod = await importFresh();
    expect(mod.supabaseConfig.configured).toBe(true);
  });

  it("fetchAuditLog returns rows ordered by created_at desc", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const rows = [
      { id: 2, created_at: "2026-01-02T00:00:00Z", workspace: null, actor: "a", event_type: "import", payload: null },
      { id: 1, created_at: "2026-01-01T00:00:00Z", workspace: "w", actor: "b", event_type: "login", payload: { x: 1 } },
    ];
    state.result = { data: rows, error: null };
    const mod = await importFresh();
    const result = await mod.fetchAuditLog(10);
    expect(result).toEqual({ ok: true, data: rows });
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(10);
  });

  it("fetchAuditLog maps PostgREST errors to a request failure", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    state.result = { data: null, error: { message: 'relation "audit_log" does not exist' } };
    const mod = await importFresh();
    const result = await mod.fetchAuditLog();
    expect(result).toEqual({ ok: false, reason: "request", error: 'relation "audit_log" does not exist' });
  });

  it("writeAuditLog inserts and returns the created row", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const row = {
      id: 7,
      created_at: "2026-01-03T00:00:00Z",
      workspace: null,
      actor: "op@x.io",
      event_type: "event.manual",
      payload: null,
    };
    state.result = { data: row, error: null };
    const mod = await importFresh();
    const result = await mod.writeAuditLog({ actor: "op@x.io", event_type: "event.manual" });
    expect(result).toEqual({ ok: true, data: row });
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "op@x.io", event_type: "event.manual", workspace: null, payload: null }),
    );
    expect(query.single).toHaveBeenCalled();
  });

  it("writeAuditLog maps insert errors to a request failure", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    state.result = { data: null, error: { message: "new row violates row-level security policy" } };
    const mod = await importFresh();
    const result = await mod.writeAuditLog({ actor: "x", event_type: "y" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("request");
      expect(result.error).toContain("row-level security");
    }
  });

  it("writeAuditLog surfaces unexpected exceptions as request failures", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    const mod = await importFresh();
    const result = await mod.writeAuditLog({ actor: "x", event_type: "y" });
    expect(result).toEqual({ ok: false, reason: "request", error: "network down" });
  });
});
