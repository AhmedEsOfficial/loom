# Memory and Search

How to work with Loom's episodic memory, full-text search, and the externalization system.

## Episodic memory

Every interaction Loom has is recorded as an **episode** in the substrate. Episodes include:
- User messages, assistant responses, and tool call results
- Which task they were part of (via `taskFingerprint`)
- Which graph and node produced them (via `graphId`, `nodeId`)
- Token counts and timestamps

Episodes persist across sessions. When you start a new task, all prior episodes from the same and different tasks are searchable.

## Searching memory

### Full-text search

Use `loom_search` to find episodes by keyword:

```
loom_search({ query: "authentication middleware JWT" })
```

This runs FTS5 with porter stemming. Results are ranked by relevance (lower rank = better match).

**Good queries:**
- Specific technical terms: `"connection pooling timeout"`
- Error messages: `"ECONNREFUSED port 5432"`
- Function/class names: `"UserService authenticate"`

**Bad queries:**
- Generic phrases: `"the thing that handles requests"` (too vague for FTS5)
- Very long sentences (each word is searched as a literal; more words = stricter matching)

### Task-based recall

Use `loom_related_episodes` when you know the task fingerprint:

```
loom_related_episodes({ taskFingerprint: "a1b2c3d4e5f67890" })
```

This returns all episodes from prior executions of the same (or similar) task, ordered by recency. Useful for understanding what worked or failed in previous attempts.

### Skill discovery

Use `loom_skill_lookup` to find reusable skill patterns:

```
loom_skill_lookup({ description: "database migration" })
```

Skills are named, tagged capabilities that Loom has stored. They describe patterns, not specific code.

## Externalized content

When a tool result exceeds the externalization threshold (default: 2048 bytes), Loom:
1. Stores the full content in the substrate
2. Replaces it inline with a placeholder: `<ref id="abc123">JSON array with 47 items, 1200 tokens</ref>`
3. The summary inside the `<ref>` tag gives you a quick sense of what was externalized

### Re-fetching externalized content

If you need the full content behind a `<ref>`:

```
loom_refetch({ ref: "abc123" })
```

This returns the complete original content.

### When to refetch

- **Do refetch** when you need to act on specific data (exact values, full error messages, detailed JSON structures)
- **Don't refetch** when the summary tells you enough (e.g., `"JSON array with 0 items"` — you already know it's empty)
- **Don't refetch everything** — the whole point of externalization is to avoid loading unnecessary detail into context

## Practical patterns

### Pattern 1: Recall before planning

Before starting a complex task, search memory for prior relevant work:

```
loom_search({ query: "refactor database connection" })
```

If results exist, review them to avoid repeating past mistakes or rediscovering known decisions.

### Pattern 2: Check prior failures

When a task fails, check if the same task was attempted before:

```
loom_related_episodes({ taskFingerprint: "a1b2..." })
```

Look for episodes with `role: "tool"` and error outputs to understand what went wrong last time.

### Pattern 3: Selective refetch

When reviewing node results from `loom_weave`, node outputs are truncated to 500 characters. If you need the full output:

```
loom_refetch({ ref: "<the fullTranscriptRef from the node result>" })
```
