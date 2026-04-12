# Graph Mutation

How to use `<weave>` tags to mutate execution graphs mid-run when new information emerges.

## Why mutate?

The initial graph is a plan based on incomplete information. During execution, a step may discover:
- The task is more complex than expected (need additional steps)
- A different approach is needed (replace a step)
- A loop needs an extra check (append to loop body)

Rather than failing and re-planning, the step can emit a `<weave>` tag to modify the live graph.

## Mutation format

A step emits a `<weave>` tag in its output alongside its regular content:

```
I analyzed the codebase and found the auth module has three sub-components that each need separate handling.

<weave>
{
  "action": "insert_after",
  "targetNodeId": "analyze",
  "nodes": [
    {
      "type": "parallel",
      "id": "handle-subcomponents",
      "branches": [
        { "type": "step", "id": "fix-jwt", "prompt": "Fix the JWT validation in src/auth/jwt.ts" },
        { "type": "step", "id": "fix-session", "prompt": "Fix session handling in src/auth/session.ts" },
        { "type": "step", "id": "fix-rbac", "prompt": "Fix RBAC logic in src/auth/rbac.ts" }
      ],
      "merge": "all"
    }
  ]
}
</weave>
```

The `<weave>` tag is parsed and removed from the step's output. The mutation is validated and applied to the live graph, then scheduling resumes with the new nodes.

## Four mutation actions

### insert_after

Insert new nodes to run after the target node. The new nodes automatically get `dependsOn: [targetNodeId]`.

```json
{
  "action": "insert_after",
  "targetNodeId": "analyze",
  "nodes": [
    { "type": "step", "id": "deep-dive", "prompt": "Investigate the edge case discovered during analysis." }
  ]
}
```

**Use when:** Analysis reveals additional work that wasn't anticipated.

### insert_before

Insert new nodes to run before the target. The target node gets the last new node added to its `dependsOn`.

```json
{
  "action": "insert_before",
  "targetNodeId": "implement",
  "nodes": [
    { "type": "step", "id": "setup-env", "prompt": "Configure the test environment before implementation." }
  ]
}
```

**Use when:** You realize a prerequisite step is missing.

### replace

Swap a target node with one or more new nodes. The new nodes inherit the target's dependencies, and downstream nodes that depended on the target now depend on the last new node.

```json
{
  "action": "replace",
  "targetNodeId": "simple-fix",
  "nodes": [
    { "type": "step", "id": "refactor-module", "prompt": "The fix requires a broader refactor..." },
    { "type": "step", "id": "apply-fix", "prompt": "Apply the actual fix after refactoring.", "dependsOn": ["refactor-module"] }
  ]
}
```

**Use when:** The original step's approach is wrong and needs a fundamentally different strategy.

### append_to_loop

Add new nodes to an existing loop_until body. The target must be a `loop_until` node.

```json
{
  "action": "append_to_loop",
  "targetNodeId": "test-fix-cycle",
  "nodes": [
    { "type": "step", "id": "lint-check", "prompt": "Run the linter after fixing tests." }
  ]
}
```

**Use when:** A loop body needs an additional check or step that wasn't originally included.

## Validation rules

Mutations are validated before application:

1. **No ID collisions.** New node IDs must not match any existing node in the graph.
2. **Target must exist.** The `targetNodeId` must refer to a node currently in the graph.
3. **No cycles.** The mutation must not introduce dependency cycles.
4. **Cannot mutate completed nodes.** Only pending or future nodes can be targeted.
5. **Budget enforced.** The total node count after mutation must not exceed `maxNodes`.

If validation fails, the mutation is silently skipped and the graph continues executing as-is.

## Multiple mutations per step

A single step can emit multiple `<weave>` tags. They are applied in order:

```
<weave>{"action": "insert_after", "targetNodeId": "a", "nodes": [...]}</weave>
<weave>{"action": "append_to_loop", "targetNodeId": "loop", "nodes": [...]}</weave>
```

## When NOT to mutate

- **Don't mutate for minor adjustments.** If a step can handle a small deviation within its own prompt, just handle it — don't add graph complexity.
- **Don't create deeply nested mutations.** A mutation that inserts a node which itself emits another mutation creates hard-to-debug execution flows. Keep mutations to one level.
- **Don't replace already-completed nodes.** The validator rejects this, but it's a sign of a planning problem.
