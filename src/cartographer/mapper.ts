import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname, basename, sep } from "node:path";
import type Database from "better-sqlite3";
import type { MapNode, MapNodeInsert, CodebaseMap, ParsedFile } from "../types/cartographer.js";
import type { MapNodeId } from "../types/common.js";
import { newMapNodeId } from "../util/id.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("cartographer");

export class CodebaseMapper {
  private insertNodeStmt: Database.Statement;
  private insertSymbolStmt: Database.Statement;
  private getNodeByPathStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertNodeStmt = db.prepare(`
      INSERT OR REPLACE INTO map_nodes (id, repo_id, path, level, parent_id, summary, public_api, complexity_score, exemplar_callers, language, loc, git_sha, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertSymbolStmt = db.prepare(`
      INSERT OR REPLACE INTO symbols (id, map_node_id, name, kind, file_path, start_line, end_line, signature, docstring)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getNodeByPathStmt = db.prepare(
      "SELECT * FROM map_nodes WHERE path = ? AND repo_id = ?",
    );
  }

  /**
   * Build the hierarchical codebase map from parsed files.
   */
  buildMap(
    repoPath: string,
    repoId: string,
    parsedFiles: ParsedFile[],
    gitSha: string,
    ignorePatterns: string[],
  ): CodebaseMap {
    const now = Date.now();
    const languages: Record<string, number> = {};

    // Create repo root node
    const rootId = newMapNodeId();
    this.insertNodeStmt.run(
      rootId, repoId, "/", "repo", null, "", "[]", 0, "[]", "", 0, gitSha, now,
    );

    // Build directory structure
    const dirNodes = new Map<string, MapNodeId>();
    dirNodes.set("", rootId);

    // Ensure parent directories exist
    const ensureDir = (dirPath: string, level: "module" | "package"): MapNodeId => {
      const existing = dirNodes.get(dirPath);
      if (existing) return existing;

      const parentDir = dirname(dirPath);
      const parentId =
        parentDir === dirPath || parentDir === "."
          ? rootId
          : ensureDir(parentDir, "package");

      const id = newMapNodeId();
      this.insertNodeStmt.run(
        id, repoId, dirPath, level, parentId, "", "[]", 0, "[]", "", 0, gitSha, now,
      );
      dirNodes.set(dirPath, id);
      return id;
    };

    // Process each parsed file
    let nodeCount = 1; // Start with root

    this.db.transaction(() => {
      for (const file of parsedFiles) {
        const relPath = relative(repoPath, file.filePath);
        const dirPath = dirname(relPath);

        // Determine directory level
        const depth = dirPath.split(sep).filter(Boolean).length;
        const dirLevel = depth <= 1 ? "module" : "package";
        const parentId = dirPath === "." ? rootId : ensureDir(dirPath, dirLevel as any);

        // Count languages
        languages[file.language] = (languages[file.language] ?? 0) + 1;

        // Create file node
        const fileId = newMapNodeId();
        this.insertNodeStmt.run(
          fileId,
          repoId,
          relPath,
          "file",
          parentId,
          "", // Summary filled by summarizer
          JSON.stringify(file.exports),
          file.complexityScore,
          "[]",
          file.language,
          file.loc,
          gitSha,
          now,
        );
        nodeCount++;

        // Insert symbols
        for (const sym of file.symbols) {
          const symId = newMapNodeId();
          this.insertSymbolStmt.run(
            symId,
            fileId,
            sym.name,
            sym.kind,
            relPath,
            sym.startLine,
            sym.endLine,
            sym.signature,
            sym.docstring ?? "",
          );

          // Process child symbols (class members)
          if (sym.children) {
            for (const child of sym.children) {
              const childId = newMapNodeId();
              this.insertSymbolStmt.run(
                childId,
                fileId,
                `${sym.name}.${child.name}`,
                child.kind,
                relPath,
                child.startLine,
                child.endLine,
                child.signature,
                child.docstring ?? "",
              );
            }
          }
        }
      }
    })();

    nodeCount += dirNodes.size;

    log.info(
      {
        repoId,
        nodeCount,
        fileCount: parsedFiles.length,
        languages: Object.keys(languages).length,
      },
      "Codebase map built",
    );

    return {
      repoId,
      rootNodeId: rootId,
      gitSha,
      nodeCount,
      languages,
    };
  }

  /**
   * Query map nodes by node ID with optional depth.
   */
  queryNode(nodeId: MapNodeId, depth = 1): MapNode[] {
    const results: MapNode[] = [];
    const node = this.db
      .prepare("SELECT * FROM map_nodes WHERE id = ?")
      .get(nodeId) as MapNodeRow | undefined;

    if (!node) return results;
    results.push(rowToMapNode(node));

    if (depth > 0) {
      const children = this.db
        .prepare("SELECT * FROM map_nodes WHERE parent_id = ? ORDER BY path")
        .all(nodeId) as MapNodeRow[];

      for (const child of children) {
        results.push(rowToMapNode(child));
        if (depth > 1) {
          results.push(...this.queryNode(child.id as MapNodeId, depth - 1));
        }
      }
    }

    return results;
  }

  /**
   * Zoom to a path at a given level.
   */
  zoomTo(path: string, repoId: string): MapNode | null {
    const row = this.getNodeByPathStmt.get(path, repoId) as MapNodeRow | undefined;
    return row ? rowToMapNode(row) : null;
  }

  /**
   * Remove all nodes for a given file path (for incremental updates).
   */
  removeFile(filePath: string, repoId: string): void {
    const node = this.getNodeByPathStmt.get(filePath, repoId) as MapNodeRow | undefined;
    if (node) {
      // Delete symbols first (FK cascade should handle this, but be explicit)
      this.db.prepare("DELETE FROM symbols WHERE map_node_id = ?").run(node.id);
      this.db.prepare("DELETE FROM map_nodes WHERE id = ?").run(node.id);
    }
  }
}

interface MapNodeRow {
  id: string;
  repo_id: string;
  path: string;
  level: string;
  parent_id: string | null;
  summary: string;
  public_api: string;
  complexity_score: number;
  exemplar_callers: string;
  language: string;
  loc: number;
  git_sha: string;
  updated_at: number;
}

function rowToMapNode(row: MapNodeRow): MapNode {
  return {
    id: row.id as MapNodeId,
    repoId: row.repo_id,
    path: row.path,
    level: row.level as MapNode["level"],
    parentId: row.parent_id ? (row.parent_id as MapNodeId) : null,
    summary: row.summary,
    publicApi: safeJsonParse(row.public_api),
    complexityScore: row.complexity_score,
    exemplarCallers: safeJsonParse(row.exemplar_callers),
    language: row.language,
    loc: row.loc,
    gitSha: row.git_sha,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse(json: string): string[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Collect all files in a directory, respecting ignore patterns.
 */
export function collectFiles(
  rootPath: string,
  ignorePatterns: string[],
  extensions: Set<string>,
): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Check ignore patterns
      if (ignorePatterns.some((p) => entry.name === p || fullPath.includes(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (extensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(rootPath);
  return files;
}
