import type Database from "better-sqlite3";
import type { ExecutionGraph, GraphTemplate } from "../types/weaver.js";
import type { TemplateId } from "../types/common.js";
import { contentHash } from "../util/hash.js";
import { newTemplateId } from "../util/id.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("weaver");

export class GraphCache {
  private getByHashStmt: Database.Statement;
  private insertStmt: Database.Statement;
  private updateStatsStmt: Database.Statement;
  private listStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.getByHashStmt = db.prepare(
      "SELECT * FROM graph_templates WHERE content_hash = ?",
    );

    this.insertStmt = db.prepare(`
      INSERT OR IGNORE INTO graph_templates (id, content_hash, task_pattern, graph_json, success_count, failure_count, created_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `);

    this.updateStatsStmt = db.prepare(`
      UPDATE graph_templates
      SET success_count = success_count + ?,
          failure_count = failure_count + ?,
          avg_duration = ?,
          last_used_at = ?
      WHERE id = ?
    `);

    this.listStmt = db.prepare(
      "SELECT * FROM graph_templates ORDER BY last_used_at DESC LIMIT ?",
    );
  }

  /**
   * Look up a cached graph by content hash.
   */
  lookup(hash: string): GraphTemplate | null {
    const row = this.getByHashStmt.get(hash) as TemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }

  /**
   * Cache a graph template.
   */
  store(
    graph: ExecutionGraph,
    taskPattern: string,
  ): TemplateId {
    const id = newTemplateId();
    const graphJson = JSON.stringify(graph.nodes);
    const hash = contentHash(graphJson);

    this.insertStmt.run(id, hash, taskPattern, graphJson, Date.now());
    log.info({ id, hash: hash.slice(0, 8) }, "Graph template cached");

    return id;
  }

  /**
   * Update statistics for a template after execution.
   */
  updateStats(
    templateId: TemplateId,
    success: boolean,
    duration: number,
  ): void {
    this.updateStatsStmt.run(
      success ? 1 : 0,
      success ? 0 : 1,
      Math.round(duration),
      Date.now(),
      templateId,
    );
  }

  /**
   * Find templates matching a task pattern.
   */
  findByPattern(pattern: string, limit = 5): GraphTemplate[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM graph_templates WHERE task_pattern LIKE ? ORDER BY success_count DESC LIMIT ?",
      )
      .all(`%${pattern}%`, limit) as TemplateRow[];

    return rows.map(rowToTemplate);
  }

  /**
   * List recent templates.
   */
  list(limit = 20): GraphTemplate[] {
    const rows = this.listStmt.all(limit) as TemplateRow[];
    return rows.map(rowToTemplate);
  }

  /**
   * Store a graph execution record.
   */
  recordExecution(
    executionId: string,
    graphId: string,
    status: string,
    resultsJson: string,
    startedAt: number,
    completedAt: number | null,
    tokensIn: number,
    tokensOut: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO graph_executions (id, graph_id, status, results_json, started_at, completed_at, total_tokens_in, total_tokens_out)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        executionId,
        graphId,
        status,
        resultsJson,
        startedAt,
        completedAt,
        tokensIn,
        tokensOut,
      );
  }
}

interface TemplateRow {
  id: string;
  content_hash: string;
  task_pattern: string;
  graph_json: string;
  success_count: number;
  failure_count: number;
  avg_duration: number | null;
  created_at: number;
  last_used_at: number | null;
}

function rowToTemplate(row: TemplateRow): GraphTemplate {
  return {
    id: row.id as TemplateId,
    contentHash: row.content_hash,
    taskPattern: row.task_pattern,
    graphJson: row.graph_json,
    successCount: row.success_count,
    failureCount: row.failure_count,
    avgDuration: row.avg_duration ?? undefined,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}
