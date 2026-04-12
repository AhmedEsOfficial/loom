import type { SubstrateToolsImpl } from "../substrate/tools.js";
import type { ExternalizedRef } from "../types/context.js";
import { newId } from "../util/id.js";
import { estimateTokens, truncateToTokens } from "../util/tokens.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("context");

export class Externalizer {
  constructor(
    private substrate: SubstrateToolsImpl,
    private threshold: number = 2048,
  ) {}

  /**
   * Check if content should be externalized and do so if needed.
   * Returns the externalized ref if externalized, null otherwise.
   */
  externalize(content: string): ExternalizedRef | null {
    if (content.length <= this.threshold) return null;

    const id = newId();
    const summary = generateSummary(content);
    const tokenCount = estimateTokens(content);

    // Store in substrate
    this.substrate.storeExternalized(id, content, summary, tokenCount);

    log.debug(
      { id, originalTokens: tokenCount, summaryLength: summary.length },
      "Content externalized",
    );

    return {
      id,
      summary,
      substrateId: id,
      originalTokenCount: tokenCount,
    };
  }

  /**
   * Refetch externalized content.
   */
  async refetch(substrateId: string): Promise<string | null> {
    return this.substrate.refetch(substrateId);
  }
}

/**
 * Generate a concise summary of content for the externalized placeholder.
 * This is a fast, heuristic-based summary — not LLM-powered.
 * The LLM-powered summary happens during compaction.
 */
function generateSummary(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());

  // For tool output, take the first meaningful line
  if (lines.length === 0) return "[empty content]";

  // Try to extract structure
  const firstLine = lines[0]!.trim();

  // JSON output: describe the structure
  if (firstLine.startsWith("{") || firstLine.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return `[JSON array with ${parsed.length} items, ${estimateTokens(content)} tokens]`;
      }
      const keys = Object.keys(parsed);
      return `[JSON object with keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""}, ${estimateTokens(content)} tokens]`;
    } catch {
      // Not valid JSON, fall through
    }
  }

  // For long text, take first line + stats
  const truncated = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine;
  return `${truncated} [${lines.length} lines, ${estimateTokens(content)} tokens]`;
}
