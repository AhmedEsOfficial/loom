import type { GraphId } from "../types/common.js";
import type { TrajectoryEntry } from "../types/conductor.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("conductor");

export class TrajectoryStore {
  private entries: TrajectoryEntry[] = [];

  record(entry: TrajectoryEntry): void {
    this.entries.push(entry);
    log.debug(
      {
        model: entry.response.model,
        graphId: entry.graphId,
        nodeId: entry.nodeId,
        inputTokens: entry.response.usage.inputTokens,
        outputTokens: entry.response.usage.outputTokens,
      },
      "Trajectory recorded",
    );
  }

  getAll(): TrajectoryEntry[] {
    return [...this.entries];
  }

  getByGraph(graphId: GraphId): TrajectoryEntry[] {
    return this.entries.filter((e) => e.graphId === graphId);
  }

  clear(): void {
    this.entries = [];
  }

  /** Summary statistics for the current trajectory */
  getStats(): TrajectoryStats {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalLatency = 0;
    let totalCacheHits = 0;

    for (const entry of this.entries) {
      totalInputTokens += entry.response.usage.inputTokens;
      totalOutputTokens += entry.response.usage.outputTokens;
      totalLatency += entry.response.latency;
      totalCacheHits += entry.response.usage.cacheHits ?? 0;
    }

    return {
      totalCalls: this.entries.length,
      totalInputTokens,
      totalOutputTokens,
      totalLatency,
      totalCacheHits,
      avgLatency:
        this.entries.length > 0
          ? totalLatency / this.entries.length
          : 0,
    };
  }
}

export interface TrajectoryStats {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatency: number;
  totalCacheHits: number;
  avgLatency: number;
}
