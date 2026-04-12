import type { SubstrateToolsImpl } from "../substrate/tools.js";
import type { Conductor } from "../types/conductor.js";
import type {
  CompactionResult,
  ContextEntry,
  ContextManager,
  ContextStats,
  ContextTier,
  ExternalizedRef,
  HandoffBrief,
} from "../types/context.js";
import { newId } from "../util/id.js";
import { createLogger } from "../util/logger.js";
import { estimateTokens } from "../util/tokens.js";
import { Compactor } from "./compactor.js";
import { Externalizer } from "./externalizer.js";
import { HandoffGenerator } from "./handoff.js";
import {
  classifyTier,
  createExternalizedPlaceholder,
  type TierConfig,
} from "./tiers.js";

const log = createLogger("context");

export interface ContextManagerConfig {
  recentTurns: number;
  externalizeThreshold: number;
  forkThreshold: number;
  compactionInterval: number;
  maxContextTokens: number;
}

export class ContextManagerImpl implements ContextManager {
  private entries: ContextEntry[] = [];
  private turnsSinceCompaction = 0;
  private compactionCount = 0;
  private externalizedCount = 0;

  private externalizer: Externalizer;
  private compactor: Compactor;
  private handoffGenerator: HandoffGenerator;

  constructor(
    substrate: SubstrateToolsImpl,
    conductor: Conductor,
    private config: ContextManagerConfig,
  ) {
    this.externalizer = new Externalizer(
      substrate,
      config.externalizeThreshold,
    );
    this.compactor = new Compactor(
      conductor,
      conductor.resolveModel("compactor"),
    );
    this.handoffGenerator = new HandoffGenerator(
      conductor,
      conductor.resolveModel("compactor"),
    );
  }

  async addEntry(entry: {
    role: ContextEntry["role"];
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ContextEntry> {
    const tokenCount = estimateTokens(entry.content);
    let content = entry.content;
    let substrateRef: string | undefined;
    let originalTokenCount: number | undefined;

    // Auto-externalize large tool results
    if (entry.role === "tool") {
      const ref = this.externalizer.externalize(content);
      if (ref) {
        substrateRef = ref.substrateId;
        originalTokenCount = ref.originalTokenCount;
        content = createExternalizedPlaceholder(ref.id, ref.summary);
        this.externalizedCount++;
      }
    }

    const contextEntry: ContextEntry = {
      id: newId(),
      tier: 1, // Default to recent, will be reclassified
      role: entry.role,
      content,
      tokenCount: estimateTokens(content),
      substrateRef,
      originalTokenCount,
      metadata: entry.metadata,
      createdAt: Date.now(),
    };

    this.entries.push(contextEntry);
    this.turnsSinceCompaction++;

    // Reclassify all tiers
    this.reclassifyTiers();

    // Auto-compact if interval reached
    if (this.turnsSinceCompaction >= this.config.compactionInterval) {
      await this.compact();
    }

    return contextEntry;
  }

  async externalize(entryId: string): Promise<ExternalizedRef> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) {
      throw new Error(`Entry not found: ${entryId}`);
    }

    const ref = this.externalizer.externalize(entry.content);
    if (!ref) {
      // Content is small — externalize anyway if forced
      const id = newId();
      this.externalizedCount++;
      return {
        id,
        summary: entry.content.slice(0, 100),
        substrateId: id,
        originalTokenCount: entry.tokenCount,
      };
    }

    entry.substrateRef = ref.substrateId;
    entry.originalTokenCount = entry.tokenCount;
    entry.content = createExternalizedPlaceholder(ref.id, ref.summary);
    entry.tokenCount = estimateTokens(entry.content);
    entry.tier = 2;
    this.externalizedCount++;

    return ref;
  }

