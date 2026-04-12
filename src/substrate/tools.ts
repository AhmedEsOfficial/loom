import type Database from "better-sqlite3";
import type { EpisodeId, SkillId } from "../types/common.js";
import type {
  Episode,
  EpisodeInsert,
  FtsResult,
  SkillEntry,
  SkillInsert,
  SubstrateResult,
  SubstrateSearchOptions,
  SubstrateTools,
  SymbolDetail,
  VectorInsert,
} from "../types/substrate.js";
import { newSkillId } from "../util/id.js";
import { EpisodeStore } from "./episodes.js";
import { FtsSearch } from "./fts.js";
import { VectorStore } from "./vectors.js";

/**
 * SubstrateToolsImpl is the facade that models interact with.
 * It orchestrates episodes, FTS, vectors, and the codebase map.
 */
export class SubstrateToolsImpl implements SubstrateTools {
  readonly episodes: EpisodeStore;
  readonly fts: FtsSearch;
  readonly vectors: VectorStore;

  constructor(
    private db: Database.Database,
    dimensions: number = 1536,
  ) {
    this.episodes = new EpisodeStore(db);
    this.fts = new FtsSearch(db);
    this.vectors = new VectorStore(db, dimensions);
  }

  async search(
    query: string,
    opts?: SubstrateSearchOptions,
  ): Promise<FtsResult[]> {
    return this.fts.searchEpisodes(query, opts?.limit ?? 20);
  }

  async vectorSearch(
    embedding: Float32Array,
    opts?: SubstrateSearchOptions,
  ): Promise<SubstrateResult[]> {
    return this.vectors.search(
      embedding,
      opts?.limit ?? 10,
      opts?.sourceType,
    );
  }

  async expandSymbol(
    symbolName: string,
    filePath?: string,
  ): Promise<SymbolDetail | null> {
    let query: string;
    let params: unknown[];

    if (filePath) {
      query =
        "SELECT * FROM symbols WHERE name = ? AND file_path = ? LIMIT 1";
      params = [symbolName, filePath];
    } else {
      query = "SELECT * FROM symbols WHERE name = ? LIMIT 1";
      params = [symbolName];
    }

    const symbol = this.db.prepare(query).get(...params) as
      | SymbolRow
      | undefined;
    if (!symbol) return null;

    // Get callers
    const callers = this.db
      .prepare(
        `SELECT s.file_path || ':' || s.name as caller
         FROM symbol_edges se
         JOIN symbols s ON s.id = se.source_id
         WHERE se.target_id = ? AND se.edge_type = 'calls'`,
      )
      .all(symbol.id)
      .map((r: any) => r.caller as string);

    // Get callees
    const callees = this.db
      .prepare(
        `SELECT s.file_path || ':' || s.name as callee
         FROM symbol_edges se
         JOIN symbols s ON s.id = se.target_id
         WHERE se.source_id = ? AND se.edge_type = 'calls'`,
      )
      .all(symbol.id)
      .map((r: any) => r.callee as string);

    // Get imports
    const imports = this.db
      .prepare(
        `SELECT s.file_path || ':' || s.name as import
         FROM symbol_edges se
         JOIN symbols s ON s.id = se.target_id
         WHERE se.source_id = ? AND se.edge_type = 'imports'`,
      )
      .all(symbol.id)
      .map((r: any) => r.import as string);

    return {
      name: symbol.name,
      kind: symbol.kind as SymbolDetail["kind"],
      filePath: symbol.file_path,
      startLine: symbol.start_line,
      endLine: symbol.end_line,
      signature: symbol.signature,
      docstring: symbol.docstring || undefined,
      callers,
      callees,
      imports,
    };
  }

  async relatedEpisodes(
    taskFingerprint: string,
    limit = 10,
  ): Promise<Episode[]> {
    return this.episodes.getByTask(taskFingerprint, limit);
  }

  async skillLookup(description: string): Promise<SkillEntry[]> {
    const ftsResults = this.fts.searchSkills(description, 10);
    return ftsResults.map((row) => ({
      id: row.id as SkillId,
      name: row.name,
      description: row.description,
      content: row.content,
      tags: safeJsonParse(row.highlight ?? "[]"),
      usageCount: 0,
      createdAt: 0,
    }));
  }

  async storeEpisode(episode: EpisodeInsert): Promise<EpisodeId> {
    return this.episodes.insert(episode);
  }

  async storeVector(entry: VectorInsert): Promise<string> {
    return this.vectors.insert(entry);
  }

  async refetch(substrateRef: string): Promise<string | null> {
    // Check externalized table first
    const ext = this.db
      .prepare("SELECT original_content FROM externalized WHERE id = ?")
      .get(substrateRef) as { original_content: string } | undefined;
    if (ext) return ext.original_content;

    // Check episodes
    const episode = this.db
      .prepare("SELECT content FROM episodes WHERE id = ?")
      .get(substrateRef) as { content: string } | undefined;
    if (episode) return episode.content;

    return null;
  }

  async storeSkill(skill: SkillInsert): Promise<SkillId> {
    const id = newSkillId();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO skills (id, name, description, content, tags, usage_count, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(id, skill.name, skill.description, skill.content, JSON.stringify(skill.tags), now);

    return id;
  }

  /** Store externalized content (used by context engine) */
  storeExternalized(
    id: string,
    content: string,
    summary: string,
    tokenCount: number,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO externalized (id, original_content, summary, token_count, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, content, summary, tokenCount, Date.now());
  }
}

interface SymbolRow {
  id: string;
  map_node_id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature: string;
  docstring: string;
}

function safeJsonParse(json: string): string[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
