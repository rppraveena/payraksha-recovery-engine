/**
 * Event Processor — Dedup + normalize
 *
 * Every event enters through this function regardless of source
 * (CSV, manual, simulator, webhook).
 * Dedup key: (tenant_id, provider_event_id).
 */

import type { PaymentEventType } from "@/lib/payment-states";
import { PAYMENT_EVENT_TYPES } from "@/lib/payment-states";
import type { RawPaymentEvent, ProcessedEvent } from "./types";

/** Known event types that the system recognizes. */
const KNOWN_TYPES = new Set<string>(PAYMENT_EVENT_TYPES);

/** Normalize an event type string to the canonical form. */
export function normalizeEventType(raw: string): PaymentEventType | null {
  const lower = raw.trim().toLowerCase();
  if (KNOWN_TYPES.has(lower)) return lower as PaymentEventType;
  // Common aliases
  const aliases: Record<string, PaymentEventType> = {
    "payment.success": "payment.captured",
    "payment.successful": "payment.captured",
    "payment.denied": "payment.failed",
    "payment.declined": "payment.failed",
    "recovery.started": "recovery.initiated",
    "recovery.retry": "recovery.initiated",
    "review.submitted": "review.queued",
    "review.pending": "review.queued",
    "escalation": "system.escalated",
    "block": "system.blocked",
    "release": "system.released",
  };
  return aliases[lower] ?? null;
}

/**
 * Process a batch of events for a single payment.
 * Returns processed events with dedup flags.
 */
export function processEvents(
  events: RawPaymentEvent[],
): ProcessedEvent[] {
  const seen = new Map<string, string>(); // provider_event_id → event id
  const processed: ProcessedEvent[] = [];

  // Sort by occurred_at to ensure deterministic dedup
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  for (const event of sorted) {
    const normalizedType = normalizeEventType(event.event_type);
    const existingId = seen.get(event.provider_event_id);

    if (existingId) {
      processed.push({
        raw: event,
        is_duplicate: true,
        duplicate_of: existingId,
        normalized_type: normalizedType,
      });
    } else {
      seen.set(event.provider_event_id, event.id);
      processed.push({
        raw: event,
        is_duplicate: false,
        normalized_type: normalizedType,
      });
    }
  }

  return processed;
}

/** Count unique (non-duplicate) events. */
export function countUnique(processed: ProcessedEvent[]): number {
  return processed.filter((e) => !e.is_duplicate).length;
}

/** Count duplicates. */
export function countDuplicates(processed: ProcessedEvent[]): number {
  return processed.filter((e) => e.is_duplicate).length;
}
