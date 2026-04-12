Initialize Loom in a project directory. This indexes the codebase using tree-sitter AST parsing and sets up the episodic memory database.

Use the `loom_init` MCP tool with the absolute path to the project directory. If no path is specified by the user, use the current working directory.

After initialization, confirm: how many files were indexed, how many map nodes were created, and what languages were detected. Then suggest useful next steps (e.g., `loom_map_query` to explore the codebase, `loom_expand_symbol` to look up a symbol).
