/**
 * PayRaksha Pipeline Orchestrator
 *
 * EVENT → DEDUP → STATE RECONSTRUCTION → SITUATION → DIAGNOSIS →
 * VALUE ESTIMATION → POLICY → GUARDRAILS → EXECUTION → VERIFICATION → AUDIT
 */

import type {
  RawPaymentEvent,
  PipelineResult,
  PipelineMetrics,
  DetectedSituation,
  SituationLevel,
  FailureType,
  PolicyAction,
} from "./types";
import { processEvents, countUnique, countDuplicates } from "./event-processor";
import { reconstructState, detectStateConflict } from "./state-reconstructor";
import {
  detectPaymentSituations,
  detectStateConflictSituation,
  detectSystemicPatterns,
} from "./situation-engine";
import { diagnose } from "./diagnosis";
import { estimateRecoveryValue, type RecoveryRateStats } from "./value-estimation";
import { evaluatePolicy, buildPolicyContext } from "./policy-engine";
import { runGuardrails } from "./guardrails";
import { executeAction } from "./executor";
import { verifyPaymentState } from "./verification";
import { createAuditEntry } from "./audit";
type AuditEntry = Awaited<ReturnType<typeof createAuditEntry>>;
import type { PaymentState } from "@/lib/payment-states";

/** Genesis hash for audit chain. */
const GENESIS = "payraksha-genesis";

/**
 * Process a single payment through the full pipeline.
 */
