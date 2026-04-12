import { describe, it, expect } from "vitest";
import {
  classifyTier,
  shouldExternalize,
  createExternalizedPlaceholder,
  isExternalizedPlaceholder,
  extractRefId,
} from "../../src/context/tiers.js";

describe("Context Tiers", () => {
  const config = {
    recentTurns: 5,
    externalizeThreshold: 100,
    forkThreshold: 0.7,
    maxContextTokens: 100000,
  };

  it("should classify system messages as tier 0", () => {
    const tier = classifyTier(
      { role: "system", content: "System prompt" },
      0,
      10,
      config,
    );
    expect(tier).toBe(0);
  });

  it("should classify pinned entries as tier 0", () => {
    const tier = classifyTier(
      { role: "user", content: "Pinned", metadata: { pinned: true } },
      0,
      10,
      config,
    );
    expect(tier).toBe(0);
  });

  it("should classify recent entries as tier 1", () => {
    const tier = classifyTier(
      { role: "user", content: "Recent message" },
      8, // position 8 of 10 = within last 5
      10,
      config,
    );
    expect(tier).toBe(1);
  });

  it("should classify old entries as tier 3", () => {
    const tier = classifyTier(
      { role: "user", content: "Old message" },
      0, // position 0 of 20 = not recent
      20,
      config,
    );
    expect(tier).toBe(3);
  });

  it("should classify large tool results as tier 2", () => {
    const tier = classifyTier(
      { role: "tool", content: "x".repeat(200) },
      0,
      20,
      config,
    );
    expect(tier).toBe(2);
  });

  it("should detect externalization need", () => {
    expect(shouldExternalize("short", 100)).toBe(false);
    expect(shouldExternalize("x".repeat(200), 100)).toBe(true);
  });

  it("should create and detect externalized placeholders", () => {
    const placeholder = createExternalizedPlaceholder("ref-123", "Brief summary");
    expect(isExternalizedPlaceholder(placeholder)).toBe(true);
    expect(extractRefId(placeholder)).toBe("ref-123");
  });

  it("should not detect non-placeholders", () => {
    expect(isExternalizedPlaceholder("regular text")).toBe(false);
    expect(extractRefId("regular text")).toBeNull();
  });
});
