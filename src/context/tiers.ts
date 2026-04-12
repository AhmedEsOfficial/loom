import type { ContextEntry, ContextTier } from "../types/context.js";
import { estimateTokens } from "../util/tokens.js";

/**
 * Tier classification rules:
 *
 * Tier 0 — Pinned: system prompt, task spec, current graph node. Never compressed.
 * Tier 1 — Recent: last N turns at full fidelity.
 * Tier 2 — Externalized: tool results over threshold, replaced with <ref> handle.
 * Tier 3 — Compacted: structured summary of older turns.
 * Tier 4 — Reset boundary: triggers fork-at-threshold.
 */

export interface TierConfig {
  recentTurns: number;
  externalizeThreshold: number; // bytes
  forkThreshold: number; // 0.0 - 1.0
  maxContextTokens: number;
}

export function classifyTier(
  entry: { role: string; content: string; metadata?: Record<string, unknown> },
  position: number,
  totalEntries: number,
  config: TierConfig,
): ContextTier {
  // System messages and pinned entries are always tier 0
  if (entry.role === "system") return 0;
  if (entry.metadata?.pinned) return 0;

  // Recent entries (within last N) are tier 1
  const distFromEnd = totalEntries - position;
  if (distFromEnd <= config.recentTurns) return 1;

  // Large tool results should be externalized (tier 2)
  if (
    entry.role === "tool" &&
    entry.content.length > config.externalizeThreshold
  ) {
    return 2;
  }

  // Everything else is tier 3 (compaction candidate)
  return 3;
}

export function shouldExternalize(
  content: string,
  threshold: number,
): boolean {
  return content.length > threshold;
}

export function createExternalizedPlaceholder(
  refId: string,
  summary: string,
): string {
  return `<ref id="${refId}">${summary}</ref>`;
}

export function isExternalizedPlaceholder(content: string): boolean {
  return content.startsWith("<ref id=") && content.endsWith("</ref>");
}

export function extractRefId(placeholder: string): string | null {
  const match = placeholder.match(/<ref id="([^"]+)">/);
  return match?.[1] ?? null;
}