export async function processPayment(
  tenantId: string,
  paymentId: string,
  paymentRef: string,
  persistedStatus: string,
  events: RawPaymentEvent[],
  recoveryStats: RecoveryRateStats | null,
  activeIncidents: DetectedSituation[],
  dailyActionCount: number,
): Promise<PipelineResult> {
  const auditEntries: AuditEntry[] = [];
  let chainHash = GENESIS;

  // ── Stage 1: Event Processing (Dedup) ──
  const processed = processEvents(events);
  const duplicates = countDuplicates(processed);

  const dedupEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "event_processing",
    "dedup",
    {
      total_events: events.length,
      unique_events: countUnique(processed),
      duplicates_prevented: duplicates,
    },
    chainHash,
  );
  auditEntries.push(dedupEntry);
  chainHash = dedupEntry.current_hash;

  // ── Stage 2: State Reconstruction ──
  const reconstruction = reconstructState(paymentId, processed);
  const reconstructedState = reconstruction.final_state;
  const stateConflict = detectStateConflict(
    persistedStatus as PaymentState,
    reconstructedState,
  );

  const stateEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "state_reconstruction",
    stateConflict ? "conflict_detected" : "state_verified",
    {
      persisted_status: persistedStatus,
      reconstructed_state: reconstructedState,
      events_applied: reconstruction.events_applied,
      conflicts: reconstruction.conflicts.length,
    },
    chainHash,
  );
  auditEntries.push(stateEntry);
  chainHash = stateEntry.current_hash;

  // ── Stage 3: Situation Engine ──
  const paymentSituations = detectPaymentSituations(
    tenantId,
    paymentId,
    processed,
    reconstruction,
    persistedStatus,
  );

  const stateConflictSituation = detectStateConflictSituation(
    tenantId,
    paymentId,
    reconstruction,
    persistedStatus,
  );
  if (stateConflictSituation) {
    paymentSituations.push(stateConflictSituation);
  }

  const primarySituation = paymentSituations[0] ?? null;

  const situationEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "situation_engine",
    paymentSituations.length > 0 ? "situations_detected" : "no_situations",
    {
      count: paymentSituations.length,
      kinds: paymentSituations.map((s) => s.kind),
      levels: paymentSituations.map((s) => s.level),
    },
    chainHash,
  );
  auditEntries.push(situationEntry);
  chainHash = situationEntry.current_hash;

  // ── Stage 4: Diagnosis ──
  const diagnosisResult = diagnose(paymentId, processed);

  const diagnosisEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "diagnosis",
    `failure_type_${diagnosisResult.failure_type}`,
    {
      failure_type: diagnosisResult.failure_type,
      confidence: diagnosisResult.confidence,
      source: diagnosisResult.source,
      evidence_count: diagnosisResult.evidence.length,
    },
    chainHash,
  );
  auditEntries.push(diagnosisEntry);
  chainHash = diagnosisEntry.current_hash;

  // ── Stage 5: Value Estimation ──
  const amount = events[0]?.amount ?? 0;
  const recoveryValue = estimateRecoveryValue(
    paymentId,
    amount,
    persistedStatus,
    recoveryStats,
  );

  const valueEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "value_estimation",
    "erv_calculated",
    {
      amount,
      historical_recovery_rate: recoveryValue.historical_recovery_rate,
      expected_recovered_value: recoveryValue.expected_recovered_value,
      sample_size: recoveryValue.sample_size,
    },
    chainHash,
  );
  auditEntries.push(valueEntry);
  chainHash = valueEntry.current_hash;

  // ── Stage 6: Policy Engine ──
  const attemptCount = processed.filter(
    (e) => e.normalized_type === "recovery.initiated",
  ).length;

  const allSituations = [...paymentSituations, ...activeIncidents];
  const policyContext = buildPolicyContext(
    persistedStatus,
    diagnosisResult.failure_type,
    diagnosisResult.confidence,
    attemptCount,
    amount,
    allSituations,
  );

  const policyDecision = evaluatePolicy(
    paymentId,
    "policy_v1",
    "Default PayRaksha Policy v1",
    policyContext,
  );

  const policyEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "policy_engine",
    `action_${policyDecision.action}`,
    {
      action: policyDecision.action,
      reason: policyDecision.reason,
      policy_id: policyDecision.policy_id,
    },
    chainHash,
  );
  auditEntries.push(policyEntry);
  chainHash = policyEntry.current_hash;

  // ── Stage 7: Guardrails ──
  const guardrailResult = runGuardrails(
    paymentId,
    policyDecision.action,
    persistedStatus,
    diagnosisResult.confidence,
    attemptCount,
    null, // lastAttemptTime
    dailyActionCount,
    activeIncidents,
    false, // hasActiveRecovery
  );

  const guardrailEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "guardrails",
    guardrailResult.allowed ? "passed" : "blocked",
    {
      allowed: guardrailResult.allowed,
      blocked_by: guardrailResult.blocked_by,
      checks: guardrailResult.checks.map((c) => ({
        name: c.name,
        passed: c.passed,
      })),
    },
    chainHash,
  );
  auditEntries.push(guardrailEntry);
  chainHash = guardrailEntry.current_hash;

  // ── Stage 8: Execution ──
  const execution = executeAction(
    paymentId,
    guardrailResult.allowed ? policyDecision.action : "block",
    persistedStatus,
  );

  // ── Stage 9: Verification ──
  const verification = verifyPaymentState(
    paymentId,
    reconstructedState,
    reconstructedState, // state doesn't change in simulation
    execution,
  );

  const execEntry = await createAuditEntry(
    tenantId,
    paymentId,
    "execution",
    execution.status,
    {
      action: policyDecision.action,
      status: execution.status,
      reason: "reason" in execution ? execution.reason : execution.action,
      verified: verification.verified,
      is_recovered: verification.is_recovered,
    },
    chainHash,
  );
  auditEntries.push(execEntry);
  chainHash = execEntry.current_hash;

  return {
    payment_id: paymentId,
    event_type: events[0]?.event_type ?? "unknown",
    state_before: persistedStatus as PaymentState,
    state_after: reconstructedState,
    situation: primarySituation,
    diagnosis: diagnosisResult,
    recovery_value: recoveryValue,
    policy: policyDecision,
    guardrails: guardrailResult,
    execution,
    verification,
    audit_entries: auditEntries,
  };
}

/**
 * Process all payments for a tenant and aggregate metrics.
 */
