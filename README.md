# Loom Harness

An emergent AI harness where models author their own execution graphs at runtime over a persistent semantic substrate.

Loom sits between the rigidity of pre-authored YAML workflows and the chaos of free-running agent loops. It gives models the primitives to **build, cache, and replay** their own workflows while treating context as a queryable resource rather than a shrinking budget.

## Key ideas

- **The graph is data, not code.** Models emit execution graphs at runtime. The harness validates, schedules, and caches them.
- **Context is a working set, not a budget.** Large results are externalized to a substrate immediately and re-fetched on demand.
- **The codebase is comprehended once.** Tree-sitter produces a hierarchical map pinned to a git SHA. No re-grepping on every session.
- **Every run is training data.** Full trajectories are captured for replay, distillation, and improvement over time.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   CLI / MCP Server               │
├─────────────────────────────────────────────────┤
│                     Kernel                       │
├──────────┬──────────┬──────────┬��───────────────┤
│  Weaver  │ Context  │Conductor │  Cartographer  │
│  (graph  │ Engine   │(provider │  (codebase     │
│  runtime)│ (tiers)  │ adapters)│   indexing)    │
├──────────┴──────────┴──────────┴────────────────┤
│             Substrate (SQLite + FTS5 + vec)       │
└─────────────────────────────────────────────────┘
```

**Five layers:**

| Layer | Purpose |
|---|---|
| **Substrate** | SQLite + FTS5 full-text search + sqlite-vec vector similarity. Episodic memory, skills, externalized content. Never loaded into context — accessed only through tools. |
| **Cartographer** | Tree-sitter AST parsing for 7 languages. Builds a hierarchical codebase map (file → module → package → repo) with LLM-generated summaries. Incrementally updated via file watcher. |
| **Weaver** | Model-authored execution graphs with 3 node types (`step`, `parallel`, `loop_until`). Supports mid-run graph mutation via `<weave>` tags. Graphs are cached by content hash and extracted as reusable templates. |
| **Context Engine** | Stratified 5-tier context management. Auto-externalizes large tool results. Incremental compaction via cheap model. Fork-at-70% with structured handoff briefs. |
| **Conductor** | Provider adapters for Anthropic (with prompt caching), OpenAI, OpenRouter, and local OpenAI-compatible endpoints. Per-node model role selection. Full trajectory capture. |

## Requirements

- **Node.js** >= 20.0.0
- **npm** >= 9
- At least one LLM provider API key (Anthropic, OpenAI, or OpenRouter)

## Installation

```bash
git clone https://github.com/your-org/loom-harness.git
cd loom-harness
npm install
```

### Build

```bash
npm run build
```

### Run in development (no build needed)

```bash
npm run loom -- <command>
# or
npx tsx bin/loom.ts <command>
```

## Quick start

### 1. Set your API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export OPENROUTER_API_KEY=sk-or-...
```

Loom auto-detects available providers from environment variables and configures sensible model defaults.

### 2. Initialize a repository

```bash
npm run loom -- init /path/to/your/repo
```

This will:
- Create a `.loom/` directory with the SQLite database and config
- Parse all source files with tree-sitter and build the codebase map
- Generate LLM summaries for each module

### 3. Run a task

```bash
npm run loom -- run "add input validation to the user registration endpoint"
```

Loom will:
1. Ask the planner model to generate an execution graph
2. Validate the graph (cycles, budget, references)
3. Execute nodes in topological order, running independent nodes in parallel
4. Store results and trajectories in the substrate
5. Optionally extract the graph as a reusable template

### 4. Explore the codebase map

```bash
# Show top-level summary
npm run loom -- map

# Zoom into a specific path
npm run loom -- map --zoom src/auth

# Rebuild after major changes
npm run loom -- map --refresh
```

### 5. Search the substrate

```bash
npm run loom -- search "authentication middleware"
```

Searches across episodic memory, the symbol index, and the skill store.

### 6. Manage graph templates

```bash
# List cached templates
npm run loom -- graph list

# Show a template's structure
npm run loom -- graph show <template-id>

# Replay a template
npm run loom -- graph replay <template-id>
```

## MCP Server

Loom exposes itself as an MCP (Model Context Protocol) tool server, so it can be used from Claude Code, Cursor, or any MCP-compatible client.

```bash
npm run loom -- serve
```

This starts the server on stdio. Connect it as an MCP server in your editor.

### Available MCP tools

