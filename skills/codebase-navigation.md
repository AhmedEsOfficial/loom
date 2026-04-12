# Codebase Navigation

How to explore and understand a codebase using Loom's map and symbol tools, without reading files directly.

## The codebase map

When a repository is initialized with `loom init`, the Cartographer builds a hierarchical map:

```
repo (root)
├── package (top-level directories)
│   ├── module (sub-directories)
│   │   └── file (source files)
```

Each node in the map carries:
- **summary** — ~200-token LLM-generated description of purpose
- **publicApi** — exported symbols (functions, classes, types)
- **complexityScore** — 0.0 (trivial) to 1.0 (highly complex)
- **loc** — lines of code
- **language** — detected language
- **gitSha** — the commit the map was built from

## Workflow: understanding a codebase

### Step 1: Get the top-level overview

```
loom_map_query({ path: "src", depth: 1 })
```

This returns the `src/` module node and its immediate children. Read the summaries to understand the architecture.

### Step 2: Zoom into an area of interest

```
loom_map_query({ path: "src/auth", depth: 2 })
```

Depth 2 gives you the module, its files, and their children. The `publicApi` field tells you what each file exports without reading it.

### Step 3: Look up a specific symbol

```
loom_expand_symbol({ symbolName: "validateToken" })
```

Returns the exact file, line range, signature, docstring, and — critically — **callers** and **callees**. This lets you trace call chains.

### Step 4: Narrow to a file

```
loom_expand_symbol({ symbolName: "createSession", filePath: "src/auth/session.ts" })
```

If the symbol name is common (e.g., `handle`, `create`), always provide the file path.

## Tips for effective navigation

1. **Start wide, then narrow.** Don't jump to individual symbols before understanding the module structure.

2. **Use publicApi to find entry points.** The `publicApi` field on module and file nodes lists what's exported — these are the interface boundaries.

3. **Use complexityScore to prioritize.** Files with high complexity (>0.5) are the ones most likely to contain subtle logic worth understanding before changing.

4. **Use callers/callees for impact analysis.** Before modifying a function, check its callers. If `callers` is empty, the function may be dead code. If it has many callers, changes need careful consideration.

5. **Search by name, not by file.** `loom_expand_symbol` searches the entire codebase. You don't need to know which file a symbol is in.

## Supported file types

| Language | Extensions |
|---|---|
| TypeScript | `.ts`, `.tsx` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py` |
| Go | `.go` |
| Rust | `.rs` |
| Java | `.java` |
| C/C++ | `.c`, `.h`, `.cpp`, `.cc`, `.hpp` |

Files outside these extensions are not indexed and won't appear in the map.

## Symbol kinds

Symbols extracted from the AST index have these kinds:

| Kind | Languages |
|---|---|
| `function` | All |
| `class` | TS/JS, Python, Java, C++ |
| `method` | All (as children of classes/structs/impls) |
| `interface` | TS/JS, Go, Java |
| `type` | TS/JS, Go |
| `variable` | TS/JS |
| `enum` | TS/JS, Rust, Java, C |
| `struct` | Go, Rust, C |
| `trait` | Rust |

## When the map is stale

The map is pinned to a `gitSha`. If the codebase has changed since the last index:
- Use the CLI: `loom map --refresh`
- Or re-run `loom init` to rebuild from scratch
- If Loom was started with file watching enabled, changes are picked up automatically with a 500ms debounce
