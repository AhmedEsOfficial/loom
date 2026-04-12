import type Database from "better-sqlite3";
import type { SubstrateResult, VectorInsert } from "../types/substrate.js";
import { newId } from "../util/id.js";

export class VectorStore {
  private insertMetaStmt: Database.Statement;
  private getMetaStmt: Database.Statement;
  private getMetaBySourceStmt: Database.Statement;
  private insertVecStmt: Database.Statement;

  constructor(
    private db: Database.Database,
    private dimensions: number = 1536,
  ) {
    this.insertVecStmt = db.prepare(
      "INSERT INTO vectors (embedding) VALUES (?)",
    );

    this.insertMetaStmt = db.prepare(`
      INSERT INTO vector_metadata (id, source_type, source_id, text, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.getMetaStmt = db.prepare(
      "SELECT * FROM vector_metadata WHERE id = ?",
    );

    this.getMetaBySourceStmt = db.prepare(
      "SELECT * FROM vector_metadata WHERE source_type = ? AND source_id = ?",
    );
  }

  insert(entry: VectorInsert): string {
    const now = Date.now();

    // Insert into vec0 table — rowid is auto-assigned
    const result = this.insertVecStmt.run(
      Buffer.from(entry.embedding.buffer),
    );
    const rowId = result.lastInsertRowid;
    const id = String(rowId);

    // Insert metadata keyed by the same integer-as-string
    this.insertMetaStmt.run(
      id,
      entry.sourceType,
      entry.sourceId,
      entry.text,
      JSON.stringify(entry.metadata),
      now,
    );

    return id;
  }

  search(
    embedding: Float32Array,
    limit = 10,
    sourceType?: string,
  ): SubstrateResult[] {
    // sqlite-vec KNN query
    let query: string;
    let params: unknown[];

    if (sourceType) {
      query = `
        SELECT
          v.rowid as id,
          v.distance as score,
          vm.text as content,
          vm.source_type,
          vm.source_id,
          vm.metadata
        FROM vectors v
        JOIN vector_metadata vm ON CAST(vm.id AS INTEGER) = v.rowid
        WHERE v.embedding MATCH ? AND k = ?
          AND vm.source_type = ?
        ORDER BY v.distance
      `;
      params = [Buffer.from(embedding.buffer), limit, sourceType];
    } else {
      query = `
        SELECT
          v.rowid as id,
          v.distance as score,
          vm.text as content,
          vm.source_type,
          vm.source_id,
          vm.metadata
        FROM vectors v
        JOIN vector_metadata vm ON CAST(vm.id AS INTEGER) = v.rowid
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance
      `;
      params = [Buffer.from(embedding.buffer), limit];
    }

    const rows = this.db.prepare(query).all(...params) as VectorRow[];

    return rows.map((row) => ({
      id: String(row.id),
      score: 1 - row.score, // Convert distance to similarity
      content: row.content,
      sourceType: row.source_type,
      sourceId: row.source_id,
      metadata: safeJsonParse(row.metadata),
    }));
  }

  getById(id: string): VectorMetaRow | null {
    return (this.getMetaStmt.get(id) as VectorMetaRow) ?? null;
  }

  getBySource(sourceType: string, sourceId: string): VectorMetaRow | null {
    return (
      (this.getMetaBySourceStmt.get(sourceType, sourceId) as VectorMetaRow) ??
      null
    );
  }

  count(): number {
    // vec0 tables don't support COUNT(*) reliably, use metadata table
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM vector_metadata")
      .get() as { count: number };
    return row.count;
  }
}

interface VectorRow {
  id: number | string;
  score: number;
  content: string;
  source_type: string;
  source_id: string;
  metadata: string;
}

interface VectorMetaRow {
  id: string;
  source_type: string;
  source_id: string;
  text: string;
  metadata: string;
  created_at: number;
}

function safeJsonParse(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
