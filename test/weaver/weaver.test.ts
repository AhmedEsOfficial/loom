import { describe, it, expect } from "vitest";
import { parseGraph, parseWeaveMutations, stripTags } from "../../src/weaver/dsl.js";
import { validateGraph, topologicalSort, flattenNodes } from "../../src/weaver/validator.js";
import { applyMutation } from "../../src/weaver/mutator.js";
import type { ExecutionGraph, GraphNode } from "../../src/types/weaver.js";
import type { GraphId } from "../../src/types/common.js";

describe("Weaver DSL", () => {
  it("should parse a valid graph from model output", () => {
    const input = `Here's the plan:

<graph task="test task">
{
  "nodes": [
    {"type": "step", "id": "analyze", "prompt": "Analyze the code", "model": "planner"},
    {"type": "step", "id": "fix", "prompt": "Fix the bug", "model": "worker", "dependsOn": ["analyze"]}
  ]
}
</graph>

That should work.`;

    const result = parseGraph(input, "test task");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.nodes).toHaveLength(2);
    expect(result.value.nodes[0]!.id).toBe("analyze");
    expect(result.value.nodes[1]!.id).toBe("fix");
    expect(result.value.contentHash).toBeTruthy();
  });

  it("should parse a graph with parallel and loop_until nodes", () => {
    const input = `<graph task="complex">
{
  "nodes": [
    {
      "type": "parallel",
      "id": "impl",
      "branches": [
        {"type": "step", "id": "a", "prompt": "Do A"},
        {"type": "step", "id": "b", "prompt": "Do B"}
      ],
      "merge": "all"
    },
    {
      "type": "loop_until",
      "id": "verify",
      "dependsOn": ["impl"],
      "body": [
        {"type": "step", "id": "test", "prompt": "Run tests"},
        {"type": "step", "id": "fix", "prompt": "Fix failures", "dependsOn": ["test"]}
      ],
      "until": "All tests pass",
      "maxIterations": 5
    }
  ]
}
</graph>`;

    const result = parseGraph(input, "complex");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.nodes).toHaveLength(2);
    expect(result.value.nodes[0]!.type).toBe("parallel");
    expect(result.value.nodes[1]!.type).toBe("loop_until");
  });

  it("should reject input without a graph tag", () => {
    const result = parseGraph("No graph here", "test");
    expect(result.ok).toBe(false);
  });

  it("should reject invalid JSON", () => {
    const result = parseGraph('<graph task="t">{broken json}</graph>', "test");
    expect(result.ok).toBe(false);
  });

  it("should reject missing nodes array", () => {
    const result = parseGraph('<graph task="t">{"foo": "bar"}</graph>', "test");
    expect(result.ok).toBe(false);
  });

  it("should parse weave mutations from output", () => {
    const output = `I found the issue.

<weave>
{
  "action": "insert_after",
  "targetNodeId": "analyze",
  "nodes": [
    {"type": "step", "id": "extra", "prompt": "Extra step"}
  ]
}
</weave>

Done.`;

    const mutations = parseWeaveMutations(output);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]!.action).toBe("insert_after");
    expect(mutations[0]!.targetNodeId).toBe("analyze");
  });

  it("should strip graph and weave tags from output", () => {
    const output = 'Before <graph task="t">{"nodes":[]}</graph> middle <weave>{"action":"insert_after","targetNodeId":"x","nodes":[]}</weave> after';
    const stripped = stripTags(output);
    expect(stripped).toBe("Before  middle  after");
  });
});

