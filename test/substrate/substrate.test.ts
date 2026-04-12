import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, closeDatabase } from "../../src/substrate/db.js";
import { EpisodeStore } from "../../src/substrate/episodes.js";
import { FtsSearch } from "../../src/substrate/fts.js";
import { VectorStore } from "../../src/substrate/vectors.js";
import { SubstrateToolsImpl } from "../../src/substrate/tools.js";
import type Database from "better-sqlite3";
import type { EpisodeInsert } from "../../src/types/substrate.js";

describe("Substrate", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ dataDir: "", inMemory: true, embeddingDimensions: 4 });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe("EpisodeStore", () => {
    it("should insert and retrieve episodes", () => {
      const store = new EpisodeStore(db);

      const episode: EpisodeInsert = {
        taskFingerprint: "test-task-123",
        role: "user",
        content: "Hello, this is a test episode",
        tokenCount: 10,
      };

      const id = store.insert(episode);
      expect(id).toBeTruthy();

      const retrieved = store.getById(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe("Hello, this is a test episode");
      expect(retrieved!.taskFingerprint).toBe("test-task-123");
      expect(retrieved!.role).toBe("user");
    });

    it("should retrieve episodes by task fingerprint", () => {
      const store = new EpisodeStore(db);

      store.insert({
        taskFingerprint: "fp-1",
        role: "user",
        content: "First episode",
        tokenCount: 5,
      });
      store.insert({
        taskFingerprint: "fp-1",
        role: "assistant",
        content: "Second episode",
        tokenCount: 5,
      });
      store.insert({
        taskFingerprint: "fp-2",
        role: "user",
        content: "Different task",
        tokenCount: 5,
      });

      const results = store.getByTask("fp-1");
      expect(results).toHaveLength(2);
    });

    it("should count episodes", () => {
      const store = new EpisodeStore(db);
      expect(store.count()).toBe(0);

      store.insert({
        taskFingerprint: "fp",
        role: "user",
        content: "test",
        tokenCount: 1,
      });
      expect(store.count()).toBe(1);
    });

    it("should retrieve recent episodes in descending order", () => {
      const store = new EpisodeStore(db);

      store.insert({ taskFingerprint: "fp", role: "user", content: "first", tokenCount: 1 });
      store.insert({ taskFingerprint: "fp", role: "user", content: "second", tokenCount: 1 });
      store.insert({ taskFingerprint: "fp", role: "user", content: "third", tokenCount: 1 });

      const recent = store.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]!.content).toBe("third");
    });
  });

  describe("FtsSearch", () => {
    it("should find episodes by full-text search", () => {
      const episodes = new EpisodeStore(db);
      const fts = new FtsSearch(db);

      episodes.insert({
        taskFingerprint: "fp",
        role: "assistant",
        content: "The authentication middleware handles JWT token validation",
        tokenCount: 10,
      });
      episodes.insert({
        taskFingerprint: "fp",
        role: "assistant",
        content: "Database connection pooling is configured in config.ts",
        tokenCount: 10,
      });

      const results = fts.searchEpisodes("authentication JWT");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.content).toContain("authentication");
    });

    it("should return empty for no matches", () => {
      const fts = new FtsSearch(db);
      const results = fts.searchEpisodes("nonexistent query xyzzy");
      expect(results).toHaveLength(0);
    });

    it("should handle empty queries", () => {
      const fts = new FtsSearch(db);
      const results = fts.searchEpisodes("");
      expect(results).toHaveLength(0);
    });
  });

  describe("VectorStore", () => {
    it("should insert and search vectors", () => {
      const store = new VectorStore(db, 4);

      // Insert a vector
      const id = store.insert({
        sourceType: "episode",
        sourceId: "ep-1",
        embedding: new Float32Array([1.0, 0.0, 0.0, 0.0]),
        text: "Test vector entry",
        metadata: { key: "value" },
      });

      expect(id).toBeTruthy();

      // Search with a similar vector
      const results = store.search(
        new Float32Array([1.0, 0.1, 0.0, 0.0]),
        5,
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.content).toBe("Test vector entry");
    });

    it("should count vectors", () => {
      const store = new VectorStore(db, 4);
      expect(store.count()).toBe(0);

      store.insert({
        sourceType: "episode",
        sourceId: "ep-1",
        embedding: new Float32Array([1, 0, 0, 0]),
        text: "test",
        metadata: {},
      });
      expect(store.count()).toBe(1);
    });
  });

  describe("SubstrateToolsImpl", () => {
    it("should provide a unified search interface", async () => {
      const tools = new SubstrateToolsImpl(db, 4);

      await tools.storeEpisode({
        taskFingerprint: "fp",
        role: "assistant",
        content: "Refactored the user authentication module",
        tokenCount: 10,
      });

      const results = await tools.search("authentication");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should store and retrieve skills", async () => {
      const tools = new SubstrateToolsImpl(db, 4);

      const id = await tools.storeSkill({
        name: "code-review",
        description: "Review code for quality and best practices",
        content: "## Code Review\nCheck for...",
        tags: ["review", "quality"],
      });

      expect(id).toBeTruthy();
    });

    it("should store and refetch externalized content", async () => {
      const tools = new SubstrateToolsImpl(db, 4);

      tools.storeExternalized(
        "ext-1",
        "This is the full original content that was externalized",
        "Brief summary",
        50,
      );

      const content = await tools.refetch("ext-1");
      expect(content).toBe("This is the full original content that was externalized");
    });

    it("should return null for unknown refetch IDs", async () => {
      const tools = new SubstrateToolsImpl(db, 4);
      const content = await tools.refetch("nonexistent");
      expect(content).toBeNull();
    });
  });
});
