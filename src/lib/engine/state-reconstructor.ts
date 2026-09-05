/**
 * State Reconstructor — Fold events into current state
 *
 * Uses payment_events + state_transition_contract.
 * AUTHORIZED must remain distinct from CAPTURED.
 * payment.captured after payment.failed → CAPTURED_AFTER_FAILURE.
 */

import {
  applyEvent,
  foldEvents,
  isTerminalState,
  type PaymentEventInput,
  type PaymentState,
} from "@/lib/payment-states";
import type { ProcessedEvent, StateReconstruction, StateConflict } from "./types";

/**
 * Reconstruct the state for a payment from its processed events.
 * Only non-duplicate, valid-type events are folded.
 */
export function reconstructState(
  paymentId: string,
  processedEvents: ProcessedEvent[],
): StateReconstruction {
  const validEvents: PaymentEventInput[] = [];
  const conflicts: StateConflict[] = [];

  for (const pe of processedEvents) {
    if (pe.is_duplicate) continue;
    if (!pe.normalized_type) {
      conflicts.push({
        event_type: pe.raw.event_type,
        from_state: "PENDING_REVIEW", // unknown, default
        error: `Unknown event type: ${pe.raw.event_type}`,
        occurred_at: pe.raw.occurred_at,
      });
      continue;
    }

    validEvents.push({
      type: pe.normalized_type,
      timestamp: pe.raw.occurred_at,
      payload: pe.raw.raw_payload,
    });
  }

  const foldResult = foldEvents(validEvents, "PENDING_REVIEW");

  // Collect any fold conflicts
  for (const c of foldResult.conflicts) {
    conflicts.push({
      event_type: c.event.type,
      from_state: "PENDING_REVIEW",
      error: c.error,
      occurred_at: "",
    });
  }

  return {
    payment_id: paymentId,
    events_applied: foldResult.applied,
    final_state: foldResult.state,
    conflicts,
    terminal: foldResult.state ? isTerminalState(foldResult.state) : false,
  };
}

/**
 * Detect state conflicts between a persisted status and reconstructed state.
 */
export function detectStateConflict(
  persistedStatus: PaymentState,
  reconstructed: PaymentState | null,
): boolean {
  if (!reconstructed) return false;
  return persistedStatus !== reconstructed;
}
