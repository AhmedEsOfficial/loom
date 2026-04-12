import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { LoomKernel } from "../../kernel.js";
import { loadConfig, saveConfig } from "../config.js";
import { createLogger } from "../../util/logger.js";

const log = createLogger("cli");

export async function initCommand(repoPath?: string): Promise<void> {
  const targetPath = resolve(repoPath ?? process.cwd());
  const dataDir = resolve(targetPath, ".loom");

  console.log(`Initializing Loom in ${targetPath}`);

  // Create data directory
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`  Created ${dataDir}`);
  }

  // Load/create config
  const config = loadConfig(targetPath);
  saveConfig(config);
  console.log(`  Configuration saved to ${dataDir}/config.json`);

  // Initialize kernel (runs migrations)
  const kernel = new LoomKernel(config);
  console.log(`  Database initialized`);

  // Build codebase map
  console.log(`  Building codebase map...`);
  const startTime = performance.now();

  const map = await kernel.cartographer.buildMap(targetPath, {
    onFileIndexed: (filePath, symbolCount) => {
      if (symbolCount > 0) {
        process.stdout.write(".");
      }
    },
    onMapComplete: (map) => {
      console.log();
      console.log(`  Map complete: ${map.nodeCount} nodes across ${Object.keys(map.languages).length} languages`);
      console.log(`  Languages: ${Object.entries(map.languages).map(([k, v]) => `${k}(${v})`).join(", ")}`);
    },
    onError: (error, filePath) => {
      log.debug({ error, filePath }, "Parse error (non-fatal)");
    },
  });

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`  Completed in ${elapsed}s`);
  console.log();
  console.log(`Loom is ready. Run 'loom run "<task>"' to start.`);

  kernel.shutdown();
}
