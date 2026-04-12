import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { createLogger } from "../util/logger.js";

const log = createLogger("substrate");

export interface DatabaseOptions {
  dataDir: string;
  inMemory?: boolean;
  embeddingDimensions?: number;
}

export function initDatabase(opts: DatabaseOptions): Database.Database {
  let dbPath: string;

  if (opts.inMemory) {
    dbPath = ":memory:";
  } else {
    const dir = resolve(opts.dataDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    dbPath = join(dir, "loom.db");
  }

  log.info({ dbPath }, "Initializing database");

  const db = new Database(dbPath);

  // Performance settings
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -64000"); // 64MB cache
  db.pragma("busy_timeout = 5000");

  // Load sqlite-vec extension
  sqliteVec.load(db);
  log.info("sqlite-vec extension loaded");

  // Run migrations
  runMigrations(db, opts.embeddingDimensions ?? 1536);

  return db;
}

function runMigrations(db: Database.Database, embeddingDimensions: number): void {
  // Ensure schema_version table exists for tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_version")
      .all()
      .map((row: any) => row.version as number),
  );

  // Find migration files
  const migrationsDir = findMigrationsDir();
  if (!migrationsDir) {
    log.warn("Migrations directory not found, skipping migrations");
    return;
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const version = parseInt(match[1]!, 10);

    if (applied.has(version)) continue;

    log.info({ version, file }, "Applying migration");
    const sql = readFileSync(join(migrationsDir, file), "utf-8");

    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(version, Date.now());
    })();
  }

  // Create vec0 virtual table for vectors (must be done programmatically)
  // Check if it exists first
  const vecTableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'",
    )
    .get();

  if (!vecTableExists) {
    db.exec(
      `CREATE VIRTUAL TABLE vectors USING vec0(
        embedding float[${embeddingDimensions}]
      )`,
    );
    log.info({ dimensions: embeddingDimensions }, "Created vectors table");
  }

  log.info("Migrations complete");
}

function findMigrationsDir(): string | null {
  // Look relative to this file, then relative to CWD
  const candidates = [
    join(import.meta.dirname ?? "", "../../migrations"),
    join(process.cwd(), "migrations"),
  ];

  for (const dir of candidates) {
    const resolved = resolve(dir);
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

export function closeDatabase(db: Database.Database): void {
  db.close();
  log.info("Database closed");
}
