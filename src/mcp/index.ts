import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LoomKernel } from "../kernel.js";
import { createMcpTools } from "./tools.js";
import { listResources, readResource } from "./resources.js";

export function createMcpServer(kernel: LoomKernel): McpServer {
  const server = new McpServer({
    name: "loom",
    version: "0.1.0",
  });

  // Register tools
  const tools = createMcpTools(kernel);
  for (const tool of tools) {
    // Convert JSON Schema properties to Zod schema for MCP SDK
    const shape: Record<string, z.ZodTypeAny> = {};
    const props = (tool.inputSchema as any).properties ?? {};
    const required = new Set((tool.inputSchema as any).required ?? []);

    for (const [key, prop] of Object.entries(props)) {
      const p = prop as any;
      let zodType: z.ZodTypeAny;
      switch (p.type) {
        case "string":
          zodType = z.string().describe(p.description ?? "");
          break;
        case "number":
          zodType = z.number().describe(p.description ?? "");
          break;
        case "boolean":
          zodType = z.boolean().describe(p.description ?? "");
          break;
        default:
          zodType = z.any();
      }
      shape[key] = required.has(key) ? zodType : zodType.optional();
    }

    server.tool(tool.name, tool.description, shape, async (params) => {
      const result = await tool.handler(params as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: result }] };
    });
  }

  // Register resources
  server.resource(
    "map",
    "loom://map/{repoId}",
    async (uri) => {
      const content = await readResource(kernel, uri.href);
      return { contents: [{ uri: uri.href, text: content, mimeType: "application/json" }] };
    },
  );

  return server;
}
