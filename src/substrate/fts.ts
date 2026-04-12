import type Database from "better-sqlite3";
import type { FtsResult } from "../types/substrate.js";

export class FtsSearch {
  private searchEpisodesStmt: Database.Statement;
  private searchSkillsStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.searchEpisodesStmt = db.prepare(`
      SELECT
        e.id,
        episodes_fts.rank,
        e.content,
        e.tool_name,
        e.tool_output,
        highlight(episodes_fts, 0, '<mark>', '</mark>') as highlight
      FROM episodes_fts
      JOIN episodes e ON e.rowid = episodes_fts.rowid
      WHERE episodes_fts MATCH ?
      ORDER BY episodes_fts.rank
      LIMIT ?
    `);

    this.searchSkillsStmt = db.prepare(`
      SELECT
        s.id,
        skills_fts.rank,
        s.name,
        s.description,
        s.content,
        highlight(skills_fts, 1, '<mark>', '</mark>') as highlight
      FROM skills_fts
      JOIN skills s ON s.rowid = skills_fts.rowid
      WHERE skills_fts MATCH ?
      ORDER BY skills_fts.rank
      LIMIT ?
    `);
  }

  searchEpisodes(query: string, limit = 20): FtsResult[] {
    const safeQuery = sanitizeFtsQuery(query);
    if (!safeQuery) return [];

    const rows = this.searchEpisodesStmt.all(safeQuery, limit) as FtsEpisodeRow[];
    return rows.map((row) => ({
      id: row.id,
      rank: row.rank,
      content: row.content,
      toolName: row.tool_name ?? undefined,
      toolOutput: row.tool_output ?? undefined,
      highlight: row.highlight ?? undefined,
    }));
  }

  searchSkills(query: string, limit = 10): FtsSkillRow[] {
    const safeQuery = sanitizeFtsQuery(query);
    if (!safeQuery) return [];

    return this.searchSkillsStmt.all(safeQuery, limit) as FtsSkillRow[];
  }
}

interface FtsEpisodeRow {
  id: string;
  rank: number;
  content: string;
  tool_name: string | null;
  tool_output: string | null;
  highlight: string | null;
}

export interface FtsSkillRow {
  id: string;
  rank: number;
  name: string;
  description: string;
  content: string;
  highlight: string | null;
}

/**
 * Sanitize FTS5 query to prevent syntax errors.
 * Wraps each word in quotes to treat them as literals,
 * avoiding issues with special characters.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";

  // Split into words, wrap each in quotes for literal matching
  const words = trimmed
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, '""')}"`);

  return words.join(" ");
}