| Tool | Description |
|---|---|
| `loom_search` | Full-text search over episodic memory and skills |
| `loom_expand_symbol` | Get symbol details from the AST index |
| `loom_related_episodes` | Find episodes related to a task fingerprint |
| `loom_map_query` | Browse the codebase map at a given path and depth |
| `loom_skill_lookup` | Find skills matching a description |
| `loom_weave` | Submit a task for full graph-based execution |
| `loom_graph_status` | List cached graph templates and success rates |
| `loom_refetch` | Re-fetch externalized content by substrate reference |

## Configuration

Configuration lives at `.loom/config.json`. It is auto-generated on `loom init` but can be edited manually.

```jsonc
{
  "providers": [
    {
      "name": "anthropic",                          // "anthropic" | "openai" | "openrouter" | "local"
      "apiKey": "sk-ant-...",                       // Optional — falls back to env var
      "models": {
        "claude-sonnet-4-20250514": "claude-sonnet-4-20250514"
      }
    }
  ],
  "modelRoles": {
    "planner": "claude-sonnet-4-20250514",          // Graph generation, synthesis
    "worker": "claude-sonnet-4-20250514",           // Step execution
    "critic": "claude-sonnet-4-20250514",           // Verification, review
    "compactor": "claude-haiku-4-20250514",         // Context compaction (cheap)
    "cartographer": "claude-haiku-4-20250514"       // Codebase summarization (cheap)
  },
  "context": {
    "recentTurns": 10,                              // Tier 1 window size
    "externalizeThreshold": 2048,                   // Bytes — tool results above this are externalized
    "forkThreshold": 0.7,                           // Fork context at 70% of max
    "compactionInterval": 5,                        // Compact every N turns
    "maxContextTokens": 100000                      // Total context budget
  },
  "weaver": {
    "maxNodes": 50,                                 // Max nodes per graph
    "maxLoopIterations": 10,                        // Max iterations for loop_until
    "nodeTimeout": 300000                           // Per-node timeout (ms)
  },
  "cartographer": {
    "languages": ["typescript", "javascript", "python", "go", "rust", "java", "c"],
    "ignorePatterns": ["node_modules", ".git", "dist", "build", "__pycache__", "target"],
    "summaryBatchSize": 15                          // Files per LLM summarization batch
  },
  "embedding": {
    "dimensions": 1536,                             // Must match your embedding model
    "model": "text-embedding-3-small",
    "provider": "openai"
  }
}
```

## Graph DSL

Models emit execution graphs inside `<graph>` tags as JSON. Three node types:

### Step

A single model call.

