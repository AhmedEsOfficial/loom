import type Database from "better-sqlite3";
import type { Conductor } from "../types/conductor.js";
import type { MapNodeId } from "../types/common.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("cartographer");

const SUMMARIZE_PROMPT = `Summarize this code module in ~200 tokens. Focus on:
- What it does (purpose)
- Key exports/public API
- Important patterns or abstractions

Be concrete and specific. Avoid generic descriptions.`;

export class MapSummarizer {
  constructor(
    private db: Database.Database,
    private conductor: Conductor,
    private model: string,
    private batchSize: number = 15,
  ) {}

  /**
   * Summarize all unsummarized file-level map nodes.
   * @param useLlm If false, use fast mechanical summaries (default for init).
   */
  async summarizeFiles(repoId: string, onProgress?: (nodeId: MapNodeId) => void, useLlm = false): Promise<number> {
    const unsummarized = this.db
      .prepare(
        "SELECT id, path, language, public_api, complexity_score, loc FROM map_nodes WHERE repo_id = ? AND level = 'file' AND summary = ''",
      )
      .all(repoId) as { id: string; path: string; language: string; public_api: string; complexity_score: number; loc: number }[];

    if (unsummarized.length === 0) return 0;

    let summarized = 0;
    const updateStmt = this.db.prepare(
      "UPDATE map_nodes SET summary = ? WHERE id = ?",
    );

    // Process in batches
    for (let i = 0; i < unsummarized.length; i += this.batchSize) {
      const batch = unsummarized.slice(i, i + this.batchSize);

      if (useLlm) {
        const batchContent = batch
          .map(
            (node) =>
              `### ${node.path} (${node.language}, ${node.loc} LOC, complexity: ${node.complexity_score.toFixed(2)})\nExports: ${node.public_api}`,
          )
          .join("\n\n");

        try {
          const response = await this.conductor.complete({
            messages: [
              {
                role: "user",
                content: `Summarize each of these ${batch.length} modules:\n\n${batchContent}\n\nProvide one summary per module, formatted as:\n**path**: summary`,
              },
            ],
            model: this.model,
            systemPrompt: SUMMARIZE_PROMPT,
            maxTokens: batch.length * 250,
            temperature: 0,
          });

          const summaries = parseBatchSummaries(response.content, batch.map((n) => n.path));

          this.db.transaction(() => {
            for (const node of batch) {
              const summary = summaries.get(node.path) ?? mechanicalSummary(node);
              updateStmt.run(summary, node.id);
              summarized++;
              onProgress?.(node.id as MapNodeId);
            }
          })();
          continue;
        } catch (error) {
          log.warn(
            { error, batchStart: i, batchSize: batch.length },
            "LLM summarization failed, using mechanical fallback",
          );
        }
      }

      // Mechanical summaries (fast, no LLM needed)
      this.db.transaction(() => {
        for (const node of batch) {
          updateStmt.run(mechanicalSummary(node), node.id);
          summarized++;
        }
      })();
    }

    // Propagate summaries up to module/package level
    await this.propagateSummaries(repoId);

    log.info({ repoId, summarized }, "File summarization complete");
    return summarized;
  }

  /**
   * Aggregate child summaries up to parent module/package nodes.
   */
  private async propagateSummaries(repoId: string): Promise<void> {
    const levels = ["module", "package", "repo"] as const;

    for (const level of levels) {
      const parents = this.db
        .prepare(
          "SELECT id, path FROM map_nodes WHERE repo_id = ? AND level = ? AND summary = ''",
        )
        .all(repoId, level) as { id: string; path: string }[];

      for (const parent of parents) {
        const children = this.db
          .prepare(
            "SELECT summary, path FROM map_nodes WHERE parent_id = ? AND summary != ''",
          )
          .all(parent.id) as { summary: string; path: string }[];

        if (children.length === 0) continue;

        // Aggregate children summaries
        const summary = children
          .slice(0, 10)
          .map((c) => `- ${c.path}: ${c.summary}`)
          .join("\n");

        const aggregated = `Contains ${children.length} modules:\n${summary}${children.length > 10 ? "\n..." : ""}`;

        this.db
          .prepare("UPDATE map_nodes SET summary = ? WHERE id = ?")
          .run(aggregated, parent.id);
      }
    }
  }
}

function parseBatchSummaries(
  response: string,
  paths: string[],
): Map<string, string> {
  const summaries = new Map<string, string>();
  const lines = response.split("\n");

  let currentPath: string | null = null;
  let currentSummary: string[] = [];

  for (const line of lines) {
    // Try to match "**path**: summary" or "path: summary" patterns
    for (const path of paths) {
      if (line.includes(path)) {
        if (currentPath) {
          summaries.set(currentPath, currentSummary.join(" ").trim());
        }
        currentPath = path;
        const afterPath = line.slice(line.indexOf(path) + path.length);
        const cleaned = afterPath.replace(/^[\s*:]+/, "").trim();
        currentSummary = cleaned ? [cleaned] : [];
        break;
      }
    }

    if (currentPath && !paths.some((p) => line.includes(p))) {
      currentSummary.push(line.trim());
    }
  }

  if (currentPath) {
    summaries.set(currentPath, currentSummary.join(" ").trim());
  }

  return summaries;
}

function mechanicalSummary(node: { path: string; language: string; public_api: string; complexity_score: number; loc: number }): string {
  const exports = safeJsonParse(node.public_api);
  const exportStr = exports.length > 0
    ? `Exports: ${exports.slice(0, 5).join(", ")}${exports.length > 5 ? ` (+${exports.length - 5} more)` : ""}.`
    : "No named exports.";
  return `${node.language} module (${node.loc} LOC). ${exportStr}`;
}

function safeJsonParse(json: string): string[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
