/**
 * Client-driven graph execution.
 *
 * Instead of Loom calling an LLM internally, the MCP caller (e.g. Claude)
 * authors the graph, executes each node itself, and reports results back.
 * Loom handles: validation, scheduling, episodic memory, template caching.
 */

import type { GraphId } from "../types/common.js";
import type { ExecutionGraph, GraphNode, StepNode, NodeResult, GraphExecution } from "../types/weaver.js";
import { GraphNodeSchema } from "../types/weaver.js";
import { validateGraph, flattenNodes, topologicalSort } from "./validator.js";
import { contentHash } from "../util/hash.js";
import { newGraphId, newEpisodeId } from "../util/id.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("weaver");

export interface PendingNode {
  id: string;
  type: string;
  prompt: string;
  tools: string[];
  dependencyOutputs: Record<string, string>;
}

export interface SubmitGraphResult {
  graphId: string;
  nodeCount: number;
  executionOrder: string[];
  readyNodes: PendingNode[];
}

export interface ReportResultResponse {
  done: boolean;
  graphId: string;
  completedNodeId: string;
  readyNodes: PendingNode[];
  summary?: string;
}

interface ActiveGraph {
  graph: ExecutionGraph;
  execution: GraphExecution;
  nodeOutputs: Map<string, string>;
  nodeStatuses: Map<string, "pending" | "running" | "success" | "failure" | "skipped">;
  executionOrder: string[];
  startedAt: number;
}

// In-memory store for active client-driven graphs
const activeGraphs = new Map<string, ActiveGraph>();

/**
 * Submit and validate a graph authored by the client.
 * Returns the first nodes ready to execute.
 */
export function submitGraph(
  task: string,
  nodesJson: unknown[],
  config?: { maxNodes?: number; maxLoopIterations?: number },
): SubmitGraphResult | { error: string } {
  // Validate each node against the schema
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodesJson.length; i++) {
    const result = GraphNodeSchema.safeParse(nodesJson[i]);
    if (!result.success) {
      return { error: `Invalid node at index ${i}: ${result.error.message}` };
    }
    nodes.push(result.data as GraphNode);
  }

  // Build the execution graph
  const graphJsonStr = JSON.stringify({ nodes });
  const hash = contentHash(graphJsonStr);
  const graph: ExecutionGraph = {
    id: newGraphId(),
    nodes,
    contentHash: hash,
    metadata: { task, createdAt: Date.now(), model: "client-driven" },
  };

  // Validate structure (cycles, budget, references)
  const validation = validateGraph(graph, {
    maxNodes: config?.maxNodes ?? 50,
    maxLoopIterations: config?.maxLoopIterations ?? 10,
  });
  if (!validation.ok) {
    return { error: validation.error.message };
  }

  // Topological sort for execution order
  const flat = flattenNodes(nodes);
  const order = topologicalSort(flat);

  // Initialize state
  const nodeStatuses = new Map<string, "pending" | "running" | "success" | "failure" | "skipped">();
  const nodeOutputs = new Map<string, string>();
  for (const n of flat) {
    nodeStatuses.set(n.id, "pending");
  }

  const execution: GraphExecution = {
    id: newGraphId() as unknown as string,
    graphId: graph.id,
    status: "running",
    results: new Map(),
    startedAt: Date.now(),
    totalTokensIn: 0,
    totalTokensOut: 0,
  };

  const active: ActiveGraph = {
    graph,
    execution,
    nodeOutputs,
    nodeStatuses,
    executionOrder: order,
    startedAt: Date.now(),
  };

  activeGraphs.set(graph.id, active);

  // Find first ready nodes (no dependencies)
  const readyNodes = getReadyNodes(active);

  log.info({ graphId: graph.id, nodeCount: flat.length, readyCount: readyNodes.length }, "Client-driven graph submitted");

  return {
    graphId: graph.id,
    nodeCount: flat.length,
    executionOrder: order,
    readyNodes,
  };
}

/**
 * Report the result of a node execution.
 * Returns the next nodes ready to execute, or done=true.
 */
