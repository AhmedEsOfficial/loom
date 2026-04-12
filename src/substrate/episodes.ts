import type Database from "better-sqlite3";
import type { EpisodeId } from "../types/common.js";
import type { Episode, EpisodeInsert } from "../types/substrate.js";
import { newEpisodeId } from "../util/id.js";
import { estimateTokens } from "../util/tokens.js";

export class EpisodeStore {
  private insertStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private getByTaskStmt: Database.Statement;
  private getByGraphStmt: Database.Statement;
  private getRecentStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO episodes (id, task_fingerprint, role, content, tool_name, tool_input, tool_output, graph_id, node_id, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getByIdStmt = db.prepare("SELECT * FROM episodes WHERE id = ?");

    this.getByTaskStmt = db.prepare(
      "SELECT * FROM episodes WHERE task_fingerprint = ? ORDER BY created_at DESC LIMIT ?",
    );

    this.getByGraphStmt = db.prepare(
      "SELECT * FROM episodes WHERE graph_id = ? ORDER BY created_at ASC",
    );

    this.getRecentStmt = db.prepare(
      "SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?",
    );
  }

  insert(episode: EpisodeInsert): EpisodeId {
    const id = newEpisodeId();
    const tokenCount =
      episode.tokenCount || estimateTokens(episode.content);
    const now = Date.now();

    this.insertStmt.run(
      id,
      episode.taskFingerprint,
      episode.role,
      episode.content,
      episode.toolName ?? null,
      episode.toolInput ?? null,
      episode.toolOutput ?? null,
      episode.graphId ?? null,
      episode.nodeId ?? null,
      tokenCount,
      now,
    );

    return id;
  }

  getById(id: EpisodeId): Episode | null {
    const row = this.getByIdStmt.get(id) as EpisodeRow | undefined;
    return row ? rowToEpisode(row) : null;
  }

  getByTask(taskFingerprint: string, limit = 20): Episode[] {
    const rows = this.getByTaskStmt.all(taskFingerprint, limit) as EpisodeRow[];
    return rows.map(rowToEpisode);
  }

  getByGraph(graphId: string): Episode[] {
    const rows = this.getByGraphStmt.all(graphId) as EpisodeRow[];
    return rows.map(rowToEpisode);
  }

  getRecent(limit = 50): Episode[] {
    const rows = this.getRecentStmt.all(limit) as EpisodeRow[];
    return rows.map(rowToEpisode);
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM episodes")
      .get() as { count: number };
    return row.count;
  }
}

interface EpisodeRow {
  id: string;
  task_fingerprint: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  graph_id: string | null;
  node_id: string | null;
  token_count: number;
  created_at: number;
}

function rowToEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id as EpisodeId,
    taskFingerprint: row.task_fingerprint,
    role: row.role as Episode["role"],
    content: row.content,
    toolName: row.tool_name ?? undefined,
    toolInput: row.tool_input ?? undefined,
    toolOutput: row.tool_output ?? undefined,
    graphId: row.graph_id ? (row.graph_id as any) : undefined,
    nodeId: row.node_id ? (row.node_id as any) : undefined,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}
