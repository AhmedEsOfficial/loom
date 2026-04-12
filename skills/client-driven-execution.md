# Client-Driven Graph Execution

Execute Loom graphs without any local model or API key. You author the graph, do the work, and report results back. Loom handles validation, dependency scheduling, episodic memory, and template caching.

## When to use this

- No local model available (no Ollama, no API key)
- You (the calling model) are more capable than the local model
- You want full control over each step's execution
- You need to use your own tools (file reads, edits, shell commands) during execution

## The workflow

```
1. You author a graph         → loom_submit_graph (validates, schedules)
2. Loom returns ready nodes   → you get prompts + dependency outputs
3. You execute the node       → read files, run commands, think, etc.
4. You report the result      → loom_report_result (stores episode, advances)
5. Repeat from step 2         → until done=true
```

## Example: Code review with fix

### Step 1: Submit the graph

```
loom_submit_graph({
  task: "Review and fix the auth module",
  nodes: [
    {
      "type": "step",
      "id": "analyze",
      "prompt": "Find all security issues in the auth module"
    },
    {
      "type": "step",
      "id": "fix",
      "prompt": "Fix the security issues found during analysis",
      "dependsOn": ["analyze"]
    },
    {
      "type": "step",
      "id": "verify",
      "prompt": "Verify the fixes are correct and don't break anything",
      "dependsOn": ["fix"]
    }
  ]
})
```

**Response:**
```json
{
  "graphId": "01HXYZ...",
  "nodeCount": 3,
  "executionOrder": ["analyze", "fix", "verify"],
  "readyNodes": [
    {
      "id": "analyze",
      "prompt": "Find all security issues in the auth module",
      "dependencyOutputs": {}
    }
  ]
}
```

### Step 2: Execute the "analyze" node

You do the actual work — read files, grep for patterns, use `loom_expand_symbol`, etc. Then report back:

```
loom_report_result({
  graphId: "01HXYZ...",
  nodeId: "analyze",
  output: "Found 2 issues: 1) JWT tokens not validated for expiry in jwt.ts:45, 2) No rate limiting on login endpoint in api.ts:23",
  status: "success"
})
```

**Response:**
```json
{
  "done": false,
  "readyNodes": [
    {
      "id": "fix",
      "prompt": "Fix the security issues found during analysis",
      "dependencyOutputs": {
        "analyze": "Found 2 issues: 1) JWT tokens not validated..."
      }
    }
  ]
}
```

### Step 3: Execute the "fix" node

The dependency output from "analyze" flows into "fix" — you know what to fix. Do the work, then report:

```
loom_report_result({
  graphId: "01HXYZ...",
  nodeId: "fix",
  output: "Added expiry check in jwt.ts, added rate limiter middleware in api.ts",
  status: "success"
})
```

### Step 4: Execute "verify" and complete

Continue until the response shows `"done": true`.

## Combining with other Loom tools

During node execution, you can use any Loom tool to assist:

- `loom_map_query` — browse the codebase structure
- `loom_expand_symbol` — look up function signatures and locations
- `loom_search` — recall relevant prior work from episodic memory
- `loom_refetch` — re-fetch large externalized content

This gives you the full substrate as context while you execute each node.

## Graph design patterns

Use the same patterns from [multi-step-patterns.md](multi-step-patterns.md):

### Analyze-then-act
```json
[
  { "type": "step", "id": "analyze", "prompt": "Understand the current state" },
  { "type": "step", "id": "act", "prompt": "Make the changes", "dependsOn": ["analyze"] }
]
```

### Parallel fan-out
```json
[
  { "type": "step", "id": "plan", "prompt": "Identify the 3 areas to change" },
  { "type": "parallel", "id": "impl", "dependsOn": ["plan"], "branches": [
    { "type": "step", "id": "area-1", "prompt": "Update area 1" },
    { "type": "step", "id": "area-2", "prompt": "Update area 2" },
    { "type": "step", "id": "area-3", "prompt": "Update area 3" }
  ], "merge": "all" },
  { "type": "step", "id": "review", "prompt": "Review all changes", "dependsOn": ["impl"] }
]
```

### Sequential with verification
```json
[
  { "type": "step", "id": "research", "prompt": "Research the problem" },
  { "type": "step", "id": "implement", "prompt": "Implement the solution", "dependsOn": ["research"] },
  { "type": "step", "id": "test", "prompt": "Run tests and verify", "dependsOn": ["implement"] },
  { "type": "step", "id": "review", "prompt": "Final review", "dependsOn": ["test"] }
]
```

## Error handling

If you report a node as `"failure"`, Loom automatically skips all nodes that depend on it:

```
loom_report_result({ graphId: "...", nodeId: "fix", output: "Cannot fix: file is read-only", status: "failure" })
```

Response: `{ "done": true, "summary": "Graph completed: 1/3 nodes succeeded" }` (verify was skipped)

## vs. loom_weave

| Aspect | `loom_weave` | `loom_submit_graph` |
|---|---|---|
| Who generates the graph? | Planner model | You |
| Who executes nodes? | Worker model | You |
| Requires model/API? | Yes | No |
| Node capabilities | Model + substrate tools | Your full toolset |
| Best for | Delegating to local models | Full control with capable caller |
