import type { LoomKernel } from "../kernel.js";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function listResources(kernel: LoomKernel): McpResource[] {
  const resources: McpResource[] = [];

  // List repos
  const repos = kernel.db
    .prepare("SELECT DISTINCT repo_id FROM map_nodes")
    .all() as { repo_id: string }[];

  for (const repo of repos) {
    resources.push({
      uri: `loom://map/${repo.repo_id}`,
      name: `Codebase Map: ${repo.repo_id}`,
      description: "Hierarchical codebase map with summaries and symbol index",
      mimeType: "application/json",
    });
  }

  return resources;
}

export async function readResource(
  kernel: LoomKernel,
  uri: string,
): Promise<string> {
  const url = new URL(uri);

  if (url.protocol === "loom:" && url.pathname.startsWith("//map/")) {
    const parts = url.pathname.slice(6).split("/");
    const repoId = parts[0];
    const path = parts.slice(1).join("/");

    if (path) {
      // Specific path
      const node = await kernel.cartographer.zoomTo(path);
      if (!node) return JSON.stringify({ error: "Not found" });

      const children = await kernel.cartographer.queryMap(node.id, 1);
      return JSON.stringify({ node, children }, null, 2);
    }

    // Repo root
    const rootNode = kernel.db
      .prepare("SELECT * FROM map_nodes WHERE repo_id = ? AND level = 'repo'")
      .get(repoId) as any;

    if (!rootNode) return JSON.stringify({ error: "Repo not found" });

    const topLevel = kernel.db
      .prepare("SELECT * FROM map_nodes WHERE parent_id = ? ORDER BY path")
      .all(rootNode.id) as any[];

    return JSON.stringify({ root: rootNode, children: topLevel }, null, 2);
  }

  if (url.pathname.startsWith("//episode/")) {
    const id = url.pathname.slice(10);
    const episode = kernel.substrate.episodes.getById(id as any);
    return episode ? JSON.stringify(episode, null, 2) : JSON.stringify({ error: "Not found" });
  }

  if (url.pathname.startsWith("//graph/")) {
    const id = url.pathname.slice(8);
    const templates = kernel.graphCache.list(100);
    const template = templates.find((t) => t.id === id);
    return template
      ? JSON.stringify(template, null, 2)
      : JSON.stringify({ error: "Not found" });
  }

  return JSON.stringify({ error: "Unknown resource URI" });
}
