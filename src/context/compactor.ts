import type { Conductor } from "../types/conductor.js";
import type { ContextEntry, CompactionResult } from "../types/context.js";
import { estimateTokens } from "../util/tokens.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("context");

const COMPACTION_PROMPT = `You are a context compaction assistant. Summarize the following conversation turns into a structured brief that preserves all important information.

Format your summary as:
## Goal
[What the user/system is trying to accomplish]

## Progress
[What has been done so far]

## Decisions
[Key decisions made, with reasoning]

## Active Files
[Files currently being worked on]

## Next Steps
[What needs to happen next]

Keep the summary concise but complete. Preserve specific details like file paths, function names, error messages, and configuration values. Do NOT lose technical specifics.`;

export class Compactor {
  constructor(
    private conductor: Conductor,
    private compactorModel: string,
  ) {}

  /**
   * Compact a set of context entries into a structured summary.
   * Uses a cheap model for the compression.
   */
  async compact(entries: ContextEntry[]): Promise<CompactionResult> {
    if (entries.length === 0) {
      return {
        removedEntries: 0,
        compactedTokens: 0,
        newTokenCount: 0,
        summary: "",
      };
    }

    const originalTokens = entries.reduce((sum, e) => sum + e.tokenCount, 0);

    // Build the content to compact
    const content = entries
      .map((e) => `[${e.role}]: ${e.content}`)
      .join("\n\n");

    try {
      const response = await this.conductor.complete({
        messages: [{ role: "user", content }],
        model: this.compactorModel,
        systemPrompt: COMPACTION_PROMPT,
        maxTokens: Math.min(2000, Math.ceil(originalTokens * 0.3)),
        temperature: 0,
      });

      const summary = response.content;
      const newTokenCount = estimateTokens(summary);

      log.info(
        {
          removedEntries: entries.length,
          originalTokens,
          newTokenCount,
          ratio: (newTokenCount / originalTokens).toFixed(2),
        },
        "Context compacted",
      );

      return {
        removedEntries: entries.length,
        compactedTokens: originalTokens,
        newTokenCount,
        summary,
      };
    } catch (error) {
      log.error({ error }, "Compaction failed, using fallback");
      // Fallback: mechanical truncation
      const fallbackSummary = entries
        .map((e) => {
          const truncated =
            e.content.length > 200
              ? e.content.slice(0, 200) + "..."
              : e.content;
          return `[${e.role}]: ${truncated}`;
        })
        .join("\n");

      return {
        removedEntries: entries.length,
        compactedTokens: originalTokens,
        newTokenCount: estimateTokens(fallbackSummary),
        summary: fallbackSummary,
      };
    }
  }
}
