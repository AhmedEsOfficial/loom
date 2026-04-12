# Graph Authoring

How to design and emit execution graphs that decompose tasks effectively using the Weaver's 3 node types.

## Overview

When Loom receives a task, the planner model generates an execution graph inside `<graph>` tags. The graph is JSON with a `nodes` array. Loom validates the graph (cycles, budget, references), then executes it.

A well-designed graph:
- Decomposes the task into specific, independent steps
- Uses dependencies to enforce ordering where needed
- Parallelizes independent work
- Uses loops for iterative refinement

## The 3 node types

### step — a single model call

```json
{
  "type": "step",
  "id": "analyze-auth",
  "prompt": "Search the codebase for all auth-related files. List their paths, exported functions, and how they connect to each other.",
  "model": "worker",
  "tools": ["substrate_search", "substrate_expand_symbol", "map_query"],
  "dependsOn": []
}
```

**Fields:**
- `id` (required) — Unique within the graph. Use descriptive kebab-case names.
- `prompt` (required) — The instruction. Be specific. The step only sees its own prompt + dependency outputs + substrate tools. It does NOT see the original task or other steps' prompts.
- `model` — One of `"planner"` (for reasoning/synthesis), `"worker"` (for execution), `"critic"` (for review). Default: `"worker"`.
- `tools` — Array of tool names available to this step. Available: `substrate_search`, `substrate_expand_symbol`, `substrate_related_episodes`, `substrate_skill_lookup`, `map_query`, `refetch`.
- `dependsOn` — Array of node IDs that must complete before this step runs. The step receives the outputs of its dependencies as context.
- `maxTokens` — Override the default output token limit (4096).
- `timeout` — Override the default per-node timeout (300000ms = 5 min).

### parallel — concurrent branches

```json
{
  "type": "parallel",
  "id": "implement-features",
  "branches": [
    { "type": "step", "id": "build-api", "prompt": "Implement the REST API endpoints..." },
    { "type": "step", "id": "build-ui", "prompt": "Build the React components..." },
    { "type": "step", "id": "write-tests", "prompt": "Write integration tests..." }
  ],
  "merge": "all",
  "dependsOn": ["analyze"]
}
```

**Fields:**
- `branches` (required) — Array of GraphNodes to execute concurrently. Each branch runs in its own context.
- `merge` — How to combine outputs: `"all"` (concatenate all), `"first"` (take the first to complete), `"majority"` (take the majority view). Default: `"all"`.
- `dependsOn` — The parallel node itself waits for these before starting any branch.

### loop_until — iterative refinement

```json
{
  "type": "loop_until",
  "id": "test-fix-cycle",
  "body": [
    { "type": "step", "id": "run-tests", "prompt": "Run the test suite and report results." },
    { "type": "step", "id": "fix-issues", "prompt": "Fix any failing tests based on the error output.", "dependsOn": ["run-tests"] }
  ],
  "until": "All tests pass with zero failures",
  "maxIterations": 5,
  "dependsOn": ["implement-features"]
}
```

**Fields:**
- `body` (required) — Array of nodes to execute each iteration. Internal `dependsOn` within the body are respected.
- `until` (required) — A natural language condition. After each iteration, a cheap model evaluates whether the last body node's output satisfies this condition (YES/NO classification).
- `maxIterations` — Safety cap. Default: 10. The graph validator enforces a configured maximum.

## Graph structure rules

1. **No cycles.** The validator runs DFS cycle detection on all `dependsOn` edges. A cycle causes the graph to be rejected.
2. **All references must exist.** If node A `dependsOn: ["B"]`, node B must exist in the graph.
3. **No duplicate IDs.** Every node (including those nested in parallel branches and loop bodies) must have a unique ID.
4. **Budget limits.** The total flattened node count must not exceed the configured `maxNodes` (default: 50).

## Emission format

Wrap the graph in `<graph>` tags:

```
<graph task="short description of the task">
{
  "nodes": [
    ...
  ]
}
</graph>
```

The `task` attribute on the tag is metadata — the actual execution comes from the JSON.

## Writing effective prompts

Each step node's `prompt` is the **only instruction** that step sees. It also receives:
- Distilled outputs from its dependency nodes
- Access to the tools listed in its `tools` array

**Do:**
- Be specific and self-contained: "Search for files containing `UserService` and list their exports"
- Reference what the step should produce: "Output a JSON list of the changed files and the specific changes made"
- Give context from the dependency chain: the step will automatically receive dependency outputs

**Don't:**
- Write vague prompts: "Look into the issue" (which issue? what to look for?)
- Assume the step knows the overall task (it doesn't see the original user request)
- List tools the step doesn't need (it adds noise to the context)

## Model role selection

| Role | Use for | Characteristics |
|---|---|---|
| `planner` | Analysis, architecture decisions, synthesis | More capable, slower, higher cost |
| `worker` | Implementation, code changes, data processing | Balanced capability and cost |
| `critic` | Code review, verification, quality checks | Used for independent review of other nodes' work |

A common pattern: planner analyzes → worker implements → critic reviews.
