/**
 * Verification — Never interpret an API call as payment success
 *
 * Verify the resulting payment state.
 * Only CAPTURED / verified successful recovery contributes to recovered revenue.
 */

import type { VerificationResult, ExecutionResult } from "./types";
import type { PaymentState } from "@/lib/payment-states";

/**
 * Verify a payment's state after an execution attempt.
 */
export function verifyPaymentState(
  paymentId: string,
  stateBefore: PaymentState | null,
  stateAfter: PaymentState | null,
  execution: ExecutionResult,
): VerificationResult {
  // If execution was blocked/paused/cancelled, no verification needed
  if (
    execution.status === "blocked" ||
    execution.status === "paused" ||
    execution.status === "cancelled"
  ) {
    return {
      payment_id: paymentId,
      verified_state: stateAfter,
      verified: true, // verified that no change occurred
      is_recovered: false,
      recovered_amount: 0,
    };
  }

  // If customer action required, not yet verified
  if (execution.status === "customer_action_required") {
    return {
      payment_id: paymentId,
      verified_state: stateAfter,
      verified: false,
      is_recovered: false,
      recovered_amount: 0,
    };
  }

  // Execution was executed — verify the state
  const isRecovered = stateAfter === "CAPTURED" || stateAfter === "CAPTURED_AFTER_FAILURE";

  return {
    payment_id: paymentId,
    verified_state: stateAfter,
    verified: true,
    is_recovered: isRecovered,
    recovered_amount: 0, // amount is added by the caller
  };
}
