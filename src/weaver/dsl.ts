import type { Result } from "../types/common.js";
import { ok, err, loomError, ERROR_CODES } from "../types/common.js";
import {
  GraphNodeSchema,
  type ExecutionGraph,
  type GraphNode,
  type WeaveMutation,
  WeaveMutationSchema,
} from "../types/weaver.js";
import { contentHash } from "../util/hash.js";
import { newGraphId } from "../util/id.js";

/**
 * Parse a <graph> tag from model output into an ExecutionGraph.
 */
export function parseGraph(
  input: string,
  task: string,
  model: string = "unknown",
): Result<ExecutionGraph> {
  const graphJson = extractTag(input, "graph");
  if (!graphJson) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_PARSE_FAILED,
        "No <graph> tag found in model output",
      ),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(graphJson);
  } catch (e) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_PARSE_FAILED,
        `Invalid JSON in <graph> tag: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  // Expect { nodes: [...] }
  if (!parsed || typeof parsed !== "object" || !("nodes" in parsed)) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_PARSE_FAILED,
        'Graph JSON must have a "nodes" array',
      ),
    );
  }

  const nodesRaw = (parsed as any).nodes;
  if (!Array.isArray(nodesRaw)) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_PARSE_FAILED,
        '"nodes" must be an array',
      ),
    );
  }

  // Validate each node
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodesRaw.length; i++) {
    const result = GraphNodeSchema.safeParse(nodesRaw[i]);
    if (!result.success) {
      return err(
        loomError(
          ERROR_CODES.WEAVER_PARSE_FAILED,
          `Invalid node at index ${i}: ${result.error.message}`,
        ),
      );
    }
    nodes.push(result.data as GraphNode);
  }

  const graphJsonStr = JSON.stringify({ nodes });
  const hash = contentHash(graphJsonStr);

  return ok({
    id: newGraphId(),
    nodes,
    contentHash: hash,
    metadata: {
      task,
      createdAt: Date.now(),
      model,
    },
  });
}

/**
 * Parse <weave> tags from node output into mutations.
 */
export function parseWeaveMutations(output: string): WeaveMutation[] {
  const mutations: WeaveMutation[] = [];
  const tags = extractAllTags(output, "weave");

  for (const tag of tags) {
    try {
      const parsed = JSON.parse(tag);
      const result = WeaveMutationSchema.safeParse(parsed);
      if (result.success) {
        mutations.push(result.data as WeaveMutation);
      }
    } catch {
      // Skip invalid mutations
    }
  }

  return mutations;
}

/**
 * Extract content from an XML-like tag. Handles attributes on the tag.
 */
function extractTag(input: string, tagName: string): string | null {
  const openPattern = new RegExp(`<${tagName}[^>]*>`);
  const closePattern = new RegExp(`</${tagName}>`);

  const openMatch = openPattern.exec(input);
  if (!openMatch) return null;

  const startIdx = openMatch.index + openMatch[0].length;
  const closeMatch = closePattern.exec(input.slice(startIdx));
  if (!closeMatch) return null;

  return input.slice(startIdx, startIdx + closeMatch.index).trim();
}

/**
 * Extract all occurrences of a tag.
 */
function extractAllTags(input: string, tagName: string): string[] {
  const results: string[] = [];
  const openPattern = new RegExp(`<${tagName}[^>]*>`, "g");
  const closeTag = `</${tagName}>`;

  let match;
  while ((match = openPattern.exec(input)) !== null) {
    const startIdx = match.index + match[0].length;
    const closeIdx = input.indexOf(closeTag, startIdx);
    if (closeIdx === -1) break;
    results.push(input.slice(startIdx, closeIdx).trim());
  }

  return results;
}

/**
 * Strip <graph> and <weave> tags from output to get clean text.
 */
export function stripTags(output: string): string {
  return output
    .replace(/<graph[^>]*>[\s\S]*?<\/graph>/g, "")
    .replace(/<weave[^>]*>[\s\S]*?<\/weave>/g, "")
    .trim();
}
