# Substrate Tools Reference

Reference for the 6 tools available to nodes during graph execution. These are different from the MCP tools — they are the tools that individual graph step nodes can call during their execution.

## When are these used?

When a step node in the graph specifies `"tools": ["substrate_search", "map_query"]`, it gains access to those tools during its execution. The node can call them via the standard tool-use protocol.

These tools give nodes access to the persistent substrate without loading data into the context window.

---

## substrate_search

Full-text search over the episodic memory.

**Input:**
```json
{
  "query": "authentication middleware",
  "limit": 20
}
```

- `query` (string, required) — Natural language or keyword search
- `limit` (number, optional) — Max results, default 20

**Output:** JSON array of ranked episode matches with content, tool names, and highlighted terms.

**Node usage example:** "Search memory for prior auth-related work to avoid duplicating effort."

---

## substrate_expand_symbol

Get detailed information about a code symbol from the AST index.

**Input:**
```json
{
  "symbolName": "validateToken",
  "filePath": "src/auth/jwt.ts"
}
```

- `symbolName` (string, required) — Exact symbol name
- `filePath` (string, optional) — Narrow to a specific file

**Output:** JSON with name, kind, file location (path + line range), signature, docstring, callers, callees, and imports. Returns `"Symbol not found"` if no match.

**Node usage example:** "Look up the UserService class to understand its public methods and callers."

---

## substrate_related_episodes

Find episodes from prior runs of similar tasks.

**Input:**
```json
{
  "taskFingerprint": "a1b2c3d4e5f67890",
  "limit": 10
}
```

- `taskFingerprint` (string, required) — 16-char hex fingerprint
- `limit` (number, optional) — Max results, default 10

**Output:** JSON array of episode objects with role, content, graph/node IDs, and timestamps.

**Node usage example:** "Check if this exact task was run before and what the outcome was."

---

## substrate_skill_lookup

Find skills matching a capability description.

**Input:**
```json
{
  "description": "code review security audit"
}
```

- `description` (string, required) — What capability you need

**Output:** JSON array of matching skill definitions with name, description, content, and tags.

**Node usage example:** "Look for a code review skill to apply standard review criteria."

---

## map_query

Browse the codebase map at a given path and resolution.

**Input:**
```json
{
  "path": "src/auth",
  "level": "module",
  "depth": 2
}
```

- `path` (string, required) — File or directory path relative to repo root
- `level` (string, optional) — Resolution: `"file"`, `"module"`, `"package"`, `"repo"`. Auto-detected if omitted.
- `depth` (number, optional) — How many levels of children to include, default 1

**Output:** JSON with the map node (summary, publicApi, complexityScore, language, loc) and its children at the requested depth.

**Node usage example:** "Browse the src/auth module to understand its structure and exported API."

---

## refetch

Re-fetch the full content of an externalized reference.

**Input:**
```json
{
  "ref": "01HXYZ..."
}
```

- `ref` (string, required) — Substrate reference ID

**Output:** The full original content as a string, or `"Content not found"`.

**Node usage example:** "Re-fetch the full test output from the previous step to analyze specific failures."

---

## Specifying tools in step nodes

List the tools a step needs in its `tools` array:

```json
{
  "type": "step",
  "id": "analyze",
  "prompt": "Search for auth-related modules and examine their symbol exports.",
  "tools": ["substrate_search", "substrate_expand_symbol", "map_query"]
}
```

**Best practices:**
- Only include tools the step actually needs — extra tools add noise to the context
- Analysis steps typically need: `substrate_search`, `substrate_expand_symbol`, `map_query`
- Implementation steps typically need: `map_query`, `refetch`
- Recall steps typically need: `substrate_related_episodes`, `substrate_search`
- If a step doesn't need any tools, omit the `tools` field entirely
