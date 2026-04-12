# Loom MCP Tools Reference

Complete reference for all tools exposed by the Loom MCP server.

## Overview

Loom exposes 13 MCP tools organized into 4 categories:

| Category | Tools | Requires model? |
|---|---|---|
| **Project management** | `loom_init`, `loom_open`, `loom_status` | No |
| **Codebase & memory** | `loom_map_query`, `loom_expand_symbol`, `loom_search`, `loom_skill_lookup`, `loom_related_episodes`, `loom_refetch` | No |
| **Model-driven execution** | `loom_weave`, `loom_graph_status` | Yes (local or API) |
| **Client-driven execution** | `loom_submit_graph`, `loom_report_result` | No |

---

## Project Management

### loom_init

Initialize Loom in a project directory. Creates `.loom/`, runs database migrations, builds the codebase map (tree-sitter AST index), and switches the active project.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Absolute path to the project directory |

**Returns:**
```json
{
  "success": true,
  "projectPath": "/home/user/my-project",
  "nodeCount": 84,
  "languages": { "typescript": 64 },
  "fileCount": 64,
  "message": "Loom initialized. Indexed 64 files, 84 map nodes."
}
```

**Tips:**
- Run this once per project — subsequent sessions use `loom_open`
- Respects `.loomignore` and `.gitignore` for file exclusion
- Auto-detects local model servers (Ollama, LM Studio, llama-server)
- After init, all other Loom tools operate on this project

---

### loom_open

Switch to an already-initialized project (must have a `.loom/` directory).

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Absolute path to the project directory |

**Returns:**
```json
{
  "success": true,
  "projectPath": "/home/user/my-project",
  "message": "Switched to project at /home/user/my-project."
}
```

---

### loom_status

Show the currently active Loom project and its configuration.

**Parameters:** None

**Returns:**
```json
{
  "active": true,
  "projectPath": "/home/user/my-project",
  "providers": ["local"],
  "modelRoles": {
    "planner": "qwen2.5-coder:7b",
    "worker": "qwen2.5-coder:7b",
    "critic": "qwen2.5-coder:7b",
    "compactor": "gemma3:4b",
    "cartographer": "gemma3:4b"
  }
}
```

If no project is active: `{ "active": false, "message": "No project is active. Call loom_init or loom_open first." }`

---

## Codebase & Memory

### loom_search

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
    "highlight": "...the <mark>matched</mark> term..."
  }
]
```

**Tips:**
- Use specific keywords rather than full sentences for better FTS5 matching
- Lower (more negative) rank = better match
- Returns episodes from all prior sessions — useful for recalling past decisions

---

### loom_expand_symbol

Look up a code symbol from the tree-sitter AST index. Returns file location, signature, callers, callees, and imports.

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
  "signature": "export function createConductor(config: LoomConfig): ConductorImpl {"
}
```

**Tips:**
- Symbol names are case-sensitive
- `kind` is one of: function, class, interface, type, variable, enum, method, struct, trait
- Use this to understand call chains before making changes

---

### loom_related_episodes

Find episodes from prior runs that share the same task fingerprint.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `taskFingerprint` | string | yes | — | 16-char hex fingerprint |
| `limit` | number | no | 10 | Maximum episodes to return |

**Returns:** JSON array of episode objects with role, content, graphId, nodeId, tokenCount, createdAt.

---

### loom_map_query

Browse the codebase map at a given file or directory path.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | File or directory path (relative to repo root) |
| `depth` | number | no | 1 | How many levels of children to include |

**Returns:** JSON array of map nodes with summary, publicApi, complexityScore, language, loc.

**Tips:**
- Start with `src/` at depth 1 for an overview, then zoom in
- `level` is one of: file, module, package, repo
- `complexityScore` 0.0-1.0 based on branching density
- `publicApi` lists exported symbols

---

### loom_skill_lookup

Search the skill store for reusable capabilities.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `description` | string | yes | Natural language description of what you need |

**Returns:** JSON array of matching skills with name, description, content, tags.

---

### loom_refetch

Re-fetch the full content of an externalized reference or episode.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `ref` | string | yes | Substrate reference ID or episode ID |

**Returns:** The full original content as a string, or `"Content not found"`.

---

## Model-Driven Execution

### loom_weave

Submit a task for full graph-based execution. Requires a configured model provider (Ollama, OpenAI, Anthropic, etc.). The planner model generates an execution graph and Loom executes all nodes internally.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `task` | string | yes | Task description in natural language |

**Returns:** JSON execution report with success, graphId, nodeCount, duration, tokenUsage, and nodeResults.

**Tips:**
- Requires a local model or API key
- Can take 30s+ for complex graphs
- For model-free execution, use `loom_submit_graph` + `loom_report_result` instead

---

### loom_graph_status

List cached graph templates and their historical success rates.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | number | no | 10 | Maximum templates to return |

**Returns:** JSON array with id, pattern, successRate, avgDuration.

---

## Client-Driven Execution

These tools let you execute graphs without any model or API key. **You** author the graph, do the work, and report results. Loom handles validation, scheduling, and memory.

### loom_submit_graph

Submit a graph you authored for validation and scheduling. Returns the first nodes ready to execute.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `task` | string | yes | Task description |
| `nodes` | array | yes | Array of graph nodes (see below) |

**Node types:**
```json
// Step node
{ "type": "step", "id": "analyze", "prompt": "Analyze the auth module", "dependsOn": [] }

// Parallel node
{ "type": "parallel", "id": "impl", "branches": [...nodes], "merge": "all", "dependsOn": ["analyze"] }

// Loop node
{ "type": "loop_until", "id": "fix", "body": [...nodes], "until": "All tests pass", "maxIterations": 5 }
```

**Returns:**
```json
{
  "graphId": "01HXYZ...",
  "nodeCount": 3,
  "executionOrder": ["analyze", "implement", "verify"],
  "readyNodes": [
    {
      "id": "analyze",
      "type": "step",
      "prompt": "Analyze the auth module",
      "tools": [],
      "dependencyOutputs": {}
    }
  ]
}
```

**Tips:**
- Loom validates the graph (cycle detection, budget check, reference integrity)
- Only nodes with all dependencies satisfied appear in `readyNodes`
- Execute the ready nodes yourself, then call `loom_report_result` with your output

---

### loom_report_result

Report the result of executing a node. Loom stores the episode and returns the next ready nodes.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `graphId` | string | yes | Graph ID from `loom_submit_graph` |
| `nodeId` | string | yes | ID of the node you executed |
| `output` | string | yes | Your output/result from executing this node |
| `status` | string | yes | `"success"` or `"failure"` |

**Returns:**
```json
{
  "done": false,
  "graphId": "01HXYZ...",
  "completedNodeId": "analyze",
  "readyNodes": [
    {
      "id": "implement",
      "prompt": "Fix the bugs found during analysis",
      "dependencyOutputs": { "analyze": "Found 3 bugs in..." }
    }
  ]
}
```

When all nodes are complete: `{ "done": true, "summary": "Graph completed: 3/3 nodes succeeded in 2.1s" }`

**Tips:**
- If a node fails, its dependents are automatically skipped
- `dependencyOutputs` carries prior nodes' output into the next step
- Call this repeatedly until `done: true`
