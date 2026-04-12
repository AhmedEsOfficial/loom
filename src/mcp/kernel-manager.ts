/**
 * KernelManager — holds the active LoomKernel and allows switching projects.
 *
 * The MCP server references the manager instead of a kernel directly,
 * so loom_init and loom_open can swap the active kernel at runtime.
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { LoomKernel } from "../kernel.js";
import { loadConfig, saveConfig } from "../cli/config.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("mcp");

export class KernelManager {
  private _kernel: LoomKernel | null = null;
  private _projectPath: string | null = null;

  get kernel(): LoomKernel | null {
    return this._kernel;
  }

  get projectPath(): string | null {
    return this._projectPath;
  }

  get isInitialized(): boolean {
    return this._kernel !== null;
  }

  /**
   * Initialize a new project at the given path.
   * Creates .loom/, runs migrations, builds codebase map.
   */
  async initProject(repoPath: string): Promise<{ nodeCount: number; languages: Record<string, number>; fileCount: number }> {
    const targetPath = resolve(repoPath);
    const dataDir = resolve(targetPath, ".loom");

    // Create data directory
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Shutdown current kernel if switching projects
    if (this._kernel) {
      this._kernel.shutdown();
      this._kernel = null;
    }

    // Load/create config
    const config = await loadConfig(targetPath);
    saveConfig(config);

    // Initialize kernel
    const kernel = new LoomKernel(config);

    // Build codebase map
    const map = await kernel.cartographer.buildMap(targetPath, {});

    this._kernel = kernel;
    this._projectPath = targetPath;

    log.info({ projectPath: targetPath, nodeCount: map.nodeCount }, "Project initialized via MCP");

    return {
      nodeCount: map.nodeCount,
      languages: map.languages,
      fileCount: Object.values(map.languages).reduce((a, b) => a + b, 0),
    };
  }

  /**
   * Open an already-initialized project (has .loom/ directory).
   */
  async openProject(repoPath: string): Promise<void> {
    const targetPath = resolve(repoPath);
    const dataDir = resolve(targetPath, ".loom");

    if (!existsSync(dataDir)) {
      throw new Error(
        `No .loom/ directory found at "${targetPath}". Run loom_init first.`,
      );
    }

    // Shutdown current kernel
    if (this._kernel) {
      this._kernel.shutdown();
      this._kernel = null;
    }

    const config = await loadConfig(targetPath);
    this._kernel = new LoomKernel(config);
    this._projectPath = targetPath;

    log.info({ projectPath: targetPath }, "Project opened via MCP");
  }

  /**
   * Shutdown the current kernel.
   */
  shutdown(): void {
    if (this._kernel) {
      this._kernel.shutdown();
      this._kernel = null;
      this._projectPath = null;
    }
  }

  /**
   * Get the kernel, throwing a clear error if no project is active.
   */
  requireKernel(): LoomKernel {
    if (!this._kernel) {
      throw new Error(
        "No project is active. Call loom_init or loom_open first to initialize or open a project.",
      );
    }
    return this._kernel;
  }
}
