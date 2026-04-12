import type Database from "better-sqlite3";
import type { Conductor } from "../types/conductor.js";
import type {
  Cartographer,
  CartographerEvents,
  CodebaseMap,
  MapLevel,
  MapNode,
} from "../types/cartographer.js";
import type { SymbolDetail } from "../types/substrate.js";
import type { MapNodeId } from "../types/common.js";
import { parseFile, detectLanguage } from "./parser.js";
import { CodebaseMapper, collectFiles, loadIgnorePatterns } from "./mapper.js";
import { MapSummarizer } from "./summarizer.js";
import { FileWatcher } from "./watcher.js";
import { createLogger } from "../util/logger.js";
import { execSync } from "node:child_process";

const log = createLogger("cartographer");

export { parseFile, detectLanguage } from "./parser.js";
export { CodebaseMapper, collectFiles, loadIgnorePatterns } from "./mapper.js";
export { MapSummarizer } from "./summarizer.js";
export { FileWatcher } from "./watcher.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".cc", ".hpp",
]);

export class CartographerImpl implements Cartographer {
  private mapper: CodebaseMapper;
  private summarizer: MapSummarizer;
  private watcher: FileWatcher | null = null;
  private ignorePatterns: string[];

  constructor(
    private db: Database.Database,
    private conductor: Conductor,
    private cartographerModel: string,
    ignorePatterns: string[] = [],
    summaryBatchSize = 15,
  ) {
    this.mapper = new CodebaseMapper(db);
    this.summarizer = new MapSummarizer(db, conductor, cartographerModel, summaryBatchSize);
    this.ignorePatterns = ignorePatterns;
  }

  async buildMap(
    repoPath: string,
    events?: CartographerEvents,
  ): Promise<CodebaseMap> {
    const repoId = repoPath.replace(/\//g, "_");
    const gitSha = getGitSha(repoPath);

    log.info({ repoPath, gitSha }, "Building codebase map");

    // Load ignore patterns from .loomignore, .gitignore, and config
    const effectiveIgnore = loadIgnorePatterns(repoPath, this.ignorePatterns);

    // Collect all source files
    const files = collectFiles(repoPath, effectiveIgnore, SUPPORTED_EXTENSIONS);
    log.info({ fileCount: files.length }, "Collected source files");

    // Parse all files
    const parsedFiles = [];
    for (const filePath of files) {
      try {
        const parsed = await parseFile(filePath);
        if (parsed) {
          parsedFiles.push(parsed);
          events?.onFileIndexed?.(filePath, parsed.symbols.length);
        }
      } catch (error) {
        events?.onError?.(error as Error, filePath);
      }
    }

    log.info(
      { parsedCount: parsedFiles.length, totalSymbols: parsedFiles.reduce((s, f) => s + f.symbols.length, 0) },
      "Files parsed",
    );

    // Build the hierarchical map
    const map = this.mapper.buildMap(
      repoPath,
      repoId,
      parsedFiles,
      gitSha,
      this.ignorePatterns,
    );

    // Summarize files
    const summarized = await this.summarizer.summarizeFiles(
      repoId,
      events?.onNodeSummarized,
    );
    log.info({ summarized }, "Summaries generated");

    events?.onMapComplete?.(map);
    return map;
  }

  async refreshMap(repoPath: string, changedFiles: string[]): Promise<void> {
    const repoId = repoPath.replace(/\//g, "_");
    const gitSha = getGitSha(repoPath);

    for (const filePath of changedFiles) {
      // Remove old data
      this.mapper.removeFile(filePath, repoId);

      // Re-parse
      const parsed = await parseFile(filePath);
      if (parsed) {
        this.mapper.buildMap(repoPath, repoId, [parsed], gitSha, this.ignorePatterns);
      }
    }

    // Re-summarize affected files
    await this.summarizer.summarizeFiles(repoId);
  }

  async queryMap(nodeId: MapNodeId, depth = 1): Promise<MapNode[]> {
    return this.mapper.queryNode(nodeId, depth);
  }

  async zoomTo(path: string, level?: MapLevel): Promise<MapNode | null> {
    // Try to find by path (use first repo)
    const repos = this.db
      .prepare("SELECT DISTINCT repo_id FROM map_nodes LIMIT 1")
      .all() as { repo_id: string }[];

    if (repos.length === 0) return null;

    return this.mapper.zoomTo(path, repos[0]!.repo_id);
  }

  async findSymbol(name: string): Promise<SymbolDetail[]> {
    const rows = this.db
      .prepare("SELECT * FROM symbols WHERE name = ? LIMIT 20")
      .all(name) as any[];

    return rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      signature: row.signature,
      docstring: row.docstring || undefined,
      callers: [],
      callees: [],
      imports: [],
    }));
  }

  startWatching(repoPath: string): void {
    const repoId = repoPath.replace(/\//g, "_");

    this.watcher = new FileWatcher(
      this.mapper,
      repoId,
      async (files) => {
        await this.refreshMap(repoPath, files);
      },
    );

    this.watcher.start(repoPath, this.ignorePatterns);
  }

  stopWatching(): void {
    this.watcher?.stop();
    this.watcher = null;
  }
}

function getGitSha(repoPath: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoPath })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}
