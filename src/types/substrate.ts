import type { EpisodeId, GraphId, NodeId, SkillId } from "./common.js";

export interface Episode {
  id: EpisodeId;
  taskFingerprint: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  graphId?: GraphId;
  nodeId?: NodeId;
  tokenCount: number;
  createdAt: number; // Unix ms
}

export type EpisodeInsert = Omit<Episode, "id" | "createdAt">;

export interface VectorEntry {
  id: string;
  sourceType: "episode" | "map_node" | "skill" | "graph_template";
  sourceId: string;
  embedding: Float32Array;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export type VectorInsert = Omit<VectorEntry, "id" | "createdAt">;

export interface SubstrateSearchOptions {
  limit?: number;
  sourceType?: VectorEntry["sourceType"];
  after?: number; // Unix ms
  before?: number;
}

export interface SubstrateResult {
  id: string;
  score: number;
  content: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown>;
}

export interface FtsResult {
  id: string;
  rank: number;
  content: string;
  toolName?: string;
  toolOutput?: string;
  highlight?: string;
}

export interface SkillEntry {
  id: SkillId;
  name: string;
  description: string;
  content: string;
  tags: string[];
  usageCount: number;
  lastUsedAt?: number;
  createdAt: number;
}

export type SkillInsert = Omit<SkillEntry, "id" | "usageCount" | "lastUsedAt" | "createdAt">;

// The tool surface exposed to models — these are the ONLY way
// models interact with persistent state
export interface SubstrateTools {
  /** Full-text search over episodes */
  search(query: string, opts?: SubstrateSearchOptions): Promise<FtsResult[]>;

  /** Vector similarity search */
  vectorSearch(
    embedding: Float32Array,
    opts?: SubstrateSearchOptions,
  ): Promise<SubstrateResult[]>;

  /** Get symbol detail from the AST index */
  expandSymbol(
    symbolName: string,
    filePath?: string,
  ): Promise<SymbolDetail | null>;

  /** Find episodes related to a task fingerprint */
  relatedEpisodes(
    taskFingerprint: string,
    limit?: number,
  ): Promise<Episode[]>;

  /** Find matching skills */
  skillLookup(description: string): Promise<SkillEntry[]>;

  /** Store a new episode */
  storeEpisode(episode: EpisodeInsert): Promise<EpisodeId>;

  /** Store a vector embedding */
  storeVector(entry: VectorInsert): Promise<string>;

  /** Retrieve content by substrate ref (for refetching externalized content) */
  refetch(substrateRef: string): Promise<string | null>;

  /** Store a skill */
  storeSkill(skill: SkillInsert): Promise<SkillId>;
}

export interface SymbolDetail {
  name: string;
  kind:
    | "function"
    | "class"
    | "interface"
    | "type"
    | "variable"
    | "enum"
    | "method"
    | "struct"
    | "trait";
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  docstring?: string;
  callers: string[];
  callees: string[];
  imports: string[];
}
