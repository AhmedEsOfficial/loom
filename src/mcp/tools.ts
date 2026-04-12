import type { LoomKernel } from "../kernel.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export function createMcpTools(kernel: LoomKernel): McpToolDefinition[] {
  return [
    {
      name: "loom_search",
      description: "Full-text search over Loom's episodic memory and skill store",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default: 20)" },
        },
        required: ["query"],
      },
      handler: async (input) => {
        const results = await kernel.substrate.search(
          input.query as string,
          { limit: (input.limit as number) ?? 20 },
        );
        return JSON.stringify(results, null, 2);
      },
    },
    {
      name: "loom_expand_symbol",
      description: "Get detailed information about a code symbol from the AST index",
      inputSchema: {
        type: "object",
        properties: {
          symbolName: { type: "string", description: "Symbol name" },
          filePath: { type: "string", description: "Optional file path" },
        },
        required: ["symbolName"],
      },
      handler: async (input) => {
        const result = await kernel.substrate.expandSymbol(
          input.symbolName as string,
          input.filePath as string | undefined,
        );
        return result ? JSON.stringify(result, null, 2) : "Symbol not found";
      },
    },
    {
      name: "loom_related_episodes",
      description: "Find episodes related to a task fingerprint",
      inputSchema: {
        type: "object",
        properties: {
          taskFingerprint: { type: "string", description: "Task fingerprint" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["taskFingerprint"],
      },
      handler: async (input) => {
        const episodes = await kernel.substrate.relatedEpisodes(
          input.taskFingerprint as string,
          (input.limit as number) ?? 10,
        );
        return JSON.stringify(episodes, null, 2);
      },
    },
    {
      name: "loom_map_query",
      description: "Browse the codebase map at a given path",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory path" },
          depth: { type: "number", description: "Depth of children to include (default: 1)" },
        },
        required: ["path"],
      },
      handler: async (input) => {
        const node = await kernel.cartographer.zoomTo(input.path as string);
        if (!node) return "Path not found in codebase map";

        const children = await kernel.cartographer.queryMap(
          node.id,
          (input.depth as number) ?? 1,
        );
        return JSON.stringify(children, null, 2);
      },
    },
    {
      name: "loom_skill_lookup",
      description: "Find skills matching a description",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Description of the capability" },
        },
        required: ["description"],
      },
      handler: async (input) => {
        const skills = await kernel.substrate.skillLookup(
          input.description as string,
        );
        return JSON.stringify(skills, null, 2);
      },
    },
    {
      name: "loom_weave",
      description: "Submit a task for graph-based execution. Loom will generate and execute an execution graph.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
        },
        required: ["task"],
      },
      handler: async (input) => {
        const result = await kernel.run(input.task as string);
        return JSON.stringify(
          {
            success: result.success,
            error: result.error,
            graphId: result.graphId,
            nodeCount: result.nodeResults?.length ?? 0,
            duration: `${(result.duration / 1000).toFixed(1)}s`,
            tokenUsage: result.tokenUsage,
            nodeResults: result.nodeResults?.map((nr) => ({
              nodeId: nr.nodeId,
              status: nr.status,
              output: nr.output.slice(0, 500),
            })),
          },
          null,
          2,
        );
      },
    },
    {
      name: "loom_graph_status",
      description: "List cached graph templates and their success rates",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default: 10)" },
        },
      },
      handler: async (input) => {
        const templates = kernel.graphCache.list((input.limit as number) ?? 10);
        return JSON.stringify(
          templates.map((t) => ({
            id: t.id,
            pattern: t.taskPattern,
            successRate:
              t.successCount + t.failureCount > 0
                ? `${((t.successCount / (t.successCount + t.failureCount)) * 100).toFixed(0)}%`
                : "N/A",
            avgDuration: t.avgDuration ? `${(t.avgDuration / 1000).toFixed(1)}s` : null,
          })),
          null,
          2,
        );
      },
    },
    {
      name: "loom_refetch",
      description: "Re-fetch externalized content by substrate reference",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Substrate reference ID" },
        },
        required: ["ref"],
      },
      handler: async (input) => {
        const content = await kernel.substrate.refetch(input.ref as string);
        return content ?? "Content not found";
      },
    },
  ];
}
