import { LoomKernel } from "../../kernel.js";
import { loadConfig } from "../config.js";

export async function mapCommand(opts: {
  refresh?: boolean;
  zoom?: string;
}): Promise<void> {
  const config = await loadConfig();
  const kernel = new LoomKernel(config);

  try {
    if (opts.refresh) {
      console.log("Refreshing codebase map...");
      await kernel.cartographer.buildMap(config.repoPath, {
        onFileIndexed: () => process.stdout.write("."),
        onMapComplete: (map) => {
          console.log();
          console.log(`Map refreshed: ${map.nodeCount} nodes`);
        },
      });
      return;
    }

    if (opts.zoom) {
      const node = await kernel.cartographer.zoomTo(opts.zoom);
      if (!node) {
        console.log(`No map node found for path: ${opts.zoom}`);
        return;
      }

      console.log(`Path: ${node.path}`);
      console.log(`Level: ${node.level}`);
      console.log(`Language: ${node.language}`);
      console.log(`LOC: ${node.loc}`);
      console.log(`Complexity: ${node.complexityScore.toFixed(2)}`);
      console.log(`Public API: ${node.publicApi.join(", ") || "(none)"}`);
      console.log(`Summary: ${node.summary || "(not yet summarized)"}`);

      // Show children
      const children = await kernel.cartographer.queryMap(node.id, 1);
      if (children.length > 1) {
        console.log(`\nChildren (${children.length - 1}):`);
        for (const child of children.slice(1)) {
          console.log(`  ${child.path} [${child.level}] ${child.summary.slice(0, 80)}`);
        }
      }
      return;
    }

    // Default: show top-level summary
    const repos = kernel.db
      .prepare("SELECT DISTINCT repo_id FROM map_nodes")
      .all() as { repo_id: string }[];

    if (repos.length === 0) {
      console.log("No codebase maps found. Run 'loom init' first.");
      return;
    }

    for (const repo of repos) {
      const stats = kernel.db
        .prepare(
          "SELECT level, COUNT(*) as count, SUM(loc) as total_loc FROM map_nodes WHERE repo_id = ? GROUP BY level",
        )
        .all(repo.repo_id) as { level: string; count: number; total_loc: number }[];

      console.log(`Repository: ${repo.repo_id}`);
      for (const stat of stats) {
        console.log(`  ${stat.level}: ${stat.count} nodes, ${stat.total_loc ?? 0} LOC`);
      }

      const symbolCount = kernel.db
        .prepare(
          "SELECT COUNT(*) as count FROM symbols s JOIN map_nodes m ON s.map_node_id = m.id WHERE m.repo_id = ?",
        )
        .get(repo.repo_id) as { count: number };

      console.log(`  Symbols indexed: ${symbolCount.count}`);
    }
  } finally {
    kernel.shutdown();
  }
}
