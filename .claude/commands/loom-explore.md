Explore the currently active Loom project's codebase structure.

1. First call `loom_status` to confirm a project is active.
2. Use `loom_map_query` with path "src" (or the project's main source directory) at depth 1 to get a high-level overview.
3. Present the results as a tree showing: directory structure, file counts per module, languages detected, and notable exports.
4. If the user asks about a specific area, use `loom_map_query` to zoom in, and `loom_expand_symbol` for specific symbols.

Do not read files directly — use the Loom substrate tools to navigate.
