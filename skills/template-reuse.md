# Template Reuse

Working with cached graph templates for recurring task patterns.

## What are templates?

After a successful graph execution, Loom asks a cheap model: "Is this graph reusable?" If yes, the graph is stored as a **template** — a parameterized execution pattern tied to a task fingerprint.

The next time a similar task arrives, Loom:
1. Computes the task's fingerprint
2. Searches for matching templates
3. If found, suggests the template to the planner as a starting point

This means Loom gets better at recurring tasks over time without any fine-tuning.

## Inspecting templates

### List all cached templates

```
loom_graph_status({ limit: 20 })
```

Returns:
```json
[
  {
    "id": "01HXYZ...",
    "pattern": "a1b2c3d4e5f6",
    "successRate": "83%",
    "avgDuration": "8.4s"
  }
]
```

- `pattern` — The task fingerprint prefix this template matches
- `successRate` — Historical success rate across all executions
- `avgDuration` — Average wall-clock time

### View a template's graph structure

Use `loom_refetch` with the template ID or browse via the MCP resource:

Resource URI: `loom://graph/<template-id>`

## How matching works

Task fingerprints are computed as:
1. Lowercase the task string
2. Normalize whitespace
3. SHA-256 hash
4. Take the first 16 hex characters

Two tasks match if their fingerprint prefixes overlap. This means:
- "Add input validation to the user endpoint" and "add input validation to the user endpoint" match exactly (case/whitespace normalized)
- Similar but not identical tasks may partially match on the first 8 characters

## Template lifecycle

```
Task submitted
    ↓
Fingerprint computed
    ↓
Template search (by fingerprint prefix)
    ↓
Match found?
├── Yes → Suggest template to planner as starting point
│         Planner can adopt, modify, or ignore it
└── No  → Planner generates a fresh graph
    ↓
Execution completes
    ↓
Success?
├── Yes → Ask cheap model "is this reusable?"
│         ├── Yes → Store as template, update stats
│         └── No  → Discard
└── No  → Update failure count if template was used
```

## When templates help

- **Recurring task patterns:** "run tests and fix failures" — the analyze → implement → test → fix loop is the same shape every time
- **Standardized workflows:** code review, migration generation, documentation updates
- **Project-specific patterns:** if your project always needs a lint check after code changes, the template learns this

## When templates don't help

- **Unique one-off tasks:** "investigate why the server crashed at 3am on Tuesday" — too specific to generalize
- **Tasks that change shape:** if the graph structure is different every time, templates add noise
- **Early in a project:** you need several successful runs before useful templates accumulate

## Template statistics

Templates track:
- `successCount` — How many times this template led to a successful execution
- `failureCount` — How many times it failed
- `avgDuration` — Average execution time

Templates with low success rates are still stored but ranked lower in search results. Over time, the best patterns float to the top.
