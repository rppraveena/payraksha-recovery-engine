/**
 * PayRaksha Pipeline Runner — Process seeded data and report metrics
 *
 * This script fetches all payments and events from the database,
 * runs each payment through the full pipeline, and reports aggregate metrics.
 */

import { processPayment } from "./pipeline";
import type { PipelineMetrics } from "./types";
import { detectSystemicPatterns } from "./situation-engine";
import type { RawPaymentEvent } from "./types";

interface PaymentRow {
  id: string;
  payment_ref: string;
  amount: number;
  currency: string;
  method: string | null;
  bank: string | null;
  psp: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  payment_id: string;
  provider_event_id: string;
  event_type: string;
  occurred_at: string;
  amount: number | null;
  currency: string | null;
  method: string | null;
  bank: string | null;
  psp: string | null;
  error_code: string | null;
  error_description: string | null;
  raw_payload: Record<string, unknown>;
}

/**
 * Process all payments and return metrics.
 * Call this from a script that provides payments and events.
 */
export async function runPipeline(
  payments: PaymentRow[],
  eventsByPayment: Map<string, EventRow[]>,
  tenantId: string,
  recoveryRate: number,
): Promise<{
  metrics: PipelineMetrics;
  summary: string[];
}> {
  const summary: string[] = [];
  let dailyActionCount = 0;

  // Pre-compute systemic pattern detection
  const allEvents = Array.from(eventsByPayment.values()).flat();
  const recentFailures = allEvents.filter(
    (e) => e.event_type === "payment.failed",
  ).length;
  const baselineFailures = Math.max(4, Math.floor(recentFailures / 10));
  const systemicSituation = detectSystemicPatterns(
    tenantId,
    recentFailures,
    baselineFailures,
    10,
  );
  const activeIncidents = systemicSituation ? [systemicSituation] : [];

  if (systemicSituation) {
    summary.push(`⚠ SYSTEMIC INCIDENT: ${recentFailures} failures vs baseline ${baselineFailures}`);
  }

  // Track metrics
  let eventsProcessed = 0;
  let duplicatesPrevented = 0;
  let stateConflicts = 0;
  let situationsDetected = 0;
  let paymentsSentToReview = 0;
  let actionsBlocked = 0;
  let recoveriesAttempted = 0;
  let recoveriesVerified = 0;
  let recoveredRevenue = 0;
  let unrecoveredRecoverable = 0;

  const bySituationLevel: Record<string, number> = {
    LEVEL_1_PAYMENT: 0,
    LEVEL_2_RECOVERY: 0,
    LEVEL_3_SYSTEMIC: systemicSituation ? 1 : 0,
    LEVEL_4_STATE_CONFLICT: 0,
  };
  const byFailureType: Record<string, number> = {};
  const byAction: Record<string, number> = {};

  // Process each payment
  for (const payment of payments) {
    const events = eventsByPayment.get(payment.id) ?? [];
    if (events.length === 0) continue;

    const rawEvents: RawPaymentEvent[] = events.map((e) => ({
      ...e,
      tenant_id: tenantId,
      amount: e.amount ?? undefined,
      currency: e.currency ?? undefined,
      method: e.method ?? undefined,
      bank: e.bank ?? undefined,
      psp: e.psp ?? undefined,
      error_code: e.error_code ?? undefined,
      error_description: e.error_description ?? undefined,
    }));

    const result = await processPayment(
      tenantId,
      payment.id,
      payment.payment_ref,
      payment.status,
      rawEvents,
      {
        tenant_id: tenantId,
        total_payments: payments.length,
        recovered: payments.filter((p) => p.status === "CAPTURED_AFTER_FAILURE").length,
        failed: payments.filter((p) => p.status === "FAILED").length,
        escalated: payments.filter((p) => p.status === "ESCALATED").length,
        blocked: payments.filter((p) => p.status === "BLOCKED").length,
        recovery_rate: recoveryRate,
        avg_recovery_hours: 4.2,
      },
      activeIncidents,
      dailyActionCount,
    );

    // Aggregate from audit entries
    const dedupDetails = result.audit_entries[0]?.details as Record<string, unknown> | undefined;
    eventsProcessed += (dedupDetails?.total_events as number) ?? events.length;
    duplicatesPrevented += (dedupDetails?.duplicates_prevented as number) ?? 0;

    if (result.situation) {
      situationsDetected++;
      bySituationLevel[result.situation.level] = (bySituationLevel[result.situation.level] ?? 0) + 1;
    }

    if (result.situation?.kind === "STATE_CONFLICT") {
      stateConflicts++;
    }

    if (result.diagnosis) {
      byFailureType[result.diagnosis.failure_type] = (byFailureType[result.diagnosis.failure_type] ?? 0) + 1;
    }

    if (result.policy) {
      byAction[result.policy.action] = (byAction[result.policy.action] ?? 0) + 1;

      if (result.policy.action === "customer_action_required" || result.policy.action === "escalate") {
        paymentsSentToReview++;
      }
    }

    if (result.guardrails && !result.guardrails.allowed) {
      actionsBlocked++;
    }

    if (result.execution?.status === "executed") {
      recoveriesAttempted++;
      dailyActionCount++;
    }

    if (result.verification?.is_recovered) {
      recoveriesVerified++;
      recoveredRevenue += result.recovery_value?.amount ?? 0;
    }

    if (
      result.recovery_value?.expected_recovered_value &&
      result.recovery_value.expected_recovered_value > 0 &&
      !result.verification?.is_recovered
    ) {
      unrecoveredRecoverable += result.recovery_value.expected_recovered_value;
    }
  }

  const metrics: PipelineMetrics = {
    events_processed: eventsProcessed,
    duplicates_prevented: duplicatesPrevented,
    state_conflicts: stateConflicts,
    situations_detected: situationsDetected,
    payments_sent_to_review: paymentsSentToReview,
    actions_blocked: actionsBlocked,
    recoveries_attempted: recoveriesAttempted,
    recoveries_verified: recoveriesVerified,
    recovered_revenue: recoveredRevenue,
    unrecovered_recoverable: unrecoveredRecoverable,
    systemic_incidents: systemicSituation ? 1 : 0,
    by_situation_level: bySituationLevel as PipelineMetrics["by_situation_level"],
    by_failure_type: byFailureType as PipelineMetrics["by_failure_type"],
    by_action: byAction as PipelineMetrics["by_action"],
  };

  // Build summary
  summary.push(`\n═══════════════════════════════════════════════════`);
  summary.push(`  PayRaksha Intelligence Engine — Pipeline Report`);
  summary.push(`═══════════════════════════════════════════════════`);
  summary.push(`\n📊 EVENTS`);
  summary.push(`  Events processed:          ${eventsProcessed}`);
  summary.push(`  Duplicates prevented:      ${duplicatesPrevented}`);
  summary.push(`\n🔍 STATE`);
  summary.push(`  State conflicts:           ${stateConflicts}`);
  summary.push(`\n⚡ SITUATIONS`);
  summary.push(`  Situations detected:       ${situationsDetected}`);
  summary.push(`    LEVEL_1_PAYMENT:         ${bySituationLevel.LEVEL_1_PAYMENT ?? 0}`);
  summary.push(`    LEVEL_2_RECOVERY:        ${bySituationLevel.LEVEL_2_RECOVERY ?? 0}`);
  summary.push(`    LEVEL_3_SYSTEMIC:        ${bySituationLevel.LEVEL_3_SYSTEMIC ?? 0}`);
  summary.push(`    LEVEL_4_STATE_CONFLICT:  ${bySituationLevel.LEVEL_4_STATE_CONFLICT ?? 0}`);
  summary.push(`\n🩺 DIAGNOSIS`);
  for (const [type, count] of Object.entries(byFailureType)) {
    summary.push(`    ${type}: ${count}`);
  }
  summary.push(`\n📋 POLICY`);
  summary.push(`  Payments sent to review:   ${paymentsSentToReview}`);
  summary.push(`  Actions blocked:           ${actionsBlocked}`);
  for (const [action, count] of Object.entries(byAction)) {
    summary.push(`    ${action}: ${count}`);
  }
  summary.push(`\n🔄 RECOVERY`);
  summary.push(`  Recoveries attempted:      ${recoveriesAttempted}`);
  summary.push(`  Recoveries verified:       ${recoveriesVerified}`);
  summary.push(`  Recovered revenue:         $${recoveredRevenue.toFixed(2)}`);
  summary.push(`  Unrecovered recoverable:   $${unrecoveredRecoverable.toFixed(2)}`);
  summary.push(`\n═══════════════════════════════════════════════════`);

  return { metrics, summary };
}
