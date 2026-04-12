import { createHash } from "node:crypto";

/** SHA-256 content hash, returned as hex string */
export function contentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Normalize JSON for stable hashing (sorted keys, no whitespace) */
export function stableJsonHash(obj: unknown): string {
  const normalized = JSON.stringify(obj, Object.keys(obj as any).sort());
  return contentHash(normalized);
}

/** Task fingerprint: hash of normalized task description */
export function taskFingerprint(task: string): string {
  const normalized = task.toLowerCase().trim().replace(/\s+/g, " ");
  return contentHash(normalized).slice(0, 16);
}
