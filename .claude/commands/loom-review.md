Perform a structured code review using Loom's client-driven graph execution.

Submit a 4-node review graph via `loom_submit_graph`:
1. **analyze**: Browse the codebase map and identify the relevant files/modules for the area the user wants reviewed
2. **bugs**: Find bugs, edge cases, and missing error handling in the identified code
3. **security**: Audit for security vulnerabilities (injection, access control, validation, disclosure)
4. **synthesize**: Combine findings into a prioritized, actionable report with concrete fixes

For each node:
- Execute the node yourself using your tools (Read files, Grep, loom_expand_symbol, etc.)
- Report the result via `loom_report_result`
- Use the dependency outputs from prior nodes to inform your work

Present the final synthesized report to the user.
