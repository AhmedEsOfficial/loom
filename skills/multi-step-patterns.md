# Multi-Step Graph Patterns

Common graph patterns for solving different categories of tasks.

---

## Pattern 1: Analyze-then-act

The most basic pattern. Gather information first, then act on it.

```json
{
  "nodes": [
    {
      "type": "step",
      "id": "analyze",
      "prompt": "Search the codebase for all files related to user authentication. List their paths, key functions, and how they interact.",
      "model": "planner",
      "tools": ["substrate_search", "substrate_expand_symbol", "map_query"]
    },
    {
      "type": "step",
      "id": "implement",
      "prompt": "Based on the analysis, implement the required changes.",
      "model": "worker",
      "dependsOn": ["analyze"]
    }
  ]
}
```

**When to use:** Any task where you need to understand the current state before making changes.

---

## Pattern 2: Parallel fan-out

Split independent work across concurrent branches, then merge.

```json
{
  "nodes": [
    {
      "type": "step",
      "id": "plan",
      "prompt": "Identify the three components that need updating.",
      "model": "planner"
    },
    {
      "type": "parallel",
      "id": "implement",
      "dependsOn": ["plan"],
      "branches": [
        { "type": "step", "id": "update-api", "prompt": "Update the API endpoints." },
        { "type": "step", "id": "update-db", "prompt": "Update the database schema." },
        { "type": "step", "id": "update-tests", "prompt": "Update the test suite." }
      ],
      "merge": "all"
    },
    {
      "type": "step",
      "id": "integrate",
      "prompt": "Review all changes for consistency and resolve any conflicts.",
      "model": "critic",
      "dependsOn": ["implement"]
    }
  ]
}
```

**When to use:** Tasks with clearly separable sub-tasks that don't depend on each other.

---

## Pattern 3: Test-fix loop

Iterate until a condition is met — typically "tests pass."

```json
{
  "nodes": [
    {
      "type": "step",
      "id": "implement",
      "prompt": "Implement the feature.",
      "model": "worker"
    },
    {
      "type": "loop_until",
      "id": "validate",
      "dependsOn": ["implement"],
      "body": [
        { "type": "step", "id": "run-tests", "prompt": "Run the test suite. Report all pass/fail results." },
        { "type": "step", "id": "fix", "prompt": "Fix any failures from the test run.", "dependsOn": ["run-tests"] }
      ],
      "until": "All tests pass with zero failures",
      "maxIterations": 5
    }
  ]
}
```

**When to use:** Any iterative refinement cycle — testing, linting, type-checking, benchmarking.

---

## Pattern 4: Research-plan-execute-review

A full lifecycle for complex tasks.

```json
{
  "nodes": [
    {
      "type": "step",
      "id": "research",
      "prompt": "Search memory for prior work on this area. Search the codebase map for relevant modules. Summarize findings.",
      "model": "planner",
      "tools": ["substrate_search", "substrate_related_episodes", "map_query"]
    },
    {
      "type": "step",
      "id": "plan",
      "prompt": "Based on the research, create a detailed implementation plan with specific files and changes.",
      "model": "planner",
      "dependsOn": ["research"]
    },
    {
      "type": "step",
      "id": "execute",
      "prompt": "Execute the plan. Make all specified changes.",
      "model": "worker",
      "dependsOn": ["plan"]
    },
    {
      "type": "step",
      "id": "review",
      "prompt": "Review all changes for correctness, security issues, and edge cases. Report any problems.",
      "model": "critic",
      "dependsOn": ["execute"]
    }
  ]
}
```

**When to use:** High-stakes changes where you want independent review.

---

## Pattern 5: Parallel investigation with consensus

Run multiple analyses independently, then synthesize.

```json
{
  "nodes": [
    {
      "type": "parallel",
      "id": "investigate",
      "branches": [
        {
          "type": "step",
          "id": "approach-a",
          "prompt": "Investigate the performance issue from the database query perspective.",
          "tools": ["substrate_expand_symbol", "map_query"]
        },
        {
          "type": "step",
          "id": "approach-b",
          "prompt": "Investigate the performance issue from the caching layer perspective.",
          "tools": ["substrate_expand_symbol", "map_query"]
        }
      ],
      "merge": "all"
    },
    {
      "type": "step",
      "id": "synthesize",
      "prompt": "Compare both investigation approaches. Determine the root cause and recommend the best fix.",
      "model": "planner",
      "dependsOn": ["investigate"]
    }
  ]
}
```

**When to use:** Debugging or investigation where the root cause is uncertain.

---

## Pattern 6: Incremental migration

Process items in a loop with a completion check.

```json
{
  "nodes": [
    {
      "type": "step",
      "id": "inventory",
      "prompt": "List all files that need migration. Output as a numbered list.",
      "model": "worker",
      "tools": ["map_query", "substrate_search"]
    },
    {
      "type": "loop_until",
      "id": "migrate",
      "dependsOn": ["inventory"],
      "body": [
        { "type": "step", "id": "migrate-next", "prompt": "Migrate the next un-migrated file from the inventory list." },
        { "type": "step", "id": "check-progress", "prompt": "Check how many files remain un-migrated.", "dependsOn": ["migrate-next"] }
      ],
      "until": "All files have been migrated",
      "maxIterations": 10
    }
  ]
}
```

**When to use:** Batch operations where you process items one at a time.

---

## Choosing a pattern

| Situation | Pattern |
|---|---|
| Need to understand before acting | Analyze-then-act |
| Work is clearly separable | Parallel fan-out |
| Iterative refinement needed | Test-fix loop |
| High-stakes, complex change | Research-plan-execute-review |
| Uncertain root cause | Parallel investigation |
| Batch processing | Incremental migration |
| Combination of the above | Compose patterns — e.g., analyze → parallel fan-out → test-fix loop |

Patterns compose naturally: a `parallel` node's branches can contain `loop_until` nodes, a `loop_until` body can contain `parallel` nodes, etc.
