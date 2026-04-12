import type { Conductor } from "../types/conductor.js";
import type {
  ExecutionGraph,
  GraphExecution,
  GraphTemplate,
} from "../types/weaver.js";
import type { GraphCache } from "./cache.js";
import { taskFingerprint } from "../util/hash.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("weaver");

const TEMPLATE_EXTRACTION_PROMPT = `You are evaluating whether a graph execution result is worth saving as a reusable template.

A graph is reusable if:
1. It solved the task successfully
2. The pattern is general enough to apply to similar future tasks
3. It doesn't contain highly specific details that wouldn't apply elsewhere

Respond with ONLY "YES" or "NO" followed by a brief reason.`;

/**
 * After a successful graph execution, evaluate whether the graph
 * should be saved as a reusable template.
 */
export async function extractTemplate(
  graph: ExecutionGraph,
  execution: GraphExecution,
  conductor: Conductor,
  cache: GraphCache,
): Promise<GraphTemplate | null> {
  // Only extract from successful executions
  if (execution.status !== "completed") return null;

  // Check if already cached
  const existing = cache.lookup(graph.contentHash);
  if (existing) {
    // Update stats
    cache.updateStats(existing.id, true, execution.completedAt! - execution.startedAt);
    return existing;
  }

  // Ask the model if this graph is reusable
  try {
    const response = await conductor.complete({
      messages: [
        {
          role: "user",
          content: `Task: ${graph.metadata.task}\n\nGraph nodes: ${graph.nodes.map((n) => `${n.id} (${n.type})`).join(", ")}\n\nExecution status: ${execution.status}\nNodes completed: ${execution.results.size}/${graph.nodes.length}\n\nIs this graph reusable as a template for similar tasks?`,
        },
      ],
      model: conductor.resolveModel("compactor"),
      systemPrompt: TEMPLATE_EXTRACTION_PROMPT,
      maxTokens: 50,
      temperature: 0,
    });

    const answer = response.content.trim().toUpperCase();
    if (!answer.startsWith("YES")) {
      log.debug(
        { graphId: graph.id, reason: response.content },
        "Graph not extracted as template",
      );
      return null;
    }

    const fingerprint = taskFingerprint(graph.metadata.task);
    const templateId = cache.store(graph, fingerprint);

    const template: GraphTemplate = {
      id: templateId,
      contentHash: graph.contentHash,
      taskPattern: fingerprint,
      graphJson: JSON.stringify(graph.nodes),
      successCount: 1,
      failureCount: 0,
      avgDuration: execution.completedAt
        ? execution.completedAt - execution.startedAt
        : undefined,
      createdAt: Date.now(),
    };

    log.info(
      { templateId, fingerprint: fingerprint.slice(0, 8) },
      "Graph extracted as template",
    );

    return template;
  } catch (error) {
    log.error({ error }, "Template extraction failed");
    return null;
  }
}

/**
 * Find a matching template for a given task.
 */
export function findMatchingTemplate(
  task: string,
  cache: GraphCache,
): GraphTemplate | null {
  const fingerprint = taskFingerprint(task);
  const matches = cache.findByPattern(fingerprint.slice(0, 8));

  if (matches.length === 0) return null;

  // Return the most successful template
  return matches.sort(
    (a, b) => b.successCount - b.failureCount - (a.successCount - a.failureCount),
  )[0] ?? null;
}
