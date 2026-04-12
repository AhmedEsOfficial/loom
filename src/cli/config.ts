import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { LoomConfigSchema, type LoomConfig } from "../types/common.js";

const CONFIG_FILENAME = "config.json";

export function loadConfig(
  repoPath?: string,
  overrides?: Partial<LoomConfig>,
): LoomConfig {
  const cwd = repoPath ?? process.cwd();
  const dataDir = resolve(cwd, ".loom");
  const configPath = join(dataDir, CONFIG_FILENAME);

  let rawConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    rawConfig = JSON.parse(content);
  }

  // Merge with overrides
  const merged = {
    repoPath: cwd,
    dataDir,
    ...rawConfig,
    ...overrides,
  };

  // Apply env var defaults for providers
  if (!merged.providers) {
    merged.providers = detectProviders() as any;
  }

  if (!merged.modelRoles) {
    merged.modelRoles = defaultModelRoles(merged.providers as any) as any;
  }

  return LoomConfigSchema.parse(merged);
}

export function saveConfig(config: LoomConfig): void {
  const configPath = join(config.dataDir, CONFIG_FILENAME);
  const dir = config.dataDir;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Don't save repoPath and dataDir as they're derived
  const { repoPath, dataDir, ...saveable } = config;
  writeFileSync(configPath, JSON.stringify(saveable, null, 2));
}

function detectProviders(): { name: string; apiKey?: string; baseUrl?: string; models: Record<string, string> }[] {
  const providers: any[] = [];

  if (process.env["ANTHROPIC_API_KEY"]) {
    providers.push({
      name: "anthropic",
      models: {
        "claude-opus-4-20250514": "claude-opus-4-20250514",
        "claude-sonnet-4-20250514": "claude-sonnet-4-20250514",
        "claude-haiku-4-20250514": "claude-haiku-4-20250514",
      },
    });
  }

  if (process.env["OPENAI_API_KEY"]) {
    providers.push({
      name: "openai",
      models: {
        "gpt-4o": "gpt-4o",
        "gpt-4o-mini": "gpt-4o-mini",
        "text-embedding-3-small": "text-embedding-3-small",
      },
    });
  }

  if (process.env["OPENROUTER_API_KEY"]) {
    providers.push({
      name: "openrouter",
      models: {},
    });
  }

  if (providers.length === 0) {
    // Default to anthropic placeholder
    providers.push({
      name: "anthropic",
      models: {
        "claude-sonnet-4-20250514": "claude-sonnet-4-20250514",
      },
    });
  }

  return providers;
}

function defaultModelRoles(
  providers: { name: string }[],
): Record<string, string> {
  const hasAnthropic = providers.some((p) => p.name === "anthropic");
  const hasOpenAI = providers.some((p) => p.name === "openai");

  if (hasAnthropic) {
    return {
      planner: "claude-sonnet-4-20250514",
      worker: "claude-sonnet-4-20250514",
      critic: "claude-sonnet-4-20250514",
      compactor: "claude-haiku-4-20250514",
      cartographer: "claude-haiku-4-20250514",
    };
  }

  if (hasOpenAI) {
    return {
      planner: "gpt-4o",
      worker: "gpt-4o",
      critic: "gpt-4o",
      compactor: "gpt-4o-mini",
      cartographer: "gpt-4o-mini",
    };
  }

  return {
    planner: "claude-sonnet-4-20250514",
    worker: "claude-sonnet-4-20250514",
    critic: "claude-sonnet-4-20250514",
    compactor: "claude-haiku-4-20250514",
    cartographer: "claude-haiku-4-20250514",
  };
}
