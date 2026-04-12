Search Loom's episodic memory for relevant prior work.

Use `loom_search` with the user's query to find episodes from prior sessions. Present:
- The matching episodes ranked by relevance
- Key decisions or findings from past work
- Any relevant graph templates (via `loom_graph_status`)

If the user asks about a specific prior task, use `loom_related_episodes` with the task fingerprint.
If results reference externalized content, use `loom_refetch` to retrieve the full content.
