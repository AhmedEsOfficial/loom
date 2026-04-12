import type { ToolDefinition } from "../types/conductor.js";

/**
 * Tool normalization layer — defines the standard tools
 * exposed to models during graph node execution.
 */

export function createSubstrateToolDefs(): ToolDefinition[] {
  return [
    {
      name: "substrate_search",
      description:
        "Full-text search over the episodic memory. Returns matching episodes ranked by relevance.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (natural language or keywords)",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "substrate_expand_symbol",
      description:
        "Get detailed information about a code symbol (function, class, etc.) from the AST index.",
      inputSchema: {
        type: "object",
        properties: {
          symbolName: {
            type: "string",
            description: "Name of the symbol to look up",
          },
          filePath: {
            type: "string",
            description: "Optional file path to narrow the search",
          },
        },
        required: ["symbolName"],
      },
    },
    {
      name: "substrate_related_episodes",
      description:
        "Find episodes related to a specific task. Useful for recalling what happened in similar previous tasks.",
      inputSchema: {
        type: "object",
        properties: {
          taskFingerprint: {
            type: "string",
            description: "The task fingerprint to search for",
          },
          limit: {
            type: "number",
            description: "Maximum episodes to return (default: 10)",
          },
        },
        required: ["taskFingerprint"],
      },
    },
    {
      name: "substrate_skill_lookup",
      description:
        "Find skills that match a description. Skills are reusable capabilities the harness has learned.",
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Description of the capability you need",
          },
        },
        required: ["description"],
      },
    },
    {
      name: "map_query",
      description:
        "Browse the codebase map at a given path and resolution level. Returns summaries, public APIs, and structure.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File or directory path to examine",
          },
          level: {
            type: "string",
            enum: ["file", "module", "package", "repo"],
            description:
              "Resolution level (default: auto-detected from path)",
          },
          depth: {
            type: "number",
            description: "How many levels of children to include (default: 1)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "refetch",
      description:
        "Re-fetch the full content of an externalized reference. Use when you need the complete content that was summarized.",
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "The substrate reference ID to fetch",
          },
        },
        required: ["ref"],
      },
    },
  ];
}

/**
 * Tool executor — routes tool calls to the substrate
 */
export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  substrate: any,
): Promise<string> {
  switch (toolName) {
    case "substrate_search": {
      const results = await substrate.search(
        toolInput.query as string,
        { limit: toolInput.limit as number },
      );
      return JSON.stringify(results, null, 2);
    }
    case "substrate_expand_symbol": {
      const result = await substrate.expandSymbol(
        toolInput.symbolName as string,
        toolInput.filePath as string | undefined,
      );
      return result
        ? JSON.stringify(result, null, 2)
        : "Symbol not found";
    }
    case "substrate_related_episodes": {
      const episodes = await substrate.relatedEpisodes(
        toolInput.taskFingerprint as string,
        toolInput.limit as number,
      );
      return JSON.stringify(episodes, null, 2);
    }
    case "substrate_skill_lookup": {
      const skills = await substrate.skillLookup(
        toolInput.description as string,
      );
      return JSON.stringify(skills, null, 2);
    }
    case "refetch": {
      const content = await substrate.refetch(toolInput.ref as string);
      return content ?? "Content not found";
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}
