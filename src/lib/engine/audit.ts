/**
 * PayRaksha Audit Chain — SHA-256 hash chaining
 *
 * Every pipeline stage writes an audit entry chained to the previous.
 * The genesis hash is the SHA-256 of "payraksha-genesis".
 * Fabricating or skipping audit entries breaks the chain.
 */

import type { AuditEntry } from "./types";

const GENESIS_HASH = "payraksha-genesis";

/** SHA-256 hash of a string, returned as hex. */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compute the chain hash for an audit entry. */
export async function computeAuditHash(
  previousHash: string,
  tenantId: string,
  paymentId: string,
  stage: string,
  action: string,
  details: Record<string, unknown>,
  timestamp: string,
): Promise<string> {
  const payload = JSON.stringify({
    previous_hash: previousHash,
    tenant_id: tenantId,
    payment_id: paymentId,
    stage,
    action,
    details,
    timestamp,
  });
  return sha256(payload);
}

/** Create a new audit entry, chaining to the previous hash. */
export async function createAuditEntry(
  tenantId: string,
  paymentId: string,
  stage: string,
  action: string,
  details: Record<string, unknown>,
  previousHash: string = GENESIS_HASH,
  timestamp: string = new Date().toISOString(),
): Promise<AuditEntry> {
  const currentHash = await computeAuditHash(
    previousHash,
    tenantId,
    paymentId,
    stage,
    action,
    details,
    timestamp,
  );

  return {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    payment_id: paymentId,
    stage,
    action,
    details,
    previous_hash: previousHash,
    current_hash: currentHash,
    created_at: timestamp,
  };
}

/** Verify the integrity of an audit chain. */
export async function verifyAuditChain(entries: AuditEntry[]): Promise<boolean> {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : entries[i - 1].current_hash;
    if (entry.previous_hash !== expectedPrev) {
      return false;
    }
    const recomputed = await computeAuditHash(
      entry.previous_hash,
      entry.tenant_id,
      entry.payment_id,
      entry.stage,
      entry.action,
      entry.details,
      entry.created_at,
    );
    if (recomputed !== entry.current_hash) {
      return false;
    }
  }
  return true;
}

/** Export audit entries to CSV. */
export function exportAuditCSV(entries: AuditEntry[]): string {
  const headers = [
    "id",
    "tenant_id",
    "payment_id",
    "stage",
    "action",
    "previous_hash",
    "current_hash",
    "created_at",
    "details",
  ];
  const rows = entries.map((e) =>
    [
      e.id,
      e.tenant_id,
      e.payment_id,
      e.stage,
      e.action,
      e.previous_hash,
      e.current_hash,
      e.created_at,
      JSON.stringify(e.details),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}