```json
{
  "type": "step",
  "id": "analyze",
  "prompt": "Search the codebase for auth-related files.",
  "model": "planner",
  "tools": ["substrate_search", "substrate_expand_symbol"],
  "dependsOn": [],
  "maxTokens": 4096,
  "timeout": 60000
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `type` | `"step"` | — | Required literal |
| `id` | string | — | Unique node identifier |
| `prompt` | string | — | The instruction for this step |
| `model` | `"planner"` \| `"worker"` \| `"critic"` | `"worker"` | Model role |
| `tools` | string[] | — | Tool names this node can use |
| `dependsOn` | string[] | `[]` | Node IDs that must complete first |
| `maxTokens` | number | — | Max output tokens |
| `timeout` | number | — | Timeout in ms |

### Parallel

Concurrent branches with a merge strategy.

```json
{
  "type": "parallel",
  "id": "implement",
  "branches": [
    { "type": "step", "id": "frontend", "prompt": "Build the UI" },
    { "type": "step", "id": "backend", "prompt": "Build the API" }
  ],
  "merge": "all",
  "dependsOn": ["analyze"]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `type` | `"parallel"` | — | Required literal |
| `id` | string | — | Unique node identifier |
| `branches` | GraphNode[] | — | Nodes to execute concurrently |
| `merge` | `"all"` \| `"first"` \| `"majority"` | `"all"` | How to combine branch outputs |
| `dependsOn` | string[] | `[]` | Node IDs that must complete first |

### Loop Until

Repeats a body until a natural-language condition is met.

```json
{
  "type": "loop_until",
  "id": "test-fix-loop",
  "body": [
    { "type": "step", "id": "run-tests", "prompt": "Run the test suite." },
    { "type": "step", "id": "fix", "prompt": "Fix any failing tests.", "dependsOn": ["run-tests"] }
  ],
  "until": "All tests pass with no failures",
  "maxIterations": 5,
  "dependsOn": ["implement"]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `type` | `"loop_until"` | — | Required literal |
| `id` | string | — | Unique node identifier |
| `body` | GraphNode[] | — | Nodes to execute each iteration |
| `until` | string | — | Natural-language termination condition |
| `maxIterations` | number | `10` | Safety cap on iterations |
| `dependsOn` | string[] | `[]` | Node IDs that must complete first |

### Mid-run mutation

During execution, any step can emit `<weave>` tags to mutate the live graph:

```xml
<weave>
{
  "action": "insert_after",
  "targetNodeId": "analyze",
  "nodes": [
    { "type": "step", "id": "deep-dive", "prompt": "The analysis revealed a complex issue. Investigate further." }
  ]
}
</weave>
```

**Mutation actions:** `insert_after`, `insert_before`, `replace`, `append_to_loop`

## Programmatic API

```typescript
import { LoomKernel } from "loom-harness";

const kernel = new LoomKernel({
  repoPath: "/path/to/repo",
  dataDir: "/path/to/repo/.loom",
  providers: [{ name: "anthropic", models: { "claude-sonnet-4-20250514": "claude-sonnet-4-20250514" } }],
  modelRoles: {
    planner: "claude-sonnet-4-20250514",
    worker: "claude-sonnet-4-20250514",
    critic: "claude-sonnet-4-20250514",
    compactor: "claude-haiku-4-20250514",
    cartographer: "claude-haiku-4-20250514",
  },
});

// Build codebase map
await kernel.cartographer.buildMap("/path/to/repo");

// Run a task
const result = await kernel.run("refactor the database module to use connection pooling");
console.log(result.success, result.nodeResults);

// Search the substrate
const episodes = await kernel.substrate.search("connection pooling");

// Clean up
kernel.shutdown();
```

## Database

Loom stores everything in a single SQLite file at `.loom/loom.db` with these tables:

| Table | Purpose |
|---|---|
| `episodes` | Full episodic log of every turn, tool call, and outcome |
| `episodes_fts` | FTS5 virtual table for full-text search over episodes |
| `vectors` | sqlite-vec table for embedding similarity search |
| `vector_metadata` | Metadata for each vector entry |
| `map_nodes` | Hierarchical codebase map nodes |
| `symbols` | Tree-sitter extracted symbols (functions, classes, types, etc.) |
| `symbol_edges` | Call graph edges (calls, imports, extends, implements) |
| `skills` | Reusable skill definitions |
| `skills_fts` | FTS5 search over skills |
| `graph_templates` | Cached execution graphs with success/failure statistics |
| `graph_executions` | Execution log with token usage |
| `externalized` | Content externalized from context (tier 2+) |

## Supported languages

The Cartographer indexes these languages via tree-sitter:

| Language | Extensions | Extracted symbols |
|---|---|---|
| TypeScript | `.ts`, `.tsx` | functions, classes, interfaces, types, enums, variables |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | functions, classes, variables |
| Python | `.py` | functions, classes, decorators |
| Go | `.go` | functions, methods, types, structs, interfaces |
| Rust | `.rs` | fn, struct, enum, trait, impl methods |
| Java | `.java` | classes, interfaces, enums, methods |
| C/C++ | `.c`, `.h`, `.cpp`, `.cc`, `.hpp` | functions, structs, enums |

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests use vitest with in-memory SQLite databases, so no external services are needed.

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `LOCAL_MODEL_URL` | Base URL for local OpenAI-compatible endpoint (default: `http://localhost:8000/v1`) |
| `LOOM_LOG_LEVEL` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` (default: `info`) |

## Project structure

```
loom-harness/
├── bin/loom.ts                     CLI entry point
├── migrations/001_initial.sql      Database schema
├── src/
│   ├── index.ts                    Public API exports
│   ├── kernel.ts                   Composition root
│   ├── types/                      TypeScript type definitions
│   │   ├── common.ts              Branded IDs, Result<T,E>, LoomConfig
│   │   ├── substrate.ts           Episodes, vectors, skills, tools
│   │   ├── cartographer.ts        Map nodes, parsed files, symbols
│   │   ├── weaver.ts              Graph DSL, mutations, execution
│   │   ├── context.ts             Tiers, handoff briefs, compaction
│   │   └── conductor.ts           Messages, providers, trajectories
│   ├── substrate/                  Database layer
│   ├── cartographer/               Codebase indexing
│   ├── weaver/                     Graph runtime
│   ├── context/                    Context management
│   ├── conductor/                  Provider adapters
│   ├── cli/                        CLI commands
│   ├── mcp/                        MCP server
│   └── util/                       Logging, hashing, IDs, tokens
└── test/                           Vitest test suites
```

## License

MIT
