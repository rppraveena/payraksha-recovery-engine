/**
 * PayRaksha Intelligence Engine — Core Types
 *
 * All pipeline stages operate on these types.
 * No stage may fabricate data not present in the database.
 */

import type { PaymentState, PaymentEventType } from "@/lib/payment-states";

// ── Event Processing ──────────────────────────────────────────────

export interface RawPaymentEvent {
  id: string;
  tenant_id: string;
  payment_id: string;
  provider_event_id: string;
  event_type: string;
  occurred_at: string;
  raw_payload: Record<string, unknown>;
  amount?: number;
  currency?: string;
  method?: string;
  bank?: string;
  psp?: string;
  error_code?: string;
  error_description?: string;
}

export interface ProcessedEvent {
  raw: RawPaymentEvent;
  is_duplicate: boolean;
  duplicate_of?: string;
  normalized_type: PaymentEventType | null;
}

// ── State Reconstruction ──────────────────────────────────────────

export interface StateReconstruction {
  payment_id: string;
  events_applied: number;
  final_state: PaymentState | null;
  conflicts: StateConflict[];
  terminal: boolean;
}

export interface StateConflict {
  event_type: string;
  from_state: PaymentState;
  error: string;
  occurred_at: string;
}

// ── Situation Engine ──────────────────────────────────────────────

export type SituationLevel =
  | "LEVEL_1_PAYMENT"
  | "LEVEL_2_RECOVERY"
  | "LEVEL_3_SYSTEMIC"
  | "LEVEL_4_STATE_CONFLICT";

export type SituationKind =
  | "DUPLICATE_EVENT"
  | "OUT_OF_ORDER"
  | "RECOVERY_FAILURE"
  | "CARD_EXPIRED"
  | "INSUFFICIENT_FUNDS"
  | "SYSTEMIC_PATTERN_DETECTED"
  | "STATE_CONFLICT"
  | "RECOVERY_LOOP"
  | "HIGH_VALUE_FAILURE"
  | "EXPIRED_RECOVERY";

export interface DetectedSituation {
  payment_id: string;
  tenant_id: string;
  kind: SituationKind;
  level: SituationLevel;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  metadata: Record<string, unknown>;
}

// ── Diagnosis ─────────────────────────────────────────────────────

export type FailureType =
  | "TEMPORARY_TIMEOUT"
  | "INSUFFICIENT_BALANCE"
  | "CARD_EXPIRED"
  | "MANDATE_REVOKED"
  | "NACH_BOUNCE"
  | "NETWORK_ERROR"
  | "GATEWAY_ERROR"
  | "UNKNOWN";

export interface DiagnosisResult {
  payment_id: string;
  failure_type: FailureType;
  confidence: number; // 0-1
  evidence: string[];
  source: "deterministic" | "ai";
}

// ── Value Estimation ──────────────────────────────────────────────

export interface RecoveryValueEstimate {
  payment_id: string;
  amount: number;
  historical_recovery_rate: number;
  expected_recovered_value: number;
  sample_size: number;
  eligible_attempts: number;
  successful_attempts: number;
}

// ── Policy Engine ─────────────────────────────────────────────────

export type PolicyAction =
  | "schedule_retry"
  | "customer_action_required"
  | "manual_charge_required"
  | "cancel_recovery"
  | "pause"
  | "block"
  | "escalate"
  | "no_action";

export interface PolicyDecision {
  payment_id: string;
  action: PolicyAction;
  policy_id: string;
  policy_name: string;
  reason: string;
  parameters: Record<string, unknown>;
}

// ── Guardrails ────────────────────────────────────────────────────

export interface GuardrailCheck {
  name: string;
  passed: boolean;
  reason: string;
}

export interface GuardrailResult {
  payment_id: string;
  allowed: boolean;
  checks: GuardrailCheck[];
  blocked_by?: string;
}

// ── Execution ─────────────────────────────────────────────────────

export type ExecutionResult =
  | { status: "executed"; action: string; provider_ref?: string }
  | { status: "blocked"; reason: string }
  | { status: "cancelled"; reason: string }
  | { status: "paused"; reason: string }
  | { status: "customer_action_required"; reason: string };

// ── Verification ──────────────────────────────────────────────────

export interface VerificationResult {
  payment_id: string;
  verified_state: PaymentState | null;
  verified: boolean;
  is_recovered: boolean;
  recovered_amount: number;
}

// ── Audit ─────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  tenant_id: string;
  payment_id: string;
  stage: string;
  action: string;
  details: Record<string, unknown>;
  previous_hash: string;
  current_hash: string;
  created_at: string;
}

// ── Pipeline Result ───────────────────────────────────────────────

export interface PipelineResult {
  payment_id: string;
  event_type: string;
  state_before: PaymentState | null;
  state_after: PaymentState | null;
  situation: DetectedSituation | null;
  diagnosis: DiagnosisResult | null;
  recovery_value: RecoveryValueEstimate | null;
  policy: PolicyDecision | null;
  guardrails: GuardrailResult | null;
  execution: ExecutionResult | null;
  verification: VerificationResult | null;
  audit_entries: AuditEntry[];
}

// ── Pipeline Metrics ──────────────────────────────────────────────

export interface PipelineMetrics {
  events_processed: number;
  duplicates_prevented: number;
  state_conflicts: number;
  situations_detected: number;
  payments_sent_to_review: number;
  actions_blocked: number;
  recoveries_attempted: number;
  recoveries_verified: number;
  recovered_revenue: number;
  unrecovered_recoverable: number;
  systemic_incidents: number;
  by_situation_level: Record<SituationLevel, number>;
  by_failure_type: Record<FailureType, number>;
  by_action: Record<PolicyAction, number>;
}
