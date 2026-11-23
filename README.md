# Loom Harness

[![CI](https://github.com/AhmedEsOfficial/loom/actions/workflows/ci.yml/badge.svg)](https://github.com/AhmedEsOfficial/loom/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**An AI harness where the model authors its own execution graph at runtime, over a persistent, queryable memory of your codebase.**

Pre-authored YAML workflows are repeatable but rigid. Free-running agent loops are flexible but unstructured, unreplayable, and burn context linearly. Loom sits between them. The model emits a graph (`step`, `parallel`, `loop_until`) as JSON. Loom validates, schedules, caches and templates it, while the codebase map, episodic memory and large tool outputs live in a SQLite substrate that the model queries on demand instead of holding in its context window.

Loom runs two ways: as a **CLI** that drives a provider model through plan, graph and execution, and as an **MCP server** (for Claude Code, Cursor, etc.) where the calling model authors and runs graphs itself, with no API key needed on Loom's side. The design rationale is in [docs/project-plan.md](docs/project-plan.md).

> Early-stage project (v0.1.0). Expect rough edges; see [Status](#status).

## Status

| Area | State |
|---|---|
| Substrate: SQLite + FTS5 episodic memory, skills, externalized content, `sqlite-vec` vector store | Working, covered by tests |
| Cartographer: tree-sitter parsing (7 languages), symbol index, hierarchical map, `.loomignore`, file watcher | Working |
| Weaver: graph DSL, validator (cycles, budgets, refs), parallel scheduler, `<weave>` mid-run mutation, content-hash cache, template extraction | Working, covered by tests |
| Context engine: tiered context, auto-externalization of large results, compaction, fork-at-threshold handoff | Implemented, unit-tested; not yet evaluated on long real tasks |
| Conductor: Anthropic (prompt caching), OpenAI, OpenRouter, local OpenAI-compatible/Ollama adapters, trajectory capture | Implemented; only the unit-test paths are exercised in CI (no live API calls) |
| MCP server (stdio) with 13 tools, plus Claude Code commands/skills | Working |
| Client-driven execution (`loom_submit_graph` / `loom_report_result`) | Working |
| Semantic (embedding) search | Vector store and embedding config exist; default search is FTS5 and symbol lookup. Embedding population is not wired end to end |
| `loom graph replay <id>` | Currently re-plans the task from the template's pattern rather than replaying the stored graph verbatim |
| MCP over SSE (`serve --port`) | Not implemented (falls back to stdio) |
| Benchmarks vs. a direct model call | A harness script exists (`test/benchmark.ts`); no published results |
| Trajectory-based distillation / training | Trajectories are captured; the distillation pipeline is roadmap |

## Architecture

```
┌──────────────────────────────────────────────────┐
│                 CLI  /  MCP server                │
├──────────────────────────────────────────────────┤
│                      Kernel                       │
├──────────┬───────────┬───────────┬───────────────┤
│  Weaver  │  Context  │ Conductor │ Cartographer  │
│  graph   │  engine   │ provider  │ tree-sitter   │
│  runtime │  (tiers)  │ adapters  │ indexing      │
├──────────┴───────────┴───────────┴───────────────┤
│         Substrate (SQLite + FTS5 + sqlite-vec)    │
└──────────────────────────────────────────────────┘
```

| Layer | Purpose |
|---|---|
| **Substrate** | SQLite + FTS5 + sqlite-vec. Episodic memory, skills, externalized content. Accessed through tools, never loaded wholesale into context. |
| **Cartographer** | Tree-sitter AST parsing for 7 languages. Builds a hierarchical map (file, module, repo) with LLM-generated summaries, updated incrementally by a file watcher. |
| **Weaver** | Model-authored graphs with 3 node types (`step`, `parallel`, `loop_until`), mid-run mutation via `<weave>` tags, caching by content hash, reusable templates. |
| **Context engine** | Five-tier context management, auto-externalization of large tool results, incremental compaction by a cheap model, structured handoff briefs when forking. |
| **Conductor** | Provider adapters and per-node model roles (`planner`, `worker`, `critic`), with full trajectory capture. |

## Quickstart

Requires **Node.js >= 20** and a C/C++ toolchain only if a prebuilt binary is unavailable for `better-sqlite3` / `tree-sitter` on your platform. If your npm config sets `ignore-scripts=true`, install with `npm ci --ignore-scripts=false` so the native modules build.

```bash
git clone https://github.com/AhmedEsOfficial/loom.git
cd loom
npm ci
npm run build

# Index a repository (works without any API key; summaries need a provider)
cd /path/to/your/repo
node /path/to/loom/dist/bin/loom.js init .
node /path/to/loom/dist/bin/loom.js map
node /path/to/loom/dist/bin/loom.js search "logger"
```

`/path/to/loom` is wherever you cloned this repository, and `/path/to/your/repo` is the project you want to index. Everywhere below, `loom` is shorthand for `node /path/to/loom/dist/bin/loom.js` (or `npm run loom -- <args>` from the Loom checkout, which runs the TypeScript sources through `tsx`).

To have Loom plan and execute tasks itself, set one provider key (or run a local Ollama / OpenAI-compatible server, which Loom auto-detects) and run:

```bash
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY / OPENROUTER_API_KEY
loom run "add input validation to the user registration endpoint"
```

## CLI

| Command | What it does |
|---|---|
| `loom init [repo-path]` | Create `.loom/` (SQLite DB and config), parse sources, build and summarize the codebase map |
| `loom run <task>` | Planner model emits a graph; Loom validates it, runs nodes in dependency order (parallel where possible), stores results and may extract a template |
| `loom map [--zoom <path>] [--refresh]` | Show, zoom into, or rebuild the codebase map |
| `loom search <query>` | Search episodes, symbols and skills |
| `loom graph <list\|show\|replay> [id]` | Inspect cached graph templates |
| `loom serve` | Start the MCP server on stdio |

## MCP server and Claude Code integration

```bash
claude mcp add loom -- node /path/to/loom/dist/bin/loom.js serve
```

Or add it to a project's `.mcp.json` / your client's MCP config:

```json
{
  "mcpServers": {
    "loom": {
      "command": "node",
      "args": ["/path/to/loom/dist/bin/loom.js", "serve"]
    }
  }
}
```

If the server starts in a directory that already has `.loom/`, it opens that project automatically; otherwise call `loom_init` / `loom_open`.

### Tools

| Tool | Description |
|---|---|
| `loom_init`, `loom_open`, `loom_status` | Index, open and inspect a project |
| `loom_search` | Full-text search over episodic memory and skills |
| `loom_expand_symbol` | Symbol details from the AST index |
| `loom_related_episodes` | Episodes related to a task fingerprint |
| `loom_map_query` | Browse the codebase map at a path and depth |
| `loom_skill_lookup` | Find skills matching a description |
| `loom_refetch` | Re-fetch externalized content by substrate reference |
| `loom_graph_status` | List cached graph templates and success rates |
| `loom_weave` | Model-driven: Loom's configured provider plans and executes a task |
| `loom_submit_graph`, `loom_report_result` | Client-driven: the calling model submits a graph, executes the nodes, and reports results; Loom validates, schedules and caches |

### What ships in `.claude/` and `skills/`

This repository is also a Claude Code integration. Open it in Claude Code to get:

- `.claude/commands/`: slash commands `/loom-init`, `/loom-explore`, `/loom-recall`, `/loom-review` (the last submits a 4-node review graph through `loom_submit_graph`).
- `.claude/skills/loom-mcp-usage.md`: a skill that teaches the model when and how to use the Loom tools.
- `.claude/settings.json`: pre-approves the `mcp__loom__*` tool permissions so the commands run without prompts. Review it before use; it only grants Loom's own tools.
- `skills/`: reference documents for models using Loom (tool reference, graph authoring, mutation, templates, multi-step patterns). Start at [skills/README.md](skills/README.md).

To use the commands in another project, copy `.claude/commands` and `.claude/skills` into it and register the MCP server there.

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
// Not yet published to npm: install from a local checkout (e.g. `npm link`).
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

## Testing and development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest; uses in-memory SQLite, no network or API keys
npm run build       # tsc -> dist/
npm run dev         # run the CLI from source with watch
```

CI runs install, typecheck, tests and build on Node 20 and 22. `.npmrc` sets `legacy-peer-deps` because the tree-sitter grammar packages declare conflicting optional peer ranges.

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | Provider credentials (any one is enough) |
| `LOCAL_MODEL_URL` | Base URL of a local OpenAI-compatible endpoint (default `http://localhost:8000/v1`); Ollama on `localhost:11434` is auto-detected |
| `LOOM_LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` (default `info`) |

## Project structure

```
bin/loom.ts            CLI entry point
migrations/            SQL schema
src/
  kernel.ts            Composition root
  types/               Shared types (IDs, Result, config, graph DSL)
  substrate/           Database layer
  cartographer/        Codebase indexing
  weaver/              Graph runtime
  context/             Context management
  conductor/           Provider adapters
  cli/                 CLI commands
  mcp/                 MCP server and tools
  util/                Logging, hashing, IDs, tokens
skills/                Reference docs for models using Loom
.claude/               Claude Code commands, skill, permissions
docs/project-plan.md   Design thesis and plan
test/                  Vitest suites and a benchmark script
```

## License

[MIT](LICENSE) (c) 2026 AhmedEsOfficial
