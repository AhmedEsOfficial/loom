import { describe, it, expect } from "vitest";
import { TrajectoryStore } from "../../src/conductor/trajectory.js";
import { createSubstrateToolDefs } from "../../src/conductor/tools.js";
import type { TrajectoryEntry } from "../../src/types/conductor.js";

describe("Conductor", () => {
  describe("TrajectoryStore", () => {
    it("should record and retrieve trajectory entries", () => {
      const store = new TrajectoryStore();

      const entry: TrajectoryEntry = {
        request: {
          messages: [{ role: "user", content: "Hello" }],
          model: "test-model",
        },
        response: {
          content: "Hi there",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: "end_turn",
          latency: 100,
          model: "test-model",
        },
        timestamp: Date.now(),
      };

      store.record(entry);
      expect(store.getAll()).toHaveLength(1);
    });

    it("should compute trajectory statistics", () => {
      const store = new TrajectoryStore();

      store.record({
        request: { messages: [], model: "m" },
        response: {
          content: "",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: "end_turn",
          latency: 200,
          model: "m",
        },
        timestamp: Date.now(),
      });

      store.record({
        request: { messages: [], model: "m" },
        response: {
          content: "",
          toolCalls: [],
          usage: { inputTokens: 200, outputTokens: 100 },
          stopReason: "end_turn",
          latency: 300,
          model: "m",
        },
        timestamp: Date.now(),
      });

      const stats = store.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.avgLatency).toBe(250);
    });

    it("should filter by graph ID", () => {
      const store = new TrajectoryStore();

      store.record({
        request: { messages: [], model: "m" },
        response: {
          content: "",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: "end_turn",
          latency: 100,
          model: "m",
        },
        graphId: "graph-1" as any,
        timestamp: Date.now(),
      });

      store.record({
        request: { messages: [], model: "m" },
        response: {
          content: "",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: "end_turn",
          latency: 100,
          model: "m",
        },
        graphId: "graph-2" as any,
        timestamp: Date.now(),
      });

      expect(store.getByGraph("graph-1" as any)).toHaveLength(1);
      expect(store.getAll()).toHaveLength(2);
    });

    it("should clear trajectory", () => {
      const store = new TrajectoryStore();
      store.record({
        request: { messages: [], model: "m" },
        response: {
          content: "",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "end_turn",
          latency: 0,
          model: "m",
        },
        timestamp: Date.now(),
      });

      store.clear();
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe("Tool Definitions", () => {
    it("should create standard substrate tool definitions", () => {
      const tools = createSubstrateToolDefs();
      expect(tools.length).toBeGreaterThan(0);

      const names = tools.map((t) => t.name);
      expect(names).toContain("substrate_search");
      expect(names).toContain("substrate_expand_symbol");
      expect(names).toContain("substrate_related_episodes");
      expect(names).toContain("map_query");
      expect(names).toContain("refetch");

      // Each tool should have valid schema
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    });
  });
});
