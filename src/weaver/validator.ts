import type { Result } from "../types/common.js";
import { ok, err, loomError, ERROR_CODES } from "../types/common.js";
import type { ExecutionGraph, GraphNode } from "../types/weaver.js";

export interface ValidationConfig {
  maxNodes: number;
  maxLoopIterations: number;
}

const DEFAULT_CONFIG: ValidationConfig = {
  maxNodes: 50,
  maxLoopIterations: 10,
};

/**
 * Validate an execution graph for structural correctness.
 */
export function validateGraph(
  graph: ExecutionGraph,
  config: ValidationConfig = DEFAULT_CONFIG,
): Result<void> {
  // 1. Collect all node IDs
  const allIds = new Set<string>();
  const nodes = flattenNodes(graph.nodes);

  // Check total node count
  if (nodes.length > config.maxNodes) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_BUDGET_EXCEEDED,
        `Graph has ${nodes.length} nodes, exceeding the limit of ${config.maxNodes}`,
      ),
    );
  }

  // 2. Check for duplicate IDs
  for (const node of nodes) {
    if (allIds.has(node.id)) {
      return err(
        loomError(
          ERROR_CODES.WEAVER_INVALID_GRAPH,
          `Duplicate node ID: "${node.id}"`,
        ),
      );
    }
    allIds.add(node.id);
  }

  // 3. Check dependency references
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!allIds.has(dep)) {
        return err(
          loomError(
            ERROR_CODES.WEAVER_INVALID_GRAPH,
            `Node "${node.id}" depends on unknown node "${dep}"`,
          ),
        );
      }
    }
  }

  // 4. Check for cycles using DFS
  const cycleCheck = detectCycles(nodes);
  if (cycleCheck) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_CYCLE_DETECTED,
        `Cycle detected involving node "${cycleCheck}"`,
      ),
    );
  }

  // 5. Validate loop iterations
  for (const node of graph.nodes) {
    if (
      node.type === "loop_until" &&
      node.maxIterations > config.maxLoopIterations
    ) {
      return err(
        loomError(
          ERROR_CODES.WEAVER_BUDGET_EXCEEDED,
          `Loop "${node.id}" has maxIterations=${node.maxIterations}, exceeding limit of ${config.maxLoopIterations}`,
        ),
      );
    }
  }

  return ok(undefined);
}

/**
 * Flatten all nodes from a graph, including nested parallel branches and loop bodies.
 */
export function flattenNodes(nodes: GraphNode[]): GraphNode[] {
  const result: GraphNode[] = [];

  for (const node of nodes) {
    result.push(node);

    if (node.type === "parallel") {
      result.push(...flattenNodes(node.branches));
    } else if (node.type === "loop_until") {
      result.push(...flattenNodes(node.body));
    }
  }

  return result;
}

/**
 * Detect cycles in the dependency graph using DFS.
 * Returns the ID of a node involved in a cycle, or null if none.
 */
function detectCycles(nodes: GraphNode[]): string | null {
  const WHITE = 0; // Unvisited
  const GRAY = 1; // In current DFS path
  const BLACK = 2; // Fully processed

  const colors = new Map<string, number>();
  for (const node of nodes) {
    colors.set(node.id, WHITE);
  }

  // Build adjacency list from dependsOn (reversed: if A dependsOn B, edge is B -> A)
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    if (!adjacency.has(node.id)) {
      adjacency.set(node.id, []);
    }
    for (const dep of node.dependsOn) {
      const edges = adjacency.get(dep) ?? [];
      edges.push(node.id);
      adjacency.set(dep, edges);
    }
  }

  function dfs(nodeId: string): string | null {
    colors.set(nodeId, GRAY);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      const color = colors.get(neighbor);
      if (color === GRAY) return neighbor; // Cycle found
      if (color === WHITE) {
        const result = dfs(neighbor);
        if (result) return result;
      }
    }

    colors.set(nodeId, BLACK);
    return null;
  }

  for (const node of nodes) {
    if (colors.get(node.id) === WHITE) {
      const result = dfs(node.id);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Topological sort of nodes based on dependsOn edges.
 * Returns node IDs in execution order.
 */
export function topologicalSort(nodes: GraphNode[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, node.dependsOn.length);
    if (!adjacency.has(node.id)) {
      adjacency.set(node.id, []);
    }
    for (const dep of node.dependsOn) {
      const edges = adjacency.get(dep) ?? [];
      edges.push(node.id);
      adjacency.set(dep, edges);
    }
  }

  // Start with nodes that have no dependencies
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    sorted.push(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  return sorted;
}
