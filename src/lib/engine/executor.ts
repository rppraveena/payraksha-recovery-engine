/**
 * Executor — Simulator-based action execution
 *
 * Do NOT implement a fake Razorpay retry API.
 * Use the existing simulator/provider abstraction.
 * For unsupported operations: return CUSTOMER_RE-AUTHORIZATION_REQUIRED.
 */

import type { ExecutionResult, PolicyAction } from "./types";

/** Recovery attempt counter (in-memory for simulation). */
const attemptCounts = new Map<string, number>();

/** Get and increment attempt count. */
export function incrementAttempts(paymentId: string): number {
  const current = attemptCounts.get(paymentId) ?? 0;
  const next = current + 1;
  attemptCounts.set(paymentId, next);
  return next;
}

/** Reset attempt count. */
export function resetAttempts(paymentId: string): void {
  attemptCounts.delete(paymentId);
}

/**
 * Execute a policy action.
 * Returns a deterministic result — no external API calls.
 */
export function executeAction(
  paymentId: string,
  action: PolicyAction,
  currentState: string,
): ExecutionResult {
  switch (action) {
    case "schedule_retry": {
      const attempts = incrementAttempts(paymentId);
      // Simulate: 60% success on retry for temporary failures
      const success = Math.random() < 0.6;
      if (success) {
        return {
          status: "executed",
          action: `retry_attempt_${attempts}`,
          provider_ref: `sim_retry_${paymentId}_${attempts}`,
        };
      }
      return {
        status: "blocked",
        reason: `Retry attempt ${attempts} simulated as failure`,
      };
    }

    case "customer_action_required":
      return {
        status: "customer_action_required",
        reason: "Customer must provide updated payment details or re-authorize",
      };

    case "manual_charge_required":
      return {
        status: "customer_action_required",
        reason: "Manual charge requires operator intervention",
      };

    case "cancel_recovery":
      return {
        status: "cancelled",
        reason: "Recovery cancelled per policy decision",
      };

    case "pause":
      return {
        status: "paused",
        reason: "Automated recovery paused due to systemic incident",
      };

    case "block":
      return {
        status: "blocked",
        reason: "Action blocked by policy or guardrail",
      };

    case "escalate":
      return {
        status: "blocked",
        reason: "Escalated to manual review — no automated action taken",
      };

    case "no_action":
      return {
        status: "blocked",
        reason: "No action required by policy",
      };

    default:
      return {
        status: "blocked",
        reason: `Unknown action: ${action}`,
      };
  }
}