describe("Weaver Validator", () => {
  function makeGraph(nodes: GraphNode[]): ExecutionGraph {
    return {
      id: "test" as GraphId,
      nodes,
      contentHash: "test",
      metadata: { task: "test", createdAt: 0, model: "test" },
    };
  }

  it("should validate a correct graph", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
      { type: "step", id: "b", prompt: "B", model: "worker", dependsOn: ["a"] },
    ]);

    const result = validateGraph(graph);
    expect(result.ok).toBe(true);
  });

  it("should detect duplicate node IDs", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
      { type: "step", id: "a", prompt: "B", model: "worker", dependsOn: [] },
    ]);

    const result = validateGraph(graph);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WEAVER_INVALID_GRAPH");
    }
  });

  it("should detect unknown dependency references", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: ["nonexistent"] },
    ]);

    const result = validateGraph(graph);
    expect(result.ok).toBe(false);
  });

  it("should detect cycles", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: ["b"] },
      { type: "step", id: "b", prompt: "B", model: "worker", dependsOn: ["a"] },
    ]);

    const result = validateGraph(graph);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WEAVER_CYCLE_DETECTED");
    }
  });

  it("should enforce node count limits", () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push({ type: "step", id: `n${i}`, prompt: "x", model: "worker", dependsOn: [] });
    }

    const graph = makeGraph(nodes);
    const result = validateGraph(graph, { maxNodes: 5, maxLoopIterations: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WEAVER_BUDGET_EXCEEDED");
    }
  });

  it("should flatten nested nodes", () => {
    const nodes: GraphNode[] = [
      {
        type: "parallel",
        id: "p",
        branches: [
          { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
          { type: "step", id: "b", prompt: "B", model: "worker", dependsOn: [] },
        ],
        merge: "all",
        dependsOn: [],
      },
    ];

    const flat = flattenNodes(nodes);
    expect(flat).toHaveLength(3); // parallel + 2 steps
  });

  it("should topologically sort nodes", () => {
    const nodes: GraphNode[] = [
      { type: "step", id: "c", prompt: "C", model: "worker", dependsOn: ["a", "b"] },
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
      { type: "step", id: "b", prompt: "B", model: "worker", dependsOn: ["a"] },
    ];

    const order = topologicalSort(nodes);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
});

describe("Weaver Mutator", () => {
  function makeGraph(nodes: GraphNode[]): ExecutionGraph {
    return {
      id: "test" as GraphId,
      nodes,
      contentHash: "test",
      metadata: { task: "test", createdAt: 0, model: "test" },
    };
  }

  it("should insert a node after a target", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
      { type: "step", id: "b", prompt: "B", model: "worker", dependsOn: ["a"] },
    ]);

    const result = applyMutation(graph, {
      action: "insert_after",
      targetNodeId: "a",
      nodes: [
        { type: "step", id: "c", prompt: "C", model: "worker", dependsOn: [] },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes).toHaveLength(3);
      const nodeC = result.value.nodes.find((n) => n.id === "c");
      expect(nodeC).toBeTruthy();
      expect(nodeC!.dependsOn).toContain("a");
    }
  });

  it("should reject mutations with colliding IDs", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
    ]);

    const result = applyMutation(graph, {
      action: "insert_after",
      targetNodeId: "a",
      nodes: [
        { type: "step", id: "a", prompt: "Duplicate", model: "worker", dependsOn: [] },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("should reject mutations targeting nonexistent nodes", () => {
    const graph = makeGraph([
      { type: "step", id: "a", prompt: "A", model: "worker", dependsOn: [] },
    ]);

    const result = applyMutation(graph, {
      action: "insert_after",
      targetNodeId: "nonexistent",
      nodes: [
        { type: "step", id: "b", prompt: "B", model: "worker", dependsOn: [] },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("should append nodes to a loop body", () => {
    const graph = makeGraph([
      {
        type: "loop_until",
        id: "loop",
        body: [
          { type: "step", id: "test", prompt: "Test", model: "worker", dependsOn: [] },
        ],
        until: "tests pass",
        maxIterations: 5,
        dependsOn: [],
      },
    ]);

    const result = applyMutation(graph, {
      action: "append_to_loop",
      targetNodeId: "loop",
      nodes: [
        { type: "step", id: "fix", prompt: "Fix", model: "worker", dependsOn: [] },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const loop = result.value.nodes[0]!;
      expect(loop.type).toBe("loop_until");
      if (loop.type === "loop_until") {
        expect(loop.body).toHaveLength(2);
      }
    }
  });
});
