import { LoomKernel } from "../../kernel.js";
import { loadConfig } from "../config.js";
import { createMcpServer } from "../../mcp/index.js";

export async function serveCommand(opts: { port?: number }): Promise<void> {
  const config = await loadConfig();
  const kernel = new LoomKernel(config);

  // All user-facing output must go to stderr — stdout is reserved for MCP JSON-RPC
  console.error("Starting Loom MCP server...");

  const server = createMcpServer(kernel);

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
    kernel.shutdown();
    process.exit(0);
  });
}
