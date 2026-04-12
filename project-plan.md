# The Third Path: A Plan for an Emergent AI Harness

## 1. What the references actually do (and where they hit a ceiling)

**Archon (coleam00/Archon)** is a YAML DAG workflow engine. Nodes (`command`, `prompt`, `bash`, `loop`, `approval`) compose into graphs with `depends_on`, `context: fresh`, `model: claude-opus-4-6[1m]`, and `until: PROMISE_TAG` loop gates. Commands live as markdown in `.archon/commands/`, workflows in `.archon/workflows/`. It is excellent at *repeatability* — the same PIV loop runs identically across projects — but the graph is **authored ahead of time by a human**. The model executes; it does not shape the flow. Branching is bounded by the YAML schema.

**Hermes (NousResearch/hermes-agent)** is the opposite: a single agent loop with a `ContextCompressor` (head/tail protection, structured Goal/Progress/Decisions/Files/Next-Steps summaries via an auxiliary cheap model), a `MemoryManager` with pluggable providers + FTS5 cross-session recall, autonomous skill creation, and isolated sub-agents. It learns and persists, but every turn is one undifferentiated ReAct loop — there is no structural guarantee about *how* a task decomposes, no determinism, no replay.

The ceiling: **(a) deterministic workflows can't discover new structure; (b) skill-chaining harnesses can't guarantee anything**. Both are stuck on either side of the structure/emergence trade-off, and both burn context linearly until compaction blows away nuance.

## 2. The thesis

A model is most powerful when it can **author its own execution graph at runtime, against a memory substrate that survives compaction without quality loss, on a codebase it has structurally indexed once and can query forever**. The harness's job is not to script the model and not to free-run it — it is to give the model the *primitives* to build, cache, and replay its own workflows, and to make context a queryable resource rather than a shrinking budget.

Working name: **Loom**. The harness weaves transient graphs over a permanent semantic substrate.

## 3. Architecture — five layers

### Layer 1 — The Substrate (persistent, queryable, never in context)

A local hybrid store combining:

- **SQLite + FTS5** for full-text recall (Hermes already validates this works at scale)
- **Vector index** (sqlite-vec or LanceDB) over chunks, summaries, and skill metadata
- **Tree-sitter AST graph** of every codebase Loom touches — symbols, call edges, imports, ownership, ranked centrality. Built once on registration, incrementally updated on file change via fs-watcher
- **Episodic log** — every prior turn, tool call, and outcome, indexed by task fingerprint

The substrate is **never loaded into context**. The model interacts with it only through tools: `substrate.search`, `substrate.expand_symbol`, `substrate.related_episodes`, `substrate.skill_lookup`. This is the single most important departure from both references — Archon never indexes the codebase structurally, and Hermes loads everything through the context window.

### Layer 2 — The Cartographer (one-time codebase comprehension)

When a repo is registered, a background pass produces a **Codebase Map**: a hierarchical summary tree (file → module → package → repo) where each node carries a 200-token semantic summary, a public-API surface, a complexity score, and pointers to its three "exemplar" callers. This is Cartographer's only job and it's deterministic — produced by a cheap model in parallel chunks, persisted, version-pinned to git SHA, incrementally repaired on commits.

When the model later asks "how does auth work in this repo," it does not grep — it walks the map. A 2M-LOC monorepo becomes browsable in <5k tokens because the map is multi-resolution: zoom out for architecture, zoom in for line ranges. This is the answer to "ingest a full codebase, analyze its patterns."

### Layer 3 — The Weaver (model-authored execution graphs)

Instead of pre-written YAML workflows, the model emits a graph at runtime using a tiny DSL (3 node types: `step`, `parallel`, `loop_until`). The Weaver runtime:

1. **Validates** the graph (cycles, dependency refs, budget caps)
2. **Schedules** each node into its own sub-context with *only* the substrate handles + parent's distilled output — never the parent's full transcript
3. **Caches** each node by `(prompt_hash, input_hash, model)` so reruns are free
4. **Records** the graph + outcomes back into the episodic substrate

Crucially, the Weaver supports **graph mutation mid-run**: a node can emit `<weave>...</weave>` to splice new sub-nodes into the live graph based on what it just learned. This is the synthesis Archon can't do — it gets Archon's determinism (graphs are explicit, replayable, cacheable, inspectable) without Archon's rigidity (graphs are *discovered*, not authored).

A graph is also a **first-class artifact**: after a successful run, the Weaver asks the model "is this graph reusable?" If yes, it's stored as a parameterized template — a learned workflow. The next time a similar task fingerprint arrives, Loom proposes the cached graph as a starting point. Workflows accumulate the way Hermes skills accumulate, but with structural guarantees.

### Layer 4 — The Context Engine (compaction without loss)

The hard problem with both references is that compression destroys nuance. Loom solves this with **stratified context**:

