/**
 * Diagnosis Module — Rule-first failure classification
 *
 * Failure types:
 * - TEMPORARY_TIMEOUT
 * - INSUFFICIENT_BALANCE
 * - CARD_EXPIRED
 * - MANDATE_REVOKED
 * - NACH_BOUNCE
 * - NETWORK_ERROR
 * - GATEWAY_ERROR
 * - UNKNOWN
 *
 * AI is only invoked when deterministic rules are insufficient.
 * AI output: { failure_type, confidence, evidence[] }
 * AI can NEVER output or execute an action.
 * Malformed/invalid AI output → UNKNOWN → PENDING_REVIEW.
 */

import type { FailureType, DiagnosisResult } from "./types";
import type { ProcessedEvent } from "./types";

/** Error code → failure type mapping (deterministic rules). */
const ERROR_CODE_MAP: Record<string, FailureType> = {
  // Timeouts
  NETWORK_TIMEOUT: "TEMPORARY_TIMEOUT",
  TIMEOUT: "TEMPORARY_TIMEOUT",
  ECONNRESET: "TEMPORARY_TIMEOUT",
  GATEWAY_TIMEOUT: "TEMPORARY_TIMEOUT",

  // Card issues
  EXPIRED_CARD: "CARD_EXPIRED",
  CARD_EXPIRED: "CARD_EXPIRED",
  "14": "CARD_EXPIRED", // Stripe
  "54": "CARD_EXPIRED", // generic

  // Balance
  INSUFFICIENT_FUNDS: "INSUFFICIENT_BALANCE",
  NOT_SUFFICIENT_FUNDS: "INSUFFICIENT_BALANCE",
  "51": "INSUFFICIENT_BALANCE",
  NSF: "INSUFFICIENT_BALANCE",

  // Mandate
  MANDATE_REVOKED: "MANDATE_REVOKED",
  MANDATE_CANCELLED: "MANDATE_REVOKED",

  // NACH
  NACH_BOUNCE: "NACH_BOUNCE",
  NACH_FAILED: "NACH_BOUNCE",
  MANDATE_NOT_FOUND: "NACH_BOUNCE",

  // Gateway
  GATEWAY_503: "GATEWAY_ERROR",
  GATEWAY_ERROR: "GATEWAY_ERROR",
  INTERNAL_ERROR: "GATEWAY_ERROR",

  // Network
  NETWORK_ERROR: "NETWORK_ERROR",
  CONNECTION_LOST: "NETWORK_ERROR",

  // Declines
  CARD_DECLINED: "UNKNOWN",
  DO_NOT_HONOR: "UNKNOWN",
  RESTRICTED_CARD: "UNKNOWN",
};

/** Error description keywords → failure type. */
const DESCRIPTION_PATTERNS: Array<[RegExp, FailureType]> = [
  [/expir/i, "CARD_EXPIRED"],
  [/insufficient/i, "INSUFFICIENT_BALANCE"],
  [/timeout/i, "TEMPORARY_TIMEOUT"],
  [/mandate/i, "MANDATE_REVOKED"],
  [/nach/i, "NACH_BOUNCE"],
  [/bounce/i, "NACH_BOUNCE"],
  [/gateway/i, "GATEWAY_ERROR"],
  [/network/i, "NETWORK_ERROR"],
];

/**
 * Diagnose a payment failure using deterministic rules.
 * Returns UNKNOWN when rules are insufficient.
 */
export function diagnose(
  paymentId: string,
  events: ProcessedEvent[],
): DiagnosisResult {
  const evidence: string[] = [];
  const failureEvents = events.filter(
    (e) =>
      !e.is_duplicate &&
      (e.raw.event_type === "payment.failed" || e.normalized_type === "payment.failed"),
  );

  if (failureEvents.length === 0) {
    return {
      payment_id: paymentId,
      failure_type: "UNKNOWN",
      confidence: 0,
      evidence: ["No failure events found"],
      source: "deterministic",
    };
  }

  // Use the last failure event (most recent diagnosis)
  const lastFailure = failureEvents[failureEvents.length - 1];
  const errCode = (lastFailure.raw.error_code ?? "").toUpperCase().trim();
  const errDesc = lastFailure.raw.error_description ?? "";

  evidence.push(`error_code: ${errCode || "none"}`);
  evidence.push(`error_description: ${errDesc || "none"}`);
  evidence.push(`provider_event_id: ${lastFailure.raw.provider_event_id}`);

  // Rule 1: Exact error code match
  if (errCode && errCode in ERROR_CODE_MAP) {
    return {
      payment_id: paymentId,
      failure_type: ERROR_CODE_MAP[errCode],
      confidence: 0.95,
      evidence,
      source: "deterministic",
    };
  }

  // Rule 2: Description pattern matching
  for (const [pattern, failureType] of DESCRIPTION_PATTERNS) {
    if (pattern.test(errDesc)) {
      return {
        payment_id: paymentId,
        failure_type: failureType,
        confidence: 0.8,
        evidence: [...evidence, `matched pattern: ${pattern.source}`],
        source: "deterministic",
      };
    }
  }

  // Rule 3: No error code + no description = UNKNOWN
  if (!errCode && !errDesc) {
    return {
      payment_id: paymentId,
      failure_type: "UNKNOWN",
      confidence: 0.3,
      evidence: [...evidence, "Missing error information"],
      source: "deterministic",
    };
  }

  // No deterministic rule matched → UNKNOWN
  return {
    payment_id: paymentId,
    failure_type: "UNKNOWN",
    confidence: 0.4,
    evidence: [...evidence, "No deterministic rule matched"],
    source: "deterministic",
  };
}

/**
 * Validate AI diagnosis output.
 * Returns the validated diagnosis or UNKNOWN if malformed.
 */
export function validateAIDiagnosis(
  paymentId: string,
  aiOutput: unknown,
): DiagnosisResult {
  if (!aiOutput || typeof aiOutput !== "object") {
    return {
      payment_id: paymentId,
      failure_type: "UNKNOWN",
      confidence: 0,
      evidence: ["Malformed AI output: not an object"],
      source: "deterministic",
    };
  }

  const obj = aiOutput as Record<string, unknown>;
  const validTypes = new Set<FailureType>([
    "TEMPORARY_TIMEOUT",
    "INSUFFICIENT_BALANCE",
    "CARD_EXPIRED",
    "MANDATE_REVOKED",
    "NACH_BOUNCE",
    "NETWORK_ERROR",
    "GATEWAY_ERROR",
    "UNKNOWN",
  ]);

  const failureType = obj.failure_type as string;
  if (!failureType || !validTypes.has(failureType as FailureType)) {
    return {
      payment_id: paymentId,
      failure_type: "UNKNOWN",
      confidence: 0,
      evidence: ["Invalid AI failure_type"],
      source: "deterministic",
    };
  }

  const confidence = typeof obj.confidence === "number" ? obj.confidence : 0;
  const evidence = Array.isArray(obj.evidence) ? obj.evidence.map(String) : [];

  return {
    payment_id: paymentId,
    failure_type: failureType as FailureType,
    confidence: Math.min(1, Math.max(0, confidence)),
    evidence,
    source: "ai",
  };
}
