# Loom Skills

This directory contains skill reference documents for AI models interacting with Loom as an MCP tool server. Each file describes a workflow pattern, tool reference, or domain-specific guide.

## Skill index

| Skill | Purpose |
|---|---|
| [loom-tools-reference.md](loom-tools-reference.md) | Complete reference for all 13 MCP tools — parameters, return formats, error cases |
| [codebase-navigation.md](codebase-navigation.md) | How to explore and understand a codebase using the map and symbol tools |
| [memory-and-search.md](memory-and-search.md) | Working with episodic memory, full-text search, and externalized references |
| [graph-authoring.md](graph-authoring.md) | How to design and emit execution graphs with the 3 node types |
| [graph-mutation.md](graph-mutation.md) | Mid-run graph mutation patterns using `<weave>` tags |
| [task-execution.md](task-execution.md) | End-to-end workflow for `loom_weave` (model-driven) and `loom_submit_graph` (client-driven) |
| [client-driven-execution.md](client-driven-execution.md) | Client-driven graph execution — no model or API key required |
| [template-reuse.md](template-reuse.md) | Working with cached graph templates — discovery, inspection, replay |
| [multi-step-patterns.md](multi-step-patterns.md) | Common graph patterns: analyze-then-act, parallel fan-out, test-fix loops |
| [substrate-tools-reference.md](substrate-tools-reference.md) | Reference for the 6 tools available to nodes inside graph execution |

## Two ways to execute graphs

Loom supports two execution modes:

### 1. Model-driven (`loom_weave`)
A local model or API-backed model generates and executes the graph internally. Requires a configured provider (Ollama, OpenAI, Anthropic, etc.).

### 2. Client-driven (`loom_submit_graph` + `loom_report_result`)
**You** (the calling model) author and execute the graph. Loom handles validation, scheduling, memory, and template caching. No local model or API key required — the MCP caller is the intelligence layer.

## Project management

| Tool | Purpose |
|---|---|
| `loom_init` | Initialize Loom in any project directory — creates `.loom/`, indexes the codebase |
| `loom_open` | Switch to an already-initialized project |
| `loom_status` | Show the currently active project |

## How to use these skills

These documents are designed to be loaded into an AI model's context when it connects to Loom via MCP. They provide the model with the knowledge it needs to:

1. Initialize and switch between projects via `loom_init` / `loom_open`
2. Navigate an indexed codebase without grepping
3. Recall relevant prior work from episodic memory
4. Author and execute graphs (model-driven or client-driven)
5. Mutate graphs mid-run when new information emerges
6. Leverage cached templates for recurring task patterns