export async function processAllPayments(
  tenantId: string,
  payments: Array<{
    id: string;
    payment_ref: string;
    status: string;
    amount: number;
  }>,
  eventsByPayment: Map<string, RawPaymentEvent[]>,
  recoveryStats: RecoveryRateStats | null,
): Promise<{ results: PipelineResult[]; metrics: PipelineMetrics }> {
  const results: PipelineResult[] = [];
  let dailyActionCount = 0;

  // Detect systemic patterns first
  const allEvents = Array.from(eventsByPayment.values()).flat();
  const recentFailures = allEvents.filter(
    (e) => e.event_type === "payment.failed",
  ).length;
  const systemicSituation = detectSystemicPatterns(
    tenantId,
    recentFailures,
    recentFailures > 20 ? Math.floor(recentFailures / 10) : recentFailures,
    10,
  );
  const activeIncidents = systemicSituation ? [systemicSituation] : [];

  for (const payment of payments) {
    const events = eventsByPayment.get(payment.id) ?? [];
    if (events.length === 0) continue;

    const result = await processPayment(
      tenantId,
      payment.id,
      payment.payment_ref,
      payment.status,
      events,
      recoveryStats,
      activeIncidents,
      dailyActionCount,
    );

    results.push(result);

    if (
      result.execution?.status === "executed"
    ) {
      dailyActionCount++;
    }
  }

  // Aggregate metrics
  const metrics: PipelineMetrics = {
    events_processed: results.reduce(
      (sum, r) => sum + (r.audit_entries[0]?.details?.total_events as number ?? 0),
      0,
    ),
    duplicates_prevented: results.reduce((sum, r) => {
      const details = r.audit_entries[0]?.details;
      return sum + ((details?.duplicates_prevented as number) ?? 0);
    }, 0),
    state_conflicts: results.filter(
      (r) => r.situation?.kind === "STATE_CONFLICT",
    ).length,
    situations_detected: results.filter((r) => r.situation !== null).length,
    payments_sent_to_review: results.filter(
      (r) => r.policy?.action === "customer_action_required" || r.policy?.action === "escalate",
    ).length,
    actions_blocked: results.filter(
      (r) => r.execution?.status === "blocked",
    ).length,
    recoveries_attempted: results.filter(
      (r) => r.execution?.status === "executed",
    ).length,
    recoveries_verified: results.filter(
      (r) => r.verification?.is_recovered === true,
    ).length,
    recovered_revenue: results
      .filter((r) => r.verification?.is_recovered)
      .reduce((sum, r) => sum + (r.recovery_value?.amount ?? 0), 0),
    unrecovered_recoverable: results
      .filter(
        (r) =>
          r.recovery_value?.expected_recovered_value &&
          r.recovery_value.expected_recovered_value > 0 &&
          !r.verification?.is_recovered,
      )
      .reduce((sum, r) => sum + (r.recovery_value?.expected_recovered_value ?? 0), 0),
    systemic_incidents: systemicSituation ? 1 : 0,
    by_situation_level: {
      LEVEL_1_PAYMENT: results.filter((r) =>
        r.situation?.level === "LEVEL_1_PAYMENT",
      ).length,
      LEVEL_2_RECOVERY: results.filter((r) =>
        r.situation?.level === "LEVEL_2_RECOVERY",
      ).length,
      LEVEL_3_SYSTEMIC: systemicSituation ? 1 : 0,
      LEVEL_4_STATE_CONFLICT: results.filter((r) =>
        r.situation?.level === "LEVEL_4_STATE_CONFLICT",
      ).length,
    },
    by_failure_type: results.reduce(
      (acc, r) => {
        if (r.diagnosis) {
          acc[r.diagnosis.failure_type] = (acc[r.diagnosis.failure_type] ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<FailureType, number>,
    ),
    by_action: results.reduce(
      (acc, r) => {
        if (r.policy) {
          acc[r.policy.action] = (acc[r.policy.action] ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<PolicyAction, number>,
    ),
  };

  return { results, metrics };
}
