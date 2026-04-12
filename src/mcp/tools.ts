import type { LoomKernel } from "../kernel.js";
import type { GraphId, NodeId } from "../types/common.js";
import { submitGraph, reportResult } from "../weaver/client-driven.js";
import type { KernelManager } from "./kernel-manager.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * Create MCP tools backed by a KernelManager (supports project switching).
 */
export function createManagedMcpTools(manager: KernelManager): McpToolDefinition[] {
  // Helper: get the active kernel or return an error string
  const k = (): LoomKernel => manager.requireKernel();

  return [
    {
      name: "loom_init",
      description:
        "Initialize Loom in a project directory. Creates .loom/, builds the codebase map (AST index), " +
        "and switches the active project to this directory. Run this before using other Loom tools on a new project.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the project directory to initialize" },
        },
        required: ["path"],
      },
      handler: async (input) => {
        try {
          const result = await manager.initProject(input.path as string);
          return JSON.stringify({
            success: true,
            projectPath: input.path,
            ...result,
            message: `Loom initialized. Indexed ${result.fileCount} files, ${result.nodeCount} map nodes. All loom tools now operate on this project.`,
          }, null, 2);
        } catch (error: any) {
          return JSON.stringify({ success: false, error: error.message }, null, 2);
        }
      },
    },
    {
      name: "loom_open",
      description:
        "Switch to an already-initialized Loom project (must have a .loom/ directory). " +
        "Use this when the project was previously initialized with loom_init and you want to switch back to it.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the project directory" },
        },
        required: ["path"],
      },
      handler: async (input) => {
        try {
          await manager.openProject(input.path as string);
          return JSON.stringify({
            success: true,
            projectPath: input.path,
            message: `Switched to project at ${input.path}. All loom tools now operate on this project.`,
          }, null, 2);
        } catch (error: any) {
          return JSON.stringify({ success: false, error: error.message }, null, 2);
        }
      },
    },
    {
      name: "loom_status",
      description: "Show the currently active Loom project and its status.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        if (!manager.isInitialized) {
          return JSON.stringify({
            active: false,
            message: "No project is active. Call loom_init or loom_open first.",
          }, null, 2);
        }
        const kernel = k();
        return JSON.stringify({
          active: true,
          projectPath: manager.projectPath,
          providers: k().config.providers.map((p) => p.name),
          modelRoles: k().config.modelRoles,
        }, null, 2);
      },
    },
    ...createMcpTools(manager),
  ];
}

/**
 * Create the core MCP tools (requires an active kernel via manager).
 */
function createMcpTools(manager: KernelManager): McpToolDefinition[] {
  const k = (): LoomKernel => manager.requireKernel();

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
        const results = await k().substrate.search(
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
        const result = await k().substrate.expandSymbol(
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
        const episodes = await k().substrate.relatedEpisodes(
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
        const node = await k().cartographer.zoomTo(input.path as string);
        if (!node) return "Path not found in codebase map";

        const children = await k().cartographer.queryMap(
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
        const skills = await k().substrate.skillLookup(
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
        const result = await k().run(input.task as string);
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
        const templates = k().graphCache.list((input.limit as number) ?? 10);
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
        const content = await k().substrate.refetch(input.ref as string);
        return content ?? "Content not found";
      },
    },
    {
      name: "loom_submit_graph",
      description:
        `Submit an execution graph for client-driven execution. No local model or API key required — YOU are the executor. ` +
        `Author a graph with step nodes, submit it here for validation and scheduling, then execute each node yourself and report results via loom_report_result. ` +
        `Loom handles: validation, dependency scheduling, episodic memory, and template caching.\n\n` +
        `Graph node types:\n` +
        `- step: { type: "step", id: string, prompt: string, dependsOn?: string[], tools?: string[] }\n` +
        `- parallel: { type: "parallel", id: string, branches: node[], merge: "all"|"first"|"majority", dependsOn?: string[] }\n` +
        `- loop_until: { type: "loop_until", id: string, body: node[], until: string, maxIterations?: number, dependsOn?: string[] }\n\n` +
        `Returns the first nodes ready to execute with their prompts and dependency outputs.`,
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
          nodes: {
            type: "array",
            description: "Array of graph nodes (step, parallel, or loop_until)",
            items: { type: "object" },
          },
        },
        required: ["task", "nodes"],
      },
      handler: async (input) => {
        const result = submitGraph(
          input.task as string,
          input.nodes as unknown[],
          {
            maxNodes: k().config.weaver.maxNodes,
            maxLoopIterations: k().config.weaver.maxLoopIterations,
          },
        );
        return JSON.stringify(result, null, 2);
      },
    },
    {
      name: "loom_report_result",
      description:
        `Report the result of executing a node in a client-driven graph. ` +
        `After executing a node (doing the work described in its prompt), call this to record the result. ` +
        `Loom stores the result as an episode, advances the scheduler, and returns the next nodes ready to execute. ` +
        `When done=true, the graph is complete.`,
      inputSchema: {
        type: "object",
        properties: {
          graphId: { type: "string", description: "Graph ID from loom_submit_graph" },
          nodeId: { type: "string", description: "ID of the node you executed" },
          output: { type: "string", description: "Your output/result from executing this node" },
          status: { type: "string", description: '"success" or "failure"' },
        },
        required: ["graphId", "nodeId", "output", "status"],
      },
      handler: async (input) => {
        const result = reportResult(
          input.graphId as string,
          input.nodeId as string,
          input.output as string,
          input.status as "success" | "failure",
        );

        // If completed successfully, store episodes in substrate
        if ("done" in result && result.done) {
          try {
            await k().substrate.storeEpisode({
              role: "assistant",
              content: input.output as string,
              toolName: "client_driven_graph",
              toolInput: JSON.stringify({ graphId: input.graphId, nodeId: input.nodeId }),
              graphId: input.graphId as GraphId,
              nodeId: input.nodeId as NodeId,
              taskFingerprint: "",
              tokenCount: 0,
            });
          } catch {
            // Non-fatal: episode storage failure shouldn't block the response
          }
        }

        return JSON.stringify(result, null, 2);
      },
    },
  ];
}