export function reportResult(
  graphId: string,
  nodeId: string,
  output: string,
  status: "success" | "failure",
): ReportResultResponse | { error: string } {
  const active = activeGraphs.get(graphId as GraphId);
  if (!active) {
    return { error: `No active graph with ID "${graphId}"` };
  }

  if (!active.nodeStatuses.has(nodeId)) {
    return { error: `Unknown node ID "${nodeId}" in graph "${graphId}"` };
  }

  // Record the result
  active.nodeStatuses.set(nodeId, status);
  active.nodeOutputs.set(nodeId, output);

  const nodeResult: NodeResult = {
    nodeId,
    status,
    output,
    duration: Date.now() - active.startedAt,
    tokenUsage: { input: 0, output: 0 },
  };
  active.execution.results.set(nodeId, nodeResult);

  log.info({ graphId, nodeId, status }, "Client-driven node result reported");

  // If a node failed, skip its dependents
  if (status === "failure") {
    skipDependents(active, nodeId);
  }

  // Find next ready nodes
  const readyNodes = getReadyNodes(active);

  // Check if all done
  const allDone = [...active.nodeStatuses.values()].every(
    (s) => s === "success" || s === "failure" || s === "skipped",
  );

  if (allDone) {
    const anyFailed = [...active.nodeStatuses.values()].some(
      (s) => s === "failure" || s === "skipped",
    );
    active.execution.status = anyFailed ? "failed" : "completed";
    active.execution.completedAt = Date.now();

    // Build summary
    const results = [...active.execution.results.values()];
    const successCount = results.filter((r) => r.status === "success").length;
    const summary = `Graph ${graphId} completed: ${successCount}/${results.length} nodes succeeded in ${((Date.now() - active.startedAt) / 1000).toFixed(1)}s`;

    log.info({ graphId, status: active.execution.status, duration: Date.now() - active.startedAt }, "Client-driven graph completed");

    // Cleanup
    activeGraphs.delete(graphId as GraphId);

    return {
      done: true,
      graphId,
      completedNodeId: nodeId,
      readyNodes: [],
      summary,
    };
  }

  return {
    done: false,
    graphId,
    completedNodeId: nodeId,
    readyNodes,
  };
}

/**
 * Get the execution state of an active graph.
 */
export function getActiveGraph(graphId: string): ActiveGraph | undefined {
  return activeGraphs.get(graphId as GraphId);
}

// --- Internal helpers ---

function getReadyNodes(active: ActiveGraph): PendingNode[] {
  const ready: PendingNode[] = [];
  const flat = flattenNodes(active.graph.nodes);
  const nodeMap = new Map(flat.map((n) => [n.id, n]));

  for (const nodeId of active.executionOrder) {
    const status = active.nodeStatuses.get(nodeId);
    if (status !== "pending") continue;

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Check all dependencies are satisfied
    const allDepsSatisfied = node.dependsOn.every((depId) => {
      const depStatus = active.nodeStatuses.get(depId);
      return depStatus === "success";
    });

    // Check no dependency failed (which would mean this node should be skipped)
    const anyDepFailed = node.dependsOn.some((depId) => {
      const depStatus = active.nodeStatuses.get(depId);
      return depStatus === "failure" || depStatus === "skipped";
    });

    if (anyDepFailed) {
      active.nodeStatuses.set(nodeId, "skipped");
      continue;
    }

    if (!allDepsSatisfied) continue;

    // Build dependency outputs
    const dependencyOutputs: Record<string, string> = {};
    for (const depId of node.dependsOn) {
      const depOutput = active.nodeOutputs.get(depId);
      if (depOutput) dependencyOutputs[depId] = depOutput;
    }

    // Extract prompt and tools from step nodes
    const prompt = node.type === "step" ? (node as StepNode).prompt : `Execute ${node.type} node "${node.id}"`;
    const tools = node.type === "step" ? ((node as StepNode).tools ?? []) : [];

    active.nodeStatuses.set(nodeId, "running");

    ready.push({
      id: nodeId,
      type: node.type,
      prompt,
      tools,
      dependencyOutputs,
    });
  }

  return ready;
}

function skipDependents(active: ActiveGraph, failedNodeId: string): void {
  const flat = flattenNodes(active.graph.nodes);
  for (const node of flat) {
    if (node.dependsOn.includes(failedNodeId)) {
      if (active.nodeStatuses.get(node.id) === "pending") {
        active.nodeStatuses.set(node.id, "skipped");
        skipDependents(active, node.id);
      }
    }
  }
}
