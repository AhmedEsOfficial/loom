import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LoomKernel } from "../kernel.js";
import { createManagedMcpTools, type McpToolDefinition } from "./tools.js";
import { KernelManager } from "./kernel-manager.js";
import { readResource } from "./resources.js";

export { KernelManager } from "./kernel-manager.js";

/**
 * Create an MCP server backed by a KernelManager.
 * Supports loom_init / loom_open for project switching.
 * If a kernel is provided, it becomes the initial active project.
 */
export function createMcpServer(kernelOrManager: LoomKernel | KernelManager): McpServer {
  const manager = kernelOrManager instanceof KernelManager
    ? kernelOrManager
    : (() => {
        const m = new KernelManager();
        // Inject the existing kernel directly
        (m as any)._kernel = kernelOrManager;
        (m as any)._projectPath = kernelOrManager.config.repoPath;
        return m;
      })();

  const server = new McpServer({
    name: "loom",
    version: "0.1.0",
  });

  // Register tools (includes loom_init, loom_open, loom_status + all core tools)
  const tools = createManagedMcpTools(manager);
  for (const tool of tools) {
    const shape = buildZodShape(tool);

    server.tool(tool.name, tool.description, shape, async (params) => {
      try {
        const result = await tool.handler(params as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (error: any) {
        // Catch "no project active" errors and return a helpful message
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }, null, 2) }],
          isError: true,
        };
      }
    });
  }

  // Register resources
  server.resource(
    "map",
    "loom://map/{repoId}",
    async (uri) => {
      const kernel = manager.requireKernel();
      const content = await readResource(kernel, uri.href);
      return { contents: [{ uri: uri.href, text: content, mimeType: "application/json" }] };
    },
  );

  return server;
}

function buildZodShape(tool: McpToolDefinition): Record<string, z.ZodTypeAny> {
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
      case "array":
        zodType = z.array(z.any()).describe(p.description ?? "");
        break;
      default:
        zodType = z.any();
    }
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }

  return shape;
}
