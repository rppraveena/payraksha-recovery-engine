/**
 * Situation Engine — Detect anomalies across 4 levels
 *
 * LEVEL_1_PAYMENT: per-payment anomalies (duplicates, expired cards)
 * LEVEL_2_RECOVERY: recovery-specific issues (loops, failures)
 * LEVEL_3_SYSTEMIC: cross-payment patterns (PSP degradation)
 * LEVEL_4_STATE_CONFLICT: persisted vs reconstructed state mismatch
 */

import type {
  DetectedSituation,
  SituationKind,
  SituationLevel,
} from "./types";
import type { ProcessedEvent, StateReconstruction } from "./types";

/** Error codes that indicate specific failure types. */
const EXPIRED_CARD_CODES = new Set([
  "EXPIRED_CARD",
  "CARD_EXPIRED",
  "expired",
  "14", // Stripe expired card
]);

const NETWORK_ERROR_CODES = new Set([
  "NETWORK_TIMEOUT",
  "GATEWAY_503",
  "TIMEOUT",
  "ECONNRESET",
]);

/**
 * Detect LEVEL_1 payment-level situations from event history.
 */
export function detectPaymentSituations(
  tenantId: string,
  paymentId: string,
  events: ProcessedEvent[],
  reconstruction: StateReconstruction,
  persistedStatus: string,
): DetectedSituation[] {
  const situations: DetectedSituation[] = [];
  const now = new Date().toISOString();

  // Duplicate events
  const duplicates = events.filter((e) => e.is_duplicate);
  if (duplicates.length > 0) {
    situations.push({
      payment_id: paymentId,
      tenant_id: tenantId,
      kind: "DUPLICATE_EVENT",
      level: "LEVEL_1_PAYMENT",
      severity: "medium",
      description: `${duplicates.length} duplicate event(s) received for this payment`,
      metadata: {
        duplicate_count: duplicates.length,
        duplicate_ids: duplicates.map((d) => d.raw.provider_event_id),
      },
    });
  }

  // Failed events with expired card
  const failedEvents = events.filter(
    (e) =>
      !e.is_duplicate &&
      (e.raw.event_type === "payment.failed" || e.normalized_type === "payment.failed"),
  );
  for (const fe of failedEvents) {
    const errCode = (fe.raw.error_code ?? "").toUpperCase();
    if (EXPIRED_CARD_CODES.has(errCode)) {
      situations.push({
        payment_id: paymentId,
        tenant_id: tenantId,
        kind: "CARD_EXPIRED",
        level: "LEVEL_1_PAYMENT",
        severity: "high",
        description: `Payment failed with expired card: ${fe.raw.error_code}`,
        metadata: { error_code: fe.raw.error_code, event_id: fe.raw.id },
      });
    } else if (NETWORK_ERROR_CODES.has(errCode)) {
      situations.push({
        payment_id: paymentId,
        tenant_id: tenantId,
        kind: "RECOVERY_FAILURE",
        level: "LEVEL_1_PAYMENT",
        severity: "low",
        description: `Temporary network error: ${fe.raw.error_code}`,
        metadata: { error_code: fe.raw.error_code, event_id: fe.raw.id },
      });
    }
  }

  // High-value failures (>$5000)
  const paymentAmount = events[0]?.raw.amount ?? 0;
  if (paymentAmount > 5000 && failedEvents.length > 0) {
    situations.push({
      payment_id: paymentId,
      tenant_id: tenantId,
      kind: "HIGH_VALUE_FAILURE",
      level: "LEVEL_1_PAYMENT",
      severity: "high",
      description: `High-value payment ($${paymentAmount}) failed`,
      metadata: { amount: paymentAmount, failure_count: failedEvents.length },
    });
  }

  // Recovery loop (3+ recovery.initiated events)
  const recoveryEvents = events.filter(
    (e) =>
      !e.is_duplicate && e.normalized_type === "recovery.initiated",
  );
  if (recoveryEvents.length >= 3) {
    situations.push({
      payment_id: paymentId,
      tenant_id: tenantId,
      kind: "RECOVERY_LOOP",
      level: "LEVEL_2_RECOVERY",
      severity: "high",
      description: `Recovery loop detected: ${recoveryEvents.length} recovery attempts`,
      metadata: { recovery_attempt_count: recoveryEvents.length },
    });
  }

  return situations;
}

/**
 * Detect LEVEL_4 state conflict between persisted and reconstructed state.
 */
export function detectStateConflictSituation(
  tenantId: string,
  paymentId: string,
  reconstruction: StateReconstruction,
  persistedStatus: string,
): DetectedSituation | null {
  if (!reconstruction.final_state) return null;
  if (reconstruction.final_state === persistedStatus) return null;

  return {
    payment_id: paymentId,
    tenant_id: tenantId,
    kind: "STATE_CONFLICT",
    level: "LEVEL_4_STATE_CONFLICT",
    severity: "critical",
    description: `Persisted status ${persistedStatus} conflicts with reconstructed state ${reconstruction.final_state}`,
    metadata: {
      persisted_status: persistedStatus,
      reconstructed_state: reconstruction.final_state,
      events_applied: reconstruction.events_applied,
    },
  };
}

/**
 * Detect LEVEL_3 systemic patterns across multiple payments.
 * Compares current failure rate to a baseline window.
 */
export function detectSystemicPatterns(
  tenantId: string,
  recentFailures: number,
  baselineFailures: number,
  windowMinutes: number,
): DetectedSituation | null {
  if (baselineFailures === 0) return null;

  const ratio = recentFailures / baselineFailures;
  if (ratio < 5) return null; // 5x baseline = systemic

  return {
    payment_id: "", // systemic, not per-payment
    tenant_id: tenantId,
    kind: "SYSTEMIC_PATTERN_DETECTED",
    level: "LEVEL_3_SYSTEMIC",
    severity: "critical",
    description: `Systemic pattern: ${recentFailures} failures in ${windowMinutes}min vs baseline of ${baselineFailures}`,
    metadata: {
      recent_failures: recentFailures,
      baseline_failures: baselineFailures,
      ratio: Math.round(ratio * 10) / 10,
      window_minutes: windowMinutes,
    },
  };
}
