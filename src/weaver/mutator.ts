import type { Result } from "../types/common.js";
import { ok, err, loomError, ERROR_CODES } from "../types/common.js";
import type {
  ExecutionGraph,
  GraphNode,
  WeaveMutation,
} from "../types/weaver.js";
import { flattenNodes } from "./validator.js";

/**
 * Apply a mutation to an execution graph.
 * Returns a new graph (immutable operation) or an error.
 */
export function applyMutation(
  graph: ExecutionGraph,
  mutation: WeaveMutation,
): Result<ExecutionGraph> {
  // Validate: check that new node IDs don't collide
  const existingIds = new Set(flattenNodes(graph.nodes).map((n) => n.id));
  for (const newNode of flattenNodes(mutation.nodes)) {
    if (existingIds.has(newNode.id)) {
      return err(
        loomError(
          ERROR_CODES.WEAVER_MUTATION_INVALID,
          `New node ID "${newNode.id}" already exists in the graph`,
        ),
      );
    }
  }

  // Validate: target node must exist
  const targetExists = existingIds.has(mutation.targetNodeId);
  if (!targetExists) {
    return err(
      loomError(
        ERROR_CODES.WEAVER_MUTATION_INVALID,
        `Target node "${mutation.targetNodeId}" not found in graph`,
      ),
    );
  }

  let newNodes: GraphNode[];

  switch (mutation.action) {
    case "insert_after":
      newNodes = spliceAfter(graph.nodes, mutation.targetNodeId, mutation.nodes);
      break;

    case "insert_before":
      newNodes = spliceBefore(graph.nodes, mutation.targetNodeId, mutation.nodes);
      break;

    case "replace":
      newNodes = replaceNode(graph.nodes, mutation.targetNodeId, mutation.nodes);
      break;

    case "append_to_loop":
      newNodes = appendToLoop(graph.nodes, mutation.targetNodeId, mutation.nodes);
      if (newNodes === graph.nodes) {
        return err(
          loomError(
            ERROR_CODES.WEAVER_MUTATION_INVALID,
            `Target node "${mutation.targetNodeId}" is not a loop_until node`,
          ),
        );
      }
      break;

    default:
      return err(
        loomError(
          ERROR_CODES.WEAVER_MUTATION_INVALID,
          `Unknown mutation action: ${mutation.action}`,
        ),
      );
  }

  return ok({
    ...graph,
    nodes: newNodes,
  });
}

function spliceAfter(
  nodes: GraphNode[],
  targetId: string,
  newNodes: GraphNode[],
): GraphNode[] {
  const result: GraphNode[] = [];

  for (const node of nodes) {
    // Recurse into parallel branches and loop bodies
    const processed = recurseIntoCompound(node, (children) =>
      spliceAfter(children, targetId, newNodes),
    );
    result.push(processed);

    if (node.id === targetId) {
      // Insert new nodes after target, making them depend on target
      for (const newNode of newNodes) {
        result.push({
          ...newNode,
          dependsOn: [...newNode.dependsOn, targetId],
        });
      }
    }
  }

  return result;
}

function spliceBefore(
  nodes: GraphNode[],
  targetId: string,
  newNodes: GraphNode[],
): GraphNode[] {
  const result: GraphNode[] = [];

  for (const node of nodes) {
    if (node.id === targetId) {
      // Insert new nodes before target
      result.push(...newNodes);
      // Make target depend on the last new node
      const lastNewId = newNodes[newNodes.length - 1]?.id;
      if (lastNewId) {
        result.push({
          ...node,
          dependsOn: [...node.dependsOn, lastNewId],
        });
        continue;
      }
    }
    result.push(node);
  }

  return result;
}

function replaceNode(
  nodes: GraphNode[],
  targetId: string,
  newNodes: GraphNode[],
): GraphNode[] {
  const result: GraphNode[] = [];

  for (const node of nodes) {
    if (node.id === targetId) {
      // Replace with new nodes, preserving dependencies
      for (const newNode of newNodes) {
        result.push({
          ...newNode,
          dependsOn: [...new Set([...newNode.dependsOn, ...node.dependsOn])],
        });
      }
    } else {
      // Update any references to the old node
      if (node.dependsOn.includes(targetId) && newNodes.length > 0) {
        const lastNewId = newNodes[newNodes.length - 1]!.id;
        result.push({
          ...node,
          dependsOn: node.dependsOn.map((d) =>
            d === targetId ? lastNewId : d,
          ),
        });
      } else {
        result.push(node);
      }
    }
  }

  return result;
}

function appendToLoop(
  nodes: GraphNode[],
  targetId: string,
  newNodes: GraphNode[],
): GraphNode[] {
  return nodes.map((node) => {
    if (node.id === targetId && node.type === "loop_until") {
      return {
        ...node,
        body: [...node.body, ...newNodes],
      };
    }
    return node;
  });
}

/**
 * Recurse into parallel branches and loop bodies to apply a transformation.
 */
function recurseIntoCompound(
  node: GraphNode,
  transform: (children: GraphNode[]) => GraphNode[],
): GraphNode {
  if (node.type === "parallel") {
    return {
      ...node,
      branches: transform(node.branches),
    };
  }
  if (node.type === "loop_until") {
    return {
      ...node,
      body: transform(node.body),
    };
  }
  return node;
}
