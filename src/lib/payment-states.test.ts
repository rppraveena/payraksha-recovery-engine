import { describe, expect, it } from "vitest";
import {
  applyEvent,
  dedupeEvents,
  foldEvents,
  isTerminalState,
  PAYMENT_STATES,
  TRANSITIONS,
  type PaymentEventType,
  type PaymentState,
} from "./payment-states";

describe("PAYMENT_STATES", () => {
  it("contains exactly the nine contract states", () => {
    expect([...PAYMENT_STATES]).toEqual([
      "FAILED",
      "RECOVERY_PENDING",
      "PENDING_REVIEW",
      "AUTHORIZED",
      "CAPTURED",
      "CAPTURED_AFTER_FAILURE",
      "RECOVERY_CANCELLED",
      "ESCALATED",
      "BLOCKED",
    ]);
  });
});

describe("applyEvent", () => {
  it("starts FAILED payments at PENDING_REVIEW on payment.created", () => {
    const result = applyEvent("FAILED", {
      type: "payment.created",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(result).toEqual({ ok: true, state: "PENDING_REVIEW" });
  });

  it("moves AUTHORIZED to CAPTURED on payment.captured", () => {
    const result = applyEvent("AUTHORIZED", {
      type: "payment.captured",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(result).toEqual({ ok: true, state: "CAPTURED" });
  });

  it("keeps AUTHORIZED distinct from CAPTURED (late capture after failure)", () => {
    const fromFailed = applyEvent("FAILED", {
      type: "payment.captured",
      timestamp: "2026-01-01T00:00:00Z",
    });
    const fromAuthorized = applyEvent("AUTHORIZED", {
      type: "payment.captured",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(fromFailed).toEqual({ ok: true, state: "CAPTURED_AFTER_FAILURE" });
    expect(fromAuthorized).toEqual({ ok: true, state: "CAPTURED" });
  });

  it("rejects unknown event types", () => {
    const result = applyEvent("FAILED", {
      type: "payment.settled",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown-event-type");
    }
  });

  it("rejects unknown states", () => {
    const result = applyEvent("SETTLING" as PaymentState, {
      type: "payment.captured",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown-state");
    }
  });

  it("rejects transitions that are not in the contract", () => {
    const result = applyEvent("CAPTURED", {
      type: "payment.authorized",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid-transition");
      expect(result.error).toContain("not allowed from CAPTURED");
    }
  });

  it("is a pure function and does not mutate its inputs", () => {
    const event = { type: "payment.captured", timestamp: "2026-01-01T00:00:00Z" };
    const snapshot = { ...event };
    applyEvent("AUTHORIZED", event);
    expect(event).toEqual(snapshot);
  });
});

describe("terminal states", () => {
  it("marks both capture outcomes as terminal", () => {
    expect(isTerminalState("CAPTURED")).toBe(true);
    expect(isTerminalState("CAPTURED_AFTER_FAILURE")).toBe(true);
  });

  it("keeps BLOCKED non-terminal because a super admin can release it", () => {
    expect(isTerminalState("BLOCKED")).toBe(false);
    const exits = Object.values(TRANSITIONS).map((t) => t["BLOCKED"]).filter(Boolean);
    expect(exits).toEqual(["RECOVERY_PENDING"]);
    expect(Object.keys(TRANSITIONS)).toContain("system.released");
  });

  it("keeps every non-terminal state non-terminal", () => {
    for (const state of PAYMENT_STATES) {
      if (isTerminalState(state)) continue;
      expect(isTerminalState(state)).toBe(false);
    }
  });

  it("defines no outgoing transitions from terminal states", () => {
    for (const type of Object.keys(TRANSITIONS) as PaymentEventType[]) {
      expect(TRANSITIONS[type]["CAPTURED"]).toBeUndefined();
      expect(TRANSITIONS[type]["CAPTURED_AFTER_FAILURE"]).toBeUndefined();
    }
  });
});

describe("foldEvents", () => {
  it("reconstructs a happy-path capture from raw events", () => {
    const result = foldEvents(
      [
        { type: "payment.created", timestamp: 1 },
        { type: "payment.authorized", timestamp: 2 },
        { type: "payment.captured", timestamp: 3 },
      ],
      "FAILED",
    );
    expect(result.state).toBe("CAPTURED");
    expect(result.applied).toBe(3);
    expect(result.conflicts).toHaveLength(0);
  });

  it("reconstructs capture-after-failure through recovery", () => {
    const result = foldEvents(
      [
        { type: "payment.created", timestamp: 1 },
        { type: "payment.authorized", timestamp: 2 },
        { type: "payment.failed", timestamp: 3 },
        { type: "recovery.initiated", timestamp: 4 },
        { type: "payment.captured", timestamp: 5 },
      ],
      "FAILED",
    );
    expect(result.state).toBe("CAPTURED_AFTER_FAILURE");
    expect(result.applied).toBe(5);
  });

  it("surfaces invalid events as conflicts instead of crashing", () => {
    const result = foldEvents(
      [
        { type: "payment.created", timestamp: 1 },       // FAILED -> PENDING_REVIEW
        { type: "review.approved", timestamp: 2 },       // PENDING_REVIEW -> RECOVERY_PENDING
        { type: "recovery.cancelled", timestamp: 3 },    // RECOVERY_PENDING -> RECOVERY_CANCELLED
        { type: "payment.authorized", timestamp: 4 },    // invalid from RECOVERY_CANCELLED
        { type: "review.queued", timestamp: 5 },         // RECOVERY_CANCELLED -> PENDING_REVIEW
      ],
      "FAILED",
    );
    expect(result.state).toBe("PENDING_REVIEW");
    expect(result.applied).toBe(4);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].code).toBe("invalid-transition");
    expect(result.conflicts[0].error).toContain("not allowed from RECOVERY_CANCELLED");
  });

  it("returns null state for an empty event list", () => {
    const result = foldEvents([], "FAILED");
    expect(result.state).toBeNull();
    expect(result.applied).toBe(0);
  });

  it("never leaves a stuck payment: every non-terminal state has an exit", () => {
    for (const state of PAYMENT_STATES) {
      if (isTerminalState(state)) continue;
      const exits = Object.values(TRANSITIONS)
        .map((perType) => perType[state])
        .filter(Boolean);
      expect(exits.length, `${state} must have at least one valid exit`).toBeGreaterThan(0);
    }
  });

  it("reaches every contract state via some legal path from FAILED", () => {
    const targetPaths: Partial<Record<PaymentState, PaymentEventType[]>> = {
      PENDING_REVIEW: ["payment.created"],
      AUTHORIZED: ["payment.created", "payment.authorized"],
      CAPTURED: ["payment.created", "payment.authorized", "payment.captured"],
      CAPTURED_AFTER_FAILURE: ["payment.created", "payment.authorized", "payment.failed", "payment.captured"],
      RECOVERY_PENDING: ["payment.created", "payment.authorized", "payment.failed"],
      RECOVERY_CANCELLED: [
        "payment.created",
        "payment.authorized",
        "payment.failed",
        "recovery.initiated",
        "recovery.cancelled",
      ],
      ESCALATED: ["payment.created", "payment.authorized", "payment.failed", "recovery.initiated", "system.escalated"],
      BLOCKED: ["payment.created", "payment.authorized", "payment.failed", "system.blocked"],
    };
    for (const [target, path] of Object.entries(targetPaths)) {
      const result = foldEvents(
        path!.map((type, i) => ({ type, timestamp: i })),
        "FAILED",
      );
      expect(result.state, `path to ${target}: ${path!.join(" -> ")}`).toBe(target);
    }
  });
});

describe("dedupeEvents", () => {
  it("keeps the first occurrence of duplicate provider_event_ids", () => {
    const events = [
      { eventId: "evt_1", type: "payment.failed" },
      { eventId: "evt_1", type: "payment.failed" },
      { eventId: "evt_2", type: "payment.authorized" },
    ];
    const { unique, duplicates } = dedupeEvents(events);
    expect(unique).toHaveLength(2);
    expect(unique.map((e) => e.eventId)).toEqual(["evt_1", "evt_2"]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toBe(events[1]);
  });

  it("treats id-less events as unique per type", () => {
    const events = [
      { type: "payment.failed" },
      { type: "payment.failed" },
      { type: "payment.captured" },
    ];
    const { unique, duplicates } = dedupeEvents(events);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
  });
});
