# Loom Skills

This directory contains skill reference documents for AI models interacting with Loom as an MCP tool server. Each file describes a workflow pattern, tool reference, or domain-specific guide.

## Skill index

| Skill | Purpose |
|---|---|
| [loom-tools-reference.md](loom-tools-reference.md) | Complete reference for all 8 MCP tools — parameters, return formats, error cases |
| [codebase-navigation.md](codebase-navigation.md) | How to explore and understand a codebase using the map and symbol tools |
| [memory-and-search.md](memory-and-search.md) | Working with episodic memory, full-text search, and externalized references |
| [graph-authoring.md](graph-authoring.md) | How to design and emit execution graphs with the 3 node types |
| [graph-mutation.md](graph-mutation.md) | Mid-run graph mutation patterns using `<weave>` tags |
| [task-execution.md](task-execution.md) | End-to-end workflow for submitting tasks via `loom_weave` |
| [template-reuse.md](template-reuse.md) | Working with cached graph templates — discovery, inspection, replay |
| [multi-step-patterns.md](multi-step-patterns.md) | Common graph patterns: analyze-then-act, parallel fan-out, test-fix loops |
| [substrate-tools-reference.md](substrate-tools-reference.md) | Reference for the 6 tools available to nodes inside graph execution |

## How to use these skills

These documents are designed to be loaded into an AI model's context when it connects to Loom via MCP. They provide the model with the knowledge it needs to:

1. Navigate an indexed codebase without grepping
2. Recall relevant prior work from episodic memory
3. Author execution graphs that decompose tasks effectively
4. Mutate graphs mid-run when new information emerges
5. Leverage cached templates for recurring task patterns
