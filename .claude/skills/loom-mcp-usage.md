---
name: loom-mcp-usage
description: How to use Loom MCP tools for codebase navigation, memory, and structured task execution
globs: ["**/*"]
---

# Using Loom MCP Tools

You have access to the Loom MCP server which provides codebase indexing, episodic memory, and structured graph execution. Use these tools proactively when they would help.

## Project Setup

Before using any Loom tools, a project must be active:

- **First time**: Call `loom_init({ path: "/absolute/path/to/project" })` to index the codebase
- **Returning**: Call `loom_open({ path: "/absolute/path" })` to switch to a previously initialized project
- **Check**: Call `loom_status()` to see which project is active

If a Loom tool returns "No project is active", call `loom_init` or `loom_open` first.

## Codebase Navigation (use instead of blind grepping)

When you need to understand code structure, prefer Loom's indexed map over raw file reads:

1. **Get overview**: `loom_map_query({ path: "src", depth: 1 })` — returns modules, file counts, exports, complexity scores
2. **Zoom in**: `loom_map_query({ path: "src/auth", depth: 2 })` — drill into a specific area
3. **Look up symbols**: `loom_expand_symbol({ symbolName: "validateToken" })` — get exact file, line range, signature
4. **Then read the actual code** only for the specific files you identified

This is faster and more targeted than grepping, especially in large codebases.

## Memory & Recall

Loom stores episodes from prior work sessions. Use these to avoid repeating past work:

- `loom_search({ query: "auth middleware fix" })` — full-text search over all past episodes
- `loom_related_episodes({ taskFingerprint: "..." })` — find episodes from identical prior tasks
- `loom_refetch({ ref: "01HXYZ..." })` — retrieve full content of a truncated/externalized result
- `loom_skill_lookup({ description: "code review" })` — find reusable skill patterns

## Structured Task Execution (Client-Driven)

For complex multi-step tasks, use client-driven graph execution. No local model or API key needed — you do the work, Loom handles scheduling and memory.

### Workflow:

```
1. loom_submit_graph({ task: "...", nodes: [...] })  → get first ready nodes
2. Execute the node (read files, edit, grep, etc.)
3. loom_report_result({ graphId, nodeId, output, status: "success" })  → get next nodes
4. Repeat until done=true
```

### When to use graphs:

- **Multi-step analysis**: analyze → implement → verify
- **Parallel investigation**: check multiple areas independently, then synthesize
- **Iterative refinement**: try → test → fix → retest

### Example graph for a code review:

```json
loom_submit_graph({
  task: "Review the auth module",
  nodes: [
    { "type": "step", "id": "map", "prompt": "Browse the auth module structure" },
    { "type": "step", "id": "bugs", "prompt": "Find bugs and edge cases", "dependsOn": ["map"] },
    { "type": "step", "id": "security", "prompt": "Audit for security issues", "dependsOn": ["map"] },
    { "type": "step", "id": "report", "prompt": "Synthesize findings", "dependsOn": ["bugs", "security"] }
  ]
})
```

Nodes with `dependsOn` only become ready after their dependencies complete. The dependency outputs are automatically passed to the next node.

### Node types:

- **step**: `{ type: "step", id, prompt, dependsOn? }` — a single unit of work
- **parallel**: `{ type: "parallel", id, branches: [nodes], merge: "all", dependsOn? }` — concurrent work
- **loop_until**: `{ type: "loop_until", id, body: [nodes], until: "condition", maxIterations?, dependsOn? }` — repeat until done

## Model-Driven Execution (requires Ollama or API key)

If a local model is available, `loom_weave({ task: "..." })` delegates the entire task — Loom generates the graph and executes all nodes internally. Use `loom_graph_status()` to see cached templates from prior runs.

## Decision Guide

| Situation | Tool |
|---|---|
| Need to understand code structure | `loom_map_query` → `loom_expand_symbol` |
| Looking for a specific function | `loom_expand_symbol` |
| Recalling past work | `loom_search` |
| Complex multi-step task (no model) | `loom_submit_graph` + `loom_report_result` |
| Delegating to local model | `loom_weave` |
| Switching projects | `loom_open` or `loom_init` |
