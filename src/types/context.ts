export type ContextTier = 0 | 1 | 2 | 3 | 4;

export interface ContextEntry {
  id: string;
  tier: ContextTier;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount: number;
  substrateRef?: string; // For tier 2+ externalized content
  originalTokenCount?: number; // Pre-compaction size
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface ExternalizedRef {
  id: string;
  summary: string; // One-line summary replacing inline content
  substrateId: string; // Pointer to substrate for re-fetch
  originalTokenCount: number;
}

export interface HandoffBrief {
  task: string;
  progress: string;
  decisions: string[];
  openQuestions: string[];
  activeFiles: string[];
  substratePointers: string[];
  nextSteps: string[];
}

export interface CompactionResult {
  removedEntries: number;
  compactedTokens: number;
  newTokenCount: number;
  summary: string;
}

export interface ContextStats {
  totalTokens: number;
  tierCounts: Record<ContextTier, number>;
  tierTokens: Record<ContextTier, number>;
  externalizedCount: number;
  compactionCount: number;
}

export interface ContextManager {
  /** Add a new entry to the context — auto-classifies tier and may externalize */
  addEntry(entry: {
    role: ContextEntry["role"];
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ContextEntry>;

  /** Externalize a specific entry to substrate */
  externalize(entryId: string): Promise<ExternalizedRef>;

  /** Get assembled context messages up to maxTokens */
  getContext(maxTokens?: number): ContextEntry[];

  /** Run incremental compaction on older entries */
  compact(): Promise<CompactionResult>;

  /** Check if we should fork (>= forkThreshold of max context) */
  shouldFork(): boolean;

  /** Generate a handoff brief for forking */
  generateHandoff(): Promise<HandoffBrief>;

  /** Get current token total */
  getTotalTokens(): number;

  /** Re-fetch externalized content from substrate */
  refetch(substrateRef: string): Promise<string | null>;

  /** Get context statistics */
  getStats(): ContextStats;

  /** Pin an entry (tier 0 — never compressed) */
  pin(entryId: string): void;

  /** Clear all context (for fork/reset) */
  clear(): void;
}