  getContext(maxTokens?: number): ContextEntry[] {
    const limit = maxTokens ?? this.config.maxContextTokens;
    let tokenBudget = limit;
    const result: ContextEntry[] = [];

    // Tier 0 first (pinned — always included)
    for (const entry of this.entries) {
      if (entry.tier === 0) {
        result.push(entry);
        tokenBudget -= entry.tokenCount;
      }
    }

    // Tier 1 next (recent)
    for (const entry of this.entries) {
      if (entry.tier === 1 && tokenBudget > 0) {
        result.push(entry);
        tokenBudget -= entry.tokenCount;
      }
    }

    // Tier 2 (externalized summaries) if budget allows
    for (const entry of this.entries) {
      if (entry.tier === 2 && tokenBudget > 0) {
        result.push(entry);
        tokenBudget -= entry.tokenCount;
      }
    }

    // Tier 3 (compacted summaries) if budget allows
    for (const entry of this.entries) {
      if (entry.tier === 3 && tokenBudget > 0) {
        result.push(entry);
        tokenBudget -= entry.tokenCount;
      }
    }

    // Sort by creation time to maintain conversation order
    result.sort((a, b) => a.createdAt - b.createdAt);

    return result;
  }

  async compact(): Promise<CompactionResult> {
    // Find tier 3 entries that haven't been compacted yet
    const compactable = this.entries.filter(
      (e) => e.tier === 3 && !e.metadata?.compacted,
    );

    if (compactable.length < 3) {
      return {
        removedEntries: 0,
        compactedTokens: 0,
        newTokenCount: 0,
        summary: "",
      };
    }

    const result = await this.compactor.compact(compactable);

    if (result.summary) {
      // Replace compacted entries with summary
      const compactedIds = new Set(compactable.map((e) => e.id));
      this.entries = this.entries.filter((e) => !compactedIds.has(e.id));

      // Add compaction summary as a new entry
      this.entries.push({
        id: newId(),
        tier: 3,
        role: "system",
        content: `[Compacted context summary]\n${result.summary}`,
        tokenCount: estimateTokens(result.summary),
        metadata: { compacted: true },
        createdAt: Date.now(),
      });

      this.compactionCount++;
    }

    this.turnsSinceCompaction = 0;

    log.info(
      {
        removedEntries: result.removedEntries,
        compactedTokens: result.compactedTokens,
        newTokenCount: result.newTokenCount,
      },
      "Compaction complete",
    );

    return result;
  }

  shouldFork(): boolean {
    const totalTokens = this.getTotalTokens();
    return totalTokens >= this.config.maxContextTokens * this.config.forkThreshold;
  }

  async generateHandoff(): Promise<HandoffBrief> {
    const substrateRefs = this.entries
      .filter((e) => e.substrateRef)
      .map((e) => e.substrateRef!);

    return this.handoffGenerator.generate(this.entries, substrateRefs);
  }

  getTotalTokens(): number {
    return this.entries.reduce((sum, e) => sum + e.tokenCount, 0);
  }

  async refetch(substrateRef: string): Promise<string | null> {
    return this.externalizer.refetch(substrateRef);
  }

  getStats(): ContextStats {
    const tierCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 } as Record<ContextTier, number>;
    const tierTokens = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 } as Record<ContextTier, number>;

    for (const entry of this.entries) {
      tierCounts[entry.tier]++;
      tierTokens[entry.tier] += entry.tokenCount;
    }

    return {
      totalTokens: this.getTotalTokens(),
      tierCounts,
      tierTokens,
      externalizedCount: this.externalizedCount,
      compactionCount: this.compactionCount,
    };
  }

  pin(entryId: string): void {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.tier = 0;
      entry.metadata = { ...entry.metadata, pinned: true };
    }
  }

  clear(): void {
    this.entries = [];
    this.turnsSinceCompaction = 0;
  }

  private reclassifyTiers(): void {
    const tierConfig: TierConfig = {
      recentTurns: this.config.recentTurns,
      externalizeThreshold: this.config.externalizeThreshold,
      forkThreshold: this.config.forkThreshold,
      maxContextTokens: this.config.maxContextTokens,
    };

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;

      // Don't reclassify pinned or already-compacted entries
      if (entry.metadata?.pinned || entry.metadata?.compacted) continue;

      // Don't downgrade externalized entries
      if (entry.tier === 2 && entry.substrateRef) continue;

      entry.tier = classifyTier(
        entry,
        i,
        this.entries.length,
        tierConfig,
      );
    }
  }
}
