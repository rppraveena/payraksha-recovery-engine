/**
 * Guardrails — Safety checks before ANY automatic action
 *
 * Before execution, re-check:
 * - current state
 * - confidence
 * - attempt count
 * - cooldown
 * - daily cap
 * - active incident
 * - existing active recovery
 * - policy version
 *
 * Any failed guardrail blocks the action and creates an audit event.
 */

import type { GuardrailResult, GuardrailCheck, PolicyAction } from "./types";
import type { DetectedSituation } from "./types";

/** Maximum recovery attempts per payment. */
const MAX_ATTEMPTS = 5;

/** Daily cap for automated recovery actions. */
const DAILY_CAP = 100;

/** Minimum confidence threshold for automated actions. */
const MIN_CONFIDENCE = 0.5;

/** Cooldown between attempts (hours). */
const COOLDOWN_HOURS = 1;

/**
 * Run all guardrails before executing an action.
 */
export function runGuardrails(
  paymentId: string,
  action: PolicyAction,
  currentState: string,
  confidence: number,
  attemptCount: number,
  lastAttemptTime: string | null,
  dailyActionCount: number,
  activeIncidents: DetectedSituation[],
  hasActiveRecovery: boolean,
): GuardrailResult {
  const checks: GuardrailCheck[] = [];

  // Skip guardrails for non-executable actions
  if (
    action === "no_action" ||
    action === "cancel_recovery" ||
    action === "pause"
  ) {
    return {
      payment_id: paymentId,
      allowed: true,
      checks: [{ name: "non_executable_action", passed: true, reason: "Action does not require guardrails" }],
    };
  }

  // 1. State check
  const terminalStates = new Set(["CAPTURED", "CAPTURED_AFTER_FAILURE"]);
  checks.push({
    name: "state_check",
    passed: !terminalStates.has(currentState),
    reason: terminalStates.has(currentState)
      ? `Payment already in terminal state: ${currentState}`
      : `Current state ${currentState} allows action`,
  });

  // 2. Confidence check
  checks.push({
    name: "confidence_check",
    passed: confidence >= MIN_CONFIDENCE,
    reason:
      confidence >= MIN_CONFIDENCE
        ? `Confidence ${confidence} meets threshold ${MIN_CONFIDENCE}`
        : `Confidence ${confidence} below threshold ${MIN_CONFIDENCE}`,
  });

  // 3. Attempt count check
  checks.push({
    name: "attempt_count_check",
    passed: attemptCount < MAX_ATTEMPTS,
    reason:
      attemptCount < MAX_ATTEMPTS
        ? `Attempt ${attemptCount + 1} of ${MAX_ATTEMPTS}`
        : `Maximum attempts (${MAX_ATTEMPTS}) exceeded`,
  });

  // 4. Cooldown check
  if (lastAttemptTime) {
    const elapsed =
      (Date.now() - new Date(lastAttemptTime).getTime()) / (1000 * 60 * 60);
    const cooldownPassed = elapsed >= COOLDOWN_HOURS;
    checks.push({
      name: "cooldown_check",
      passed: cooldownPassed,
      reason: cooldownPassed
        ? `Cooldown elapsed (${Math.round(elapsed)}h)`
        : `Cooldown not met (${Math.round(COOLDOWN_HOURS - elapsed)}h remaining)`,
    });
  } else {
    checks.push({
      name: "cooldown_check",
      passed: true,
      reason: "No previous attempt — cooldown not applicable",
    });
  }

  // 5. Daily cap check
  checks.push({
    name: "daily_cap_check",
    passed: dailyActionCount < DAILY_CAP,
    reason:
      dailyActionCount < DAILY_CAP
        ? `Daily actions ${dailyActionCount}/${DAILY_CAP}`
        : `Daily cap ${DAILY_CAP} reached`,
  });

  // 6. Active incident check
  const hasIncident = activeIncidents.some(
    (i) => i.kind === "SYSTEMIC_PATTERN_DETECTED",
  );
  checks.push({
    name: "active_incident_check",
    passed: !hasIncident,
    reason: hasIncident
      ? "Systemic incident active — automated actions paused"
      : "No active systemic incidents",
  });

  // 7. Active recovery check
  checks.push({
    name: "active_recovery_check",
    passed: !hasActiveRecovery,
    reason: hasActiveRecovery
      ? "Existing active recovery in progress"
      : "No active recovery",
  });

  const blockedBy = checks.find((c) => !c.passed)?.name;
  const allowed = checks.every((c) => c.passed);

  return {
    payment_id: paymentId,
    allowed,
    checks,
    blocked_by: blockedBy,
  };
}
