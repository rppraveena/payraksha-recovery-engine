/**
 * Value Estimation — Expected Recovery Value (ERV)
 *
 * ERV = payment amount × historical observed recovery rate
 *
 * Recovery rate = successful eligible recovery attempts / eligible recovery attempts
 * Do NOT count organically captured payments as recovery successes.
 */

import type { RecoveryValueEstimate } from "./types";

/** Eligible recovery states (payments that were attempted for recovery). */
const ELIGIBLE_STATES = new Set([
  "FAILED",
  "RECOVERY_PENDING",
  "RECOVERY_CANCELLED",
]);

/** Successful recovery states (recovery actually worked). */
const RECOVERY_SUCCESS_STATES = new Set([
  "CAPTURED_AFTER_FAILURE",
]);

/** Recovery rate stats from the database. */
export interface RecoveryRateStats {
  tenant_id: string;
  total_payments: number;
  recovered: number;
  failed: number;
  escalated: number;
  blocked: number;
  recovery_rate: number | null;
  avg_recovery_hours: number | null;
}

/**
 * Calculate ERV for a payment based on historical recovery data.
 */
export function estimateRecoveryValue(
  paymentId: string,
  amount: number,
  currentStatus: string,
  stats: RecoveryRateStats | null,
): RecoveryValueEstimate {
  // If payment is already captured, ERV = amount (already recovered)
  if (currentStatus === "CAPTURED" || currentStatus === "CAPTURED_AFTER_FAILURE") {
    return {
      payment_id: paymentId,
      amount,
      historical_recovery_rate: 1,
      expected_recovered_value: amount,
      sample_size: 0,
      eligible_attempts: 0,
      successful_attempts: 0,
    };
  }

  // If not in an eligible recovery state, ERV = 0
  if (!ELIGIBLE_STATES.has(currentStatus)) {
    return {
      payment_id: paymentId,
      amount,
      historical_recovery_rate: 0,
      expected_recovered_value: 0,
      sample_size: 0,
      eligible_attempts: 0,
      successful_attempts: 0,
    };
  }

  // Use historical recovery rate
  const rate = stats?.recovery_rate ?? 0;
  const sampleSize = stats?.total_payments ?? 0;
  const eligibleAttempts = (stats?.failed ?? 0) + (stats?.recovered ?? 0);
  const successfulAttempts = stats?.recovered ?? 0;

  const erv = amount * rate;

  return {
    payment_id: paymentId,
    amount,
    historical_recovery_rate: rate,
    expected_recovered_value: Math.round(erv * 100) / 100,
    sample_size: sampleSize,
    eligible_attempts: eligibleAttempts,
    successful_attempts: successfulAttempts,
  };
}
