import { watch, type FSWatcher } from "chokidar";
import { createLogger } from "../util/logger.js";
import type { ParsedFile } from "../types/cartographer.js";
import { parseFile, detectLanguage } from "./parser.js";
import type { CodebaseMapper } from "./mapper.js";

const log = createLogger("cartographer");

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges = new Set<string>();
  private debounceMs: number;

  constructor(
    private mapper: CodebaseMapper,
    private repoId: string,
    private onFilesChanged?: (files: string[]) => Promise<void>,
    debounceMs = 500,
  ) {
    this.debounceMs = debounceMs;
  }

  start(repoPath: string, ignorePatterns: string[]): void {
    if (this.watcher) {
      log.warn("Watcher already running");
      return;
    }

    const ignored = ignorePatterns.map((p) => `**/${p}/**`);

    this.watcher = watch(repoPath, {
      ignored: [...ignored, /(^|[/\\])\./], // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
      },
    });

    this.watcher
      .on("change", (path) => this.queueChange(path))
      .on("add", (path) => this.queueChange(path))
      .on("unlink", (path) => this.queueDelete(path))
      .on("error", (error) => log.error({ error }, "Watcher error"));

    log.info({ repoPath }, "File watcher started");
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();
    log.info("File watcher stopped");
  }

  private queueChange(filePath: string): void {
    // Only watch supported languages
    if (!detectLanguage(filePath)) return;

    this.pendingChanges.add(filePath);
    this.scheduleBatch();
  }

  private queueDelete(filePath: string): void {
    if (!detectLanguage(filePath)) return;

    // Remove from map immediately
    this.mapper.removeFile(filePath, this.repoId);
    log.debug({ filePath }, "File removed from map");
  }

  private scheduleBatch(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const files = [...this.pendingChanges];
      this.pendingChanges.clear();

      if (files.length === 0) return;

      log.info({ fileCount: files.length }, "Processing file changes");

      try {
        await this.onFilesChanged?.(files);
      } catch (error) {
        log.error({ error, fileCount: files.length }, "Error processing file changes");
      }
    }, this.debounceMs);
  }
}
