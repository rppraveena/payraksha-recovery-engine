/**
 * PayRaksha payment state contract.
 *
 * Current payment state is ALWAYS derived from persisted payment_events plus
 * this explicit transition contract. Nothing in the app may write
 * payments.status directly — the only way status changes is by ingesting a new
 * event and re-applying this reducer.
 */

export const PAYMENT_STATES = [
  "FAILED",
  "RECOVERY_PENDING",
  "PENDING_REVIEW",
  "AUTHORIZED",
  "CAPTURED",
  "CAPTURED_AFTER_FAILURE",
  "RECOVERY_CANCELLED",
  "ESCALATED",
  "BLOCKED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Raw event types a provider may emit; normalized into payment_events. */
export const PAYMENT_EVENT_TYPES = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.expired",
  "recovery.initiated",
  "recovery.cancelled",
  "review.queued",
  "review.approved",
  "review.rejected",
  "system.escalated",
  "system.blocked",
  "system.released",
] as const;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/**
 * The explicit transition contract: event type -> next state from each
 * current state. Absent = invalid transition from that state.
 */
export const TRANSITIONS: Record<PaymentEventType, Partial<Record<PaymentState, PaymentState>>> = {
  "payment.created": {
    FAILED: "PENDING_REVIEW",
  },
  "payment.authorized": {
    FAILED: "AUTHORIZED",
    PENDING_REVIEW: "AUTHORIZED",
  },
  "payment.captured": {
    FAILED: "CAPTURED_AFTER_FAILURE",
    AUTHORIZED: "CAPTURED",
    PENDING_REVIEW: "CAPTURED",
    RECOVERY_PENDING: "CAPTURED_AFTER_FAILURE",
  },
  "payment.failed": {
    AUTHORIZED: "RECOVERY_PENDING",
    PENDING_REVIEW: "FAILED",
    RECOVERY_PENDING: "RECOVERY_PENDING",
  },
  "payment.expired": {
    AUTHORIZED: "RECOVERY_PENDING",
    RECOVERY_PENDING: "FAILED",
    PENDING_REVIEW: "FAILED",
  },
  "recovery.initiated": {
    FAILED: "RECOVERY_PENDING",
    AUTHORIZED: "RECOVERY_PENDING",
    RECOVERY_PENDING: "RECOVERY_PENDING", // idempotent: already in recovery
  },
  "recovery.cancelled": {
    RECOVERY_PENDING: "RECOVERY_CANCELLED",
  },
  "review.queued": {
    FAILED: "PENDING_REVIEW",
    AUTHORIZED: "PENDING_REVIEW",
    RECOVERY_PENDING: "PENDING_REVIEW",
    RECOVERY_CANCELLED: "PENDING_REVIEW",
  },
  "review.approved": {
    PENDING_REVIEW: "RECOVERY_PENDING",
  },
  "review.rejected": {
    PENDING_REVIEW: "FAILED",
  },
  "system.escalated": {
    RECOVERY_PENDING: "ESCALATED",
    PENDING_REVIEW: "ESCALATED",
    FAILED: "ESCALATED",
  },
  "system.blocked": {
    FAILED: "BLOCKED",
    RECOVERY_PENDING: "BLOCKED",
    PENDING_REVIEW: "BLOCKED",
    AUTHORIZED: "BLOCKED",
  },
  "system.released": {
    BLOCKED: "RECOVERY_PENDING",
    ESCALATED: "RECOVERY_PENDING",
    RECOVERY_CANCELLED: "RECOVERY_PENDING",
  },
};

/**
 * States that can no longer change. Both capture outcomes are terminal (funds
 * are captured; refunds are a separate domain). BLOCKED is deliberately NOT
 * terminal — a super admin may release it via system.released.
 */
export const TERMINAL_STATES: readonly PaymentState[] = ["CAPTURED", "CAPTURED_AFTER_FAILURE"];

export function isTerminalState(state: PaymentState): boolean {
  return TERMINAL_STATES.includes(state);
}

export interface PaymentEventInput {
  /** e.g. "evt_123" — used only by the caller for dedup; the reducer ignores it. */
  eventId?: string;
  type: string;
  timestamp: string | number | Date;
  /** Raw provider payload preserved for audit; the reducer reads whitelisted fields. */
  payload?: Record<string, unknown>;
}

export type ApplyEventResult =
  | { ok: true; state: PaymentState }
  | { ok: false; error: string; code: "unknown-event-type" | "unknown-state" | "invalid-transition" };

/**
 * Apply a single normalized event to the current state.
 * Pure function — no persistence, no side effects.
 */
export function applyEvent(state: PaymentState, event: PaymentEventInput): ApplyEventResult {
  if (!PAYMENT_EVENT_TYPES.includes(event.type as PaymentEventType)) {
    return { ok: false, error: `Unknown event type: ${event.type}`, code: "unknown-event-type" };
  }
  if (!PAYMENT_STATES.includes(state)) {
    return { ok: false, error: `Unknown state: ${state}`, code: "unknown-state" };
  }
  const type = event.type as PaymentEventType;
  const next = TRANSITIONS[type][state];
  if (!next) {
    return {
      ok: false,
      error: `Invalid transition: ${event.type} not allowed from ${state}`,
      code: "invalid-transition",
    };
  }
  return { ok: true, state: next };
}

export interface FoldResult {
  /** Final state, or null when no event could be applied (unknown state). */
  state: PaymentState | null;
  applied: number;
  conflicts: { event: PaymentEventInput; error: string; code: string }[];
}

/**
 * Fold a chronologically ordered list of events into a final state.
 * Used to reconstruct payments.status from payment_events; conflict/error
 * entries must be surfaced for the situation-detection pipeline, never swallowed.
 */
export function foldEvents(
  events: readonly PaymentEventInput[],
  initialState: PaymentState = "PENDING_REVIEW",
): FoldResult {
  const result: FoldResult = {
    state: null,
    applied: 0,
    conflicts: [],
  };
  let current: PaymentState | null = initialState;
  for (const event of events) {
    const res = applyEvent(current ?? initialState, event);
    if (res.ok) {
      current = res.state;
      result.applied++;
    } else {
      result.conflicts.push({ event, error: res.error, code: res.code });
    }
  }
  result.state = result.applied > 0 ? current : null;
  return result;
}

/**
 * Deduplicate events by provider_event_id, keeping the first occurrence.
 * Uniqueness key: (tenant_id, provider_event_id) in the database.
 */
export function dedupeEvents<T extends { eventId?: string; type: string }>(events: readonly T[]): {
  unique: T[];
  duplicates: T[];
} {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const event of events) {
    const key = event.eventId ?? `${event.type}:no-id`;
    if (seen.has(key)) {
      duplicates.push(event);
    } else {
      seen.add(key);
      unique.push(event);
    }
  }
  return { unique, duplicates };
}
