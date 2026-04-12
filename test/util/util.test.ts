import { describe, it, expect } from "vitest";
import { contentHash, stableJsonHash, taskFingerprint } from "../../src/util/hash.js";
import { newEpisodeId, newGraphId, newId } from "../../src/util/id.js";
import { estimateTokens, truncateToTokens } from "../../src/util/tokens.js";

describe("Utility Modules", () => {
  describe("Hash", () => {
    it("should produce consistent content hashes", () => {
      const hash1 = contentHash("hello world");
      const hash2 = contentHash("hello world");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it("should produce different hashes for different input", () => {
      const hash1 = contentHash("hello");
      const hash2 = contentHash("world");
      expect(hash1).not.toBe(hash2);
    });

    it("should produce stable JSON hashes", () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      expect(stableJsonHash(obj1)).toBe(stableJsonHash(obj2));
    });

    it("should produce 16-char task fingerprints", () => {
      const fp = taskFingerprint("Add error handling to the auth module");
      expect(fp).toHaveLength(16);

      // Should be case-insensitive and whitespace-normalized
      const fp2 = taskFingerprint("  Add  Error  Handling  To  The  Auth  Module  ");
      expect(fp).toBe(fp2);
    });
  });

  describe("ID", () => {
    it("should generate unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(newId());
      }
      expect(ids.size).toBe(100);
    });

    it("should generate branded IDs", () => {
      const episodeId = newEpisodeId();
      const graphId = newGraphId();
      expect(episodeId).toBeTruthy();
      expect(graphId).toBeTruthy();
      expect(episodeId).not.toBe(graphId);
    });
  });

  describe("Tokens", () => {
    it("should estimate token counts", () => {
      const tokens = estimateTokens("Hello, world!");
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it("should truncate text to token limit", () => {
      const longText = "a".repeat(1000);
      const truncated = truncateToTokens(longText, 50);
      expect(truncated.length).toBeLessThan(longText.length);
      expect(truncated).toContain("...[truncated]");
    });

    it("should not truncate short text", () => {
      const shortText = "Hello!";
      const result = truncateToTokens(shortText, 1000);
      expect(result).toBe(shortText);
    });
  });
});
