/**
 * Policy Engine — Determine candidate actions from rules
 *
 * Policies produce: schedule_retry, customer_action_required,
 * manual_charge_required, cancel_recovery, pause, block, escalate, no_action.
 *
 * The AI cannot bypass policy.
 */

import type { PolicyAction, PolicyDecision, FailureType } from "./types";
import type { DiagnosisResult, DetectedSituation } from "./types";

/** Policy rule: condition → action mapping. */
interface PolicyRule {
  condition: (ctx: PolicyContext) => boolean;
  action: PolicyAction;
  reason: string;
}

interface PolicyContext {
  failure_type: FailureType;
  diagnosis_confidence: number;
  current_state: string;
  attempt_count: number;
  is_expired_card: boolean;
  is_network_error: boolean;
  is_systemic: boolean;
  amount: number;
  has_customer_action: boolean;
}

/** Default policy rules (version 1). */
const DEFAULT_RULES: PolicyRule[] = [
  // Expired card → customer must re-authorize
  {
    condition: (ctx) => ctx.is_expired_card,
    action: "customer_action_required",
    reason: "Card expired — customer must provide new card details",
  },
  // Systemic incident → pause automated recovery
  {
    condition: (ctx) => ctx.is_systemic,
    action: "pause",
    reason: "Systemic PSP incident detected — pausing automated recovery",
  },
  // Network error with low confidence → schedule retry
  {
    condition: (ctx) => ctx.is_network_error && ctx.attempt_count < 3,
    action: "schedule_retry",
    reason: "Temporary network error — scheduling retry",
  },
  // Network error with max attempts → escalate
  {
    condition: (ctx) => ctx.is_network_error && ctx.attempt_count >= 3,
    action: "escalate",
    reason: "Network error after maximum retry attempts",
  },
  // UNKNOWN failure with low confidence → manual review
  {
    condition: (ctx) =>
      ctx.failure_type === "UNKNOWN" && ctx.diagnosis_confidence < 0.5,
    action: "customer_action_required",
    reason: "Unclassified failure — requires manual investigation",
  },
  // Insufficient balance → customer action required
  {
    condition: (ctx) => ctx.failure_type === "INSUFFICIENT_BALANCE",
    action: "customer_action_required",
    reason: "Insufficient balance — customer must ensure funds available",
  },
  // NACH bounce → manual charge required
  {
    condition: (ctx) => ctx.failure_type === "NACH_BOUNCE",
    action: "manual_charge_required",
    reason: "NACH mandate bounce — manual intervention required",
  },
  // Mandate revoked → cancel recovery
  {
    condition: (ctx) => ctx.failure_type === "MANDATE_REVOKED",
    action: "cancel_recovery",
    reason: "Mandate revoked — recovery impossible",
  },
  // Default: schedule retry for transient failures
  {
    condition: (ctx) =>
      ctx.failure_type === "TEMPORARY_TIMEOUT" && ctx.attempt_count < 5,
    action: "schedule_retry",
    reason: "Temporary timeout — scheduling retry",
  },
  // Fallback
  {
    condition: () => true,
    action: "escalate",
    reason: "No specific policy matched — escalating for manual review",
  },
];

/**
 * Evaluate policies against a payment's context.
 */
export function evaluatePolicy(
  paymentId: string,
  policyId: string,
  policyName: string,
  context: PolicyContext,
): PolicyDecision {
  for (const rule of DEFAULT_RULES) {
    if (rule.condition(context)) {
      return {
        payment_id: paymentId,
        action: rule.action,
        policy_id: policyId,
        policy_name: policyName,
        reason: rule.reason,
        parameters: {
          failure_type: context.failure_type,
          attempt_count: context.attempt_count,
          amount: context.amount,
        },
      };
    }
  }

  return {
    payment_id: paymentId,
    action: "no_action",
    policy_id: policyId,
    policy_name: policyName,
    reason: "No policy rule matched",
    parameters: {},
  };
}

/** Build policy context from available data. */
export function buildPolicyContext(
  currentState: string,
  diagnosis: FailureType,
  confidence: number,
  attemptCount: number,
  amount: number,
  situations: Array<{ kind: string }>,
): PolicyContext {
  const isSystemic = situations.some(
    (s) => s.kind === "SYSTEMIC_PATTERN_DETECTED",
  );
  return {
    failure_type: diagnosis,
    diagnosis_confidence: confidence,
    current_state: currentState,
    attempt_count: attemptCount,
    is_expired_card: diagnosis === "CARD_EXPIRED",
    is_network_error: diagnosis === "TEMPORARY_TIMEOUT" || diagnosis === "NETWORK_ERROR" || diagnosis === "GATEWAY_ERROR",
    is_systemic: isSystemic,
    amount,
    has_customer_action: false,
  };
}
