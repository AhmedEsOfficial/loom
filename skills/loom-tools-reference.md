# Loom MCP Tools Reference

Complete reference for all tools exposed by the Loom MCP server.

---

## loom_search

Full-text search over episodic memory and the skill store. Uses FTS5 with porter stemming.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Natural language or keyword search query |
| `limit` | number | no | 20 | Maximum number of results |

**Returns:** JSON array of match objects:
```json
[
  {
    "id": "01HXYZ...",
    "rank": -2.45,
    "content": "The matched episode content...",
    "toolName": "substrate_search",
    "toolOutput": "...",
    "highlight": "...the <mark>matched</mark> term..."
  }
]
```

**Tips:**
- Use specific keywords rather than full sentences for better FTS5 matching
- Lower (more negative) rank = better match
- Returns episodes from all prior sessions — useful for recalling past decisions
- Empty results means no episodes have been stored yet; run `loom init` first

---

## loom_expand_symbol

Look up a code symbol from the tree-sitter AST index. Returns full detail: file location, signature, callers, callees, and imports.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `symbolName` | string | yes | — | Exact name of the function, class, type, etc. |
| `filePath` | string | no | — | Narrow search to a specific file |

**Returns:** JSON symbol detail or `"Symbol not found"`:
```json
{
  "name": "createConductor",
  "kind": "function",
  "filePath": "src/conductor/index.ts",
  "startLine": 98,
  "endLine": 112,
  "signature": "export function createConductor(config: LoomConfig): ConductorImpl {",
  "docstring": "Create and configure a Conductor from LoomConfig",
  "callers": ["src/kernel.ts:LoomKernel"],
  "callees": ["src/conductor/anthropic.ts:AnthropicProvider"],
  "imports": ["src/types/common.ts:LoomConfig"]
}
```

**Tips:**
- Symbol names are case-sensitive
- Omit `filePath` to search across the entire codebase
- `kind` is one of: function, class, interface, type, variable, enum, method, struct, trait
- Use this to understand call chains before making changes

---

## loom_related_episodes

Find episodes from prior runs that share the same task fingerprint. Useful for recalling what happened in similar past tasks.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `taskFingerprint` | string | yes | — | The fingerprint to match (16-char hex hash of the normalized task) |
| `limit` | number | no | 10 | Maximum episodes to return |

**Returns:** JSON array of episode objects:
```json
[
  {
    "id": "01HXYZ...",
    "taskFingerprint": "a1b2c3d4e5f67890",
    "role": "assistant",
    "content": "...",
    "graphId": "01HABC...",
    "nodeId": "analyze",
    "tokenCount": 342,
    "createdAt": 1712345678000
  }
]
```

**Tips:**
- Task fingerprints are the first 16 hex chars of a SHA-256 hash of the lowercased, whitespace-normalized task string
- Use `loom_search` for free-text lookup; use this for exact task-history retrieval

---

## loom_map_query

Browse the codebase map at a given file or directory path. Returns the node's summary, public API, complexity score, and its children at the requested depth.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | File or directory path (relative to repo root) |
| `depth` | number | no | 1 | How many levels of children to include |

**Returns:** JSON array of map nodes:
```json
[
  {
    "id": "01HXYZ...",
    "repoId": "_home_user_project",
    "path": "src/auth",
    "level": "module",
    "summary": "Authentication module handling JWT validation and session management...",
    "publicApi": ["validateToken", "createSession", "AuthMiddleware"],
    "complexityScore": 0.35,
    "language": "typescript",
    "loc": 1240,
    "gitSha": "abc123..."
  }
]
```

**Tips:**
- Start with a high-level path (e.g., `src/`) at depth 1 to get an overview, then zoom in
- `level` is one of: file, module, package, repo
- `complexityScore` is 0.0-1.0 based on branching density — higher = more complex
- `publicApi` lists exported symbols — useful for understanding a module's interface without reading code
- Returns `"Path not found in codebase map"` if the repo hasn't been indexed

---

## loom_skill_lookup

Search the skill store for reusable capabilities. Skills are learned patterns that the harness stores after successful task executions.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `description` | string | yes | — | Natural language description of what you need |

**Returns:** JSON array of matching skills:
```json
[
  {
    "id": "01HXYZ...",
    "name": "code-review",
    "description": "Review code for quality, security, and best practices",
    "content": "## Code Review\n1. Check for...",
    "tags": ["review", "quality"]
  }
]
```

---

## loom_weave

Submit a task for full graph-based execution. Loom generates an execution graph using the planner model, validates it, and executes all nodes. This is the primary way to delegate complex multi-step tasks.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `task` | string | yes | — | Task description in natural language |

**Returns:** JSON execution report:
```json
{
  "success": true,
  "graphId": "01HXYZ...",
  "nodeCount": 4,
  "duration": "12.3s",
  "tokenUsage": { "input": 8500, "output": 3200 },
  "nodeResults": [
    {
      "nodeId": "analyze",
      "status": "success",
      "output": "Found 3 files related to authentication..."
    },
    {
      "nodeId": "implement",
      "status": "success",
      "output": "Updated auth middleware to validate..."
    }
  ]
}
```

**Status values:** `success`, `failure`, `skipped`, `timeout`

**Tips:**
- Write clear, specific task descriptions — the planner model generates the graph from your description
- Long-running: this can take 30s+ for complex graphs; it executes the full plan
- If a matching graph template exists from a prior run, Loom suggests it to the planner
- Node outputs are truncated to 500 chars in the response; use `loom_refetch` for full content

---

## loom_graph_status

List cached graph templates and their historical success rates. Templates are extracted from successful graph executions and proposed for future similar tasks.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | number | no | 10 | Maximum templates to return |

**Returns:** JSON array:
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

---

## loom_refetch

Re-fetch the full content of an externalized reference. When Loom externalizes a large result, it replaces it with a `<ref id="...">summary</ref>` placeholder. Use this tool to get the original content back.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `ref` | string | yes | — | The substrate reference ID (from a `<ref>` tag or a `fullTranscriptRef` in a node result) |

**Returns:** The full original content as a string, or `"Content not found"`.

**Tips:**
- Use this when you see a `<ref id="...">` placeholder and need the complete content
- Also works with episode IDs from `fullTranscriptRef` fields in node results
- Searches the externalized content store first, then falls back to the episode store
