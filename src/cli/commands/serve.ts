import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createMcpServer, KernelManager } from "../../mcp/index.js";

export async function serveCommand(opts: { port?: number }): Promise<void> {
  const manager = new KernelManager();

  // If we're in an initialized project, open it automatically
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, ".loom"))) {
    try {
      await manager.openProject(cwd);
      console.error(`Loom MCP server: opened project at ${cwd}`);
    } catch (e: any) {
      console.error(`Warning: could not open project at ${cwd}: ${e.message}`);
    }
  } else {
    console.error("Loom MCP server: no active project. Use loom_init or loom_open to set one.");
  }

  const server = createMcpServer(manager);

  if (opts.port) {
    console.error(`SSE transport not yet implemented, falling back to stdio`);
  }

  // stdio transport (default for Claude Code / IDE integration)
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Loom MCP server running on stdio");

  // Keep alive until killed
  process.on("SIGINT", () => {
    manager.shutdown();
    process.exit(0);
  });
}
