# Task Execution

End-to-end workflow for submitting tasks via `loom_weave` (model-driven) and interpreting results.

> **No model available?** Use [client-driven execution](client-driven-execution.md) with `loom_submit_graph` + `loom_report_result` instead — no local model or API key required.

## How task execution works

When you call `loom_weave({ task: "..." })`, this is the internal flow:

```
1. Template lookup    → Check if a matching graph template exists
2. Graph generation   → Planner model emits a <graph> with nodes
3. Validation         → Cycle check, budget check, reference integrity
4. Scheduling         → Topological sort, parallel dispatch
5. Node execution     → Each node runs with isolated context + substrate tools
6. Mutation handling  → <weave> tags from nodes modify the live graph
7. Template extract   → Successful graphs may be cached as templates
8. Results returned   → Aggregated node results + token usage
```

## Submitting a task

```
loom_weave({ task: "Add input validation to the /api/users POST endpoint" })
```

### Writing effective task descriptions

**Good tasks** — specific, scoped, actionable:
- "Add rate limiting middleware to the Express API routes in src/api/"
- "Fix the race condition in the WebSocket handler that causes duplicate messages"
- "Refactor the database module to use connection pooling instead of per-request connections"

**Bad tasks** — vague, too broad:
- "Improve the codebase" (no clear goal)
- "Fix all bugs" (unbounded scope)
- "Make it faster" (no specific target)

## Interpreting results

The response from `loom_weave`:

```json
{
  "success": true,
  "graphId": "01HXYZ...",
  "nodeCount": 4,
  "duration": "12.3s",
  "tokenUsage": { "input": 8500, "output": 3200 },
  "nodeResults": [
    { "nodeId": "analyze", "status": "success", "output": "Found 3 relevant files..." },
    { "nodeId": "implement", "status": "success", "output": "Updated the handler..." },
    { "nodeId": "test", "status": "failure", "output": "2 tests failed: ..." },
    { "nodeId": "review", "status": "skipped", "output": "Skipped: dependency \"test\" failed" }
  ]
}
```

### Status meanings

| Status | Meaning | Action |
|---|---|---|
| `success` | Node completed normally | Read the output for results |
| `failure` | Node hit an error | Check the output/error for details |
| `skipped` | A dependency failed | Fix the upstream failure |
| `timeout` | Node exceeded its time limit | Task may be too complex for a single step |

### Reading node outputs

Node outputs in the response are truncated to 500 characters. If you need the full output:

```
loom_refetch({ ref: "<fullTranscriptRef from the node result>" })
```

## Handling failures

### Graph generation failure

If the planner can't produce a valid graph:
```json
{ "success": false, "error": "No <graph> tag found in model output" }
```
This usually means the task description was too vague. Rewrite with more specifics.

### Validation failure

```json
{ "success": false, "error": "Cycle detected involving node \"fix\"" }
```
The planner generated an invalid graph. The task will need to be re-submitted — the planner usually self-corrects on retry.

### Partial success

When some nodes succeed and some fail, `success` is `false` but `nodeResults` still contains the successful outputs. You can review what worked and submit a follow-up task to complete the remainder.

## Chaining tasks

For complex work, break it into sequential `loom_weave` calls:

1. `loom_weave({ task: "Analyze the auth module and identify all security issues" })`
2. Review the results
3. `loom_weave({ task: "Fix the JWT validation vulnerability identified in src/auth/jwt.ts" })`

This gives you a checkpoint between phases and lets you adjust the approach based on what the first task discovered.

## Token usage

The `tokenUsage` field shows total tokens across all nodes:
- `input` — prompt tokens sent to models
- `output` — completion tokens generated

Use this to monitor cost. Complex graphs with many nodes and tool calls can consume significant tokens.

## Alternative: Client-driven execution

If no model or API key is available, you can author and execute graphs yourself using `loom_submit_graph` and `loom_report_result`. See [client-driven-execution.md](client-driven-execution.md) for the full workflow.