- **Tier 0 — Pinned**: system prompt, current task spec, current graph node — never compressed
- **Tier 1 — Recent active**: last N turns, full fidelity
- **Tier 2 — Externalized**: every tool result over a threshold is written to substrate immediately and replaced inline with a `<ref id="...">one-line summary</ref>` handle. The model can re-fetch on demand. Hermes keeps tool results inline until compaction — Loom never does
- **Tier 3 — Compacted**: structured summary in the Hermes Goal/Progress/Decisions/Files/Next-Steps shape, but augmented with substrate pointers so detail is *recoverable*, not lost
- **Tier 4 — Reset boundary**: at ~70% of model context, Loom forks. The current node closes with a "handoff brief," the next node opens fresh with brief + substrate access. Nothing is "lost" — it's queryable

The compression model is auxiliary and cheap (Haiku-class), runs async during user think time, and is **incremental** — it updates the running summary every K turns rather than doing one big pass at the limit. This is a direct improvement over Hermes's compress-on-threshold approach.

### Layer 5 — The Conductor (model-agnostic execution)

A thin adapter layer over Claude, GPT, Gemini, and any OpenAI-compatible local model (vLLM, llama.cpp). The Conductor handles:

- **Per-node model selection** — cheap model for cartography, mid-tier for routine steps, frontier model for planning/synthesis. The graph DSL lets the model declare `model: planner | worker | critic` and the Conductor maps to whatever's configured
- **Prompt caching** where supported (Anthropic, DeepSeek), with cache keys aligned to the substrate's stable handles
- **Tool-call normalization** so skills written once work everywhere
- **Trajectory capture** for later distillation/RL, the way Hermes feeds Atropos

## 4. How it beats both references on the user's stated goals

| Goal | Archon | Hermes | Loom |
|---|---|---|---|
| Model creates its own flows | No (human YAML) | Implicit only | **Yes — Weaver DSL, mutable mid-run** |
| Massive memory, no quality loss | No memory | FTS + compress | **Substrate + stratified context, detail recoverable** |
| Avoid context bloat | Fresh-context nodes | Compress at limit | **Externalize immediately, fork at 70%** |
| Ingest full codebase | No | Read-on-demand | **Cartographer map, queryable forever** |
| Auto-compact / reset | No | Yes (lossy) | **Yes, with substrate handles preserving detail** |
| Repeatability | Strong | Weak | **Strong — graphs are cached, replayable artifacts** |
| Learning from experience | No | Skills | **Skills + reusable graph templates + episodic recall** |

## 5. Build plan (phased, ~12 weeks for v0.1)

**Phase 1 — Substrate (weeks 1–2).** SQLite + FTS5 + sqlite-vec schema. CRUD tools. Episodic log. Tests against a 10k-file repo.

**Phase 2 — Cartographer (weeks 3–4).** Tree-sitter integration for the top 6 languages. Parallel chunked summarization. Git-SHA pinning, fs-watcher incremental repair. Output: queryable Codebase Map with multi-resolution zoom.

**Phase 3 — Conductor (week 5).** Provider adapters (Anthropic, OpenAI, OpenRouter, local). Prompt caching, tool normalization, trajectory capture.

**Phase 4 — Context Engine (weeks 6–7).** Stratified tiers, externalization-on-write, async incremental compaction, fork-at-threshold with handoff briefs. This is where most of the engineering subtlety lives.

**Phase 5 — Weaver (weeks 8–10).** Graph DSL parser/validator, scheduler, per-node sub-context isolation, `<weave>` mid-run mutation, graph caching by content hash, template extraction, replay.

**Phase 6 — Skill & template store (week 11).** Hermes-style skill markdown ingestion + the new graph-template store. Auto-proposal on matching task fingerprints.

**Phase 7 — Surfaces (week 12).** CLI, MCP server (so it plugs into Claude Code, Cursor, etc.), minimal web inspector for graph visualization and substrate browsing. Telegram/Slack adapters can come later — Hermes already proves the pattern.

## 6. The non-obvious bets

1. **The graph is data, not code.** Archon makes workflows a config artifact; Loom makes them a *runtime output* the model produces and the runtime caches. This is the single inversion that unlocks everything else.
2. **Context is not a budget, it is a working set.** Externalize aggressively; trust the substrate; let the model *fetch* rather than *carry*.
3. **The codebase is comprehended once.** Re-grepping on every session is the hidden tax both references pay. Cartographer pays it once per commit.
4. **Cheap models do the boring work.** Compaction, cartography, and fingerprinting all run on auxiliary models so the frontier model only sees distilled, high-signal context.
5. **Every run is training data.** Trajectories + graphs + outcomes feed back into the substrate, so Loom gets measurably better at *your* codebase the longer it runs — without any fine-tuning.

## 7. Open questions worth flagging before code is written

- Graph DSL surface area: how minimal can we keep it before models start fighting it? (Recommend: 3 node types, no more, until usage data says otherwise.)
- Substrate query language: SQL fragments vs. a curated tool surface. Curated wins for safety, SQL wins for flexibility. Probably curated tools that compile to SQL under the hood.
- Multi-repo / monorepo boundaries in the Cartographer — how does the map represent cross-repo edges?
- How aggressive can fork-at-70% get before users feel a "personality reset"? Handoff brief quality is the entire UX here.

---
