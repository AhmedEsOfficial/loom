-- Loom Harness: Initial Schema
-- Episodes, vectors, codebase map, symbols, skills, graph templates

-- Episodic log
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  task_fingerprint TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  graph_id TEXT,
  node_id TEXT,
  token_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task_fingerprint, created_at);
CREATE INDEX IF NOT EXISTS idx_episodes_graph ON episodes(graph_id, node_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at);

-- FTS5 virtual table for full-text search over episodes
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
  content,
  tool_name,
  tool_output,
  content=episodes,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS episodes_fts_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episodes_fts(rowid, content, tool_name, tool_output)
  VALUES (new.rowid, new.content, new.tool_name, new.tool_output);
END;

CREATE TRIGGER IF NOT EXISTS episodes_fts_ad AFTER DELETE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, content, tool_name, tool_output)
  VALUES ('delete', old.rowid, old.content, old.tool_name, old.tool_output);
END;

CREATE TRIGGER IF NOT EXISTS episodes_fts_au AFTER UPDATE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, content, tool_name, tool_output)
  VALUES ('delete', old.rowid, old.content, old.tool_name, old.tool_output);
  INSERT INTO episodes_fts(rowid, content, tool_name, tool_output)
  VALUES (new.rowid, new.content, new.tool_name, new.tool_output);
END;

-- Vector metadata (sqlite-vec vec0 tables are created programmatically)
CREATE TABLE IF NOT EXISTS vector_metadata (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('episode', 'map_node', 'skill', 'graph_template')),
  source_id TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata TEXT, -- JSON
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vector_meta_source ON vector_metadata(source_type, source_id);

-- Codebase map nodes
CREATE TABLE IF NOT EXISTS map_nodes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  path TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('file', 'module', 'package', 'repo')),
  parent_id TEXT REFERENCES map_nodes(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  public_api TEXT DEFAULT '[]', -- JSON array
  complexity_score REAL NOT NULL DEFAULT 0,
  exemplar_callers TEXT DEFAULT '[]', -- JSON array
  language TEXT DEFAULT '',
  loc INTEGER DEFAULT 0,
  git_sha TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_map_nodes_repo ON map_nodes(repo_id, level);
CREATE INDEX IF NOT EXISTS idx_map_nodes_path ON map_nodes(path);
CREATE INDEX IF NOT EXISTS idx_map_nodes_parent ON map_nodes(parent_id);

-- Symbol index (from tree-sitter)
CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  map_node_id TEXT NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT DEFAULT '',
  docstring TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_node ON symbols(map_node_id);

-- Symbol edges (calls, imports, extends, implements)
CREATE TABLE IF NOT EXISTS symbol_edges (
  source_id TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('calls', 'imports', 'extends', 'implements')),
  PRIMARY KEY (source_id, target_id, edge_type)
);

-- Skills
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT DEFAULT '[]', -- JSON array
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
  name,
  description,
  content,
  content=skills,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS skills_fts_ai AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts(rowid, name, description, content)
  VALUES (new.rowid, new.name, new.description, new.content);
END;

CREATE TRIGGER IF NOT EXISTS skills_fts_ad AFTER DELETE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, name, description, content)
  VALUES ('delete', old.rowid, old.name, old.description, old.content);
END;

-- Graph templates
CREATE TABLE IF NOT EXISTS graph_templates (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  task_pattern TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_duration INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_graph_templates_hash ON graph_templates(content_hash);
CREATE INDEX IF NOT EXISTS idx_graph_templates_pattern ON graph_templates(task_pattern);

-- Graph execution log
CREATE TABLE IF NOT EXISTS graph_executions (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
  results_json TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  total_tokens_in INTEGER DEFAULT 0,
  total_tokens_out INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_graph_exec_graph ON graph_executions(graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_exec_status ON graph_executions(status);

-- Externalized content (for context engine tier 2+)
CREATE TABLE IF NOT EXISTS externalized (
  id TEXT PRIMARY KEY,
  original_content TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, unixepoch() * 1000);
