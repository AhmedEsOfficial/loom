import { LoomKernel } from "../../kernel.js";
import { loadConfig } from "../config.js";
import { createMcpServer } from "../../mcp/index.js";

export async function serveCommand(opts: { port?: number }): Promise<void> {
  const config = loadConfig();
  const kernel = new LoomKernel(config);

  console.log("Starting Loom MCP server...");

  const server = createMcpServer(kernel);

  if (opts.port) {
    // SSE transport
    console.log(`Loom MCP server listening on port ${opts.port} (SSE)`);
    // For SSE, we'd use the MCP SDK's SSE transport
    // For now, default to stdio
    console.log("SSE transport not yet implemented, falling back to stdio");
  }

  // stdio transport (default)
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
