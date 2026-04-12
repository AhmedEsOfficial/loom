import type { Conductor } from "../types/conductor.js";
import type { ContextEntry, HandoffBrief } from "../types/context.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("context");

const HANDOFF_PROMPT = `You are generating a handoff brief for a context fork. A new agent context will continue this work with access to the substrate (persistent memory) but without the full conversation history.

Create a brief that allows seamless continuation. Be specific — include file paths, function names, error messages, and exact technical details. The new context should be able to continue without asking "what were we doing?"

Format as JSON:
{
  "task": "...",
  "progress": "...",
  "decisions": ["..."],
  "openQuestions": ["..."],
  "activeFiles": ["..."],
  "substratePointers": ["..."],
  "nextSteps": ["..."]
}`;

export class HandoffGenerator {
  constructor(
    private conductor: Conductor,
    private model: string,
  ) {}

  async generate(
    entries: ContextEntry[],
    substrateRefs: string[],
  ): Promise<HandoffBrief> {
    const content = entries
      .filter((e) => e.tier <= 1) // Only recent + pinned entries
      .map((e) => `[${e.role}]: ${e.content}`)
      .join("\n\n");

    try {
      const response = await this.conductor.complete({
        messages: [
          {
            role: "user",
            content: `Generate a handoff brief for this conversation:\n\n${content}\n\nSubstrate references available: ${substrateRefs.join(", ")}`,
          },
        ],
        model: this.model,
        systemPrompt: HANDOFF_PROMPT,
        maxTokens: 1500,
        temperature: 0,
      });

      const brief = parseHandoffBrief(response.content);
      brief.substratePointers = [
        ...brief.substratePointers,
        ...substrateRefs,
      ];

      log.info(
        {
          decisions: brief.decisions.length,
          activeFiles: brief.activeFiles.length,
          nextSteps: brief.nextSteps.length,
        },
        "Handoff brief generated",
      );

      return brief;
    } catch (error) {
      log.error({ error }, "Handoff generation failed, using fallback");
      return createFallbackBrief(entries, substrateRefs);
    }
  }
}

function parseHandoffBrief(content: string): HandoffBrief {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        task: parsed.task ?? "",
        progress: parsed.progress ?? "",
        decisions: parsed.decisions ?? [],
        openQuestions: parsed.openQuestions ?? [],
        activeFiles: parsed.activeFiles ?? [],
        substratePointers: parsed.substratePointers ?? [],
        nextSteps: parsed.nextSteps ?? [],
      };
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: use the content as-is
  return {
    task: "",
    progress: content,
    decisions: [],
    openQuestions: [],
    activeFiles: [],
    substratePointers: [],
    nextSteps: [],
  };
}

function createFallbackBrief(
  entries: ContextEntry[],
  substrateRefs: string[],
): HandoffBrief {
  const userEntries = entries.filter((e) => e.role === "user");
  const lastUser = userEntries[userEntries.length - 1];

  return {
    task: lastUser?.content?.slice(0, 200) ?? "Unknown task",
    progress: `Processed ${entries.length} conversation turns before context fork.`,
    decisions: [],
    openQuestions: [],
    activeFiles: [],
    substratePointers: substrateRefs,
    nextSteps: ["Continue from the last user request"],
  };
}
