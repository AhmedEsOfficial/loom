import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { LoomConfigSchema, type LoomConfig } from "../types/common.js";
import { detectLocalBackend } from "../conductor/local.js";

const CONFIG_FILENAME = "config.json";

export async function loadConfig(
  repoPath?: string,
  overrides?: Partial<LoomConfig>,
): Promise<LoomConfig> {
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
    merged.providers = await detectProviders() as any;
  }

  if (!merged.modelRoles) {
    merged.modelRoles = defaultModelRoles(merged.providers as any) as any;
  }

  // Auto-configure embedding based on available providers
  if (!merged.embedding) {
    const providers = merged.providers as any[];
    const hasOpenAI = providers.some((p: any) => p.name === "openai");
    const hasLocal = providers.some((p: any) => p.name === "local");

    if (hasOpenAI) {
      merged.embedding = { dimensions: 1536, model: "text-embedding-3-small", provider: "openai" };
    } else if (hasLocal) {
      // Ollama with nomic-embed-text uses 768 dimensions
      merged.embedding = { dimensions: 768, model: "nomic-embed-text", provider: "local" };
    }
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

async function detectProviders(): Promise<{ name: string; apiKey?: string; baseUrl?: string; models: Record<string, string> }[]> {
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

  // Auto-detect local model servers (Ollama, LM Studio, llama-server, vLLM)
  const local = await detectLocalBackend();
  if (local) {
    const models: Record<string, string> = {};
    for (const m of local.models) {
      models[m] = m;
    }
    providers.push({
      name: "local",
      baseUrl: local.baseUrl,
      models,
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
  providers: { name: string; models?: Record<string, string> }[],
): Record<string, string> {
  const hasAnthropic = providers.some((p) => p.name === "anthropic");
  const hasOpenAI = providers.some((p) => p.name === "openai");
  const localProvider = providers.find((p) => p.name === "local");

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

  // If only local models are available, pick the best available one
  if (localProvider?.models) {
    const models = Object.keys(localProvider.models);
    // Prefer larger models for planner/worker/critic roles
    const bestModel = pickBestLocalModel(models);
    const cheapModel = pickCheapLocalModel(models) ?? bestModel;
    return {
      planner: bestModel,
      worker: bestModel,
      critic: bestModel,
      compactor: cheapModel,
      cartographer: cheapModel,
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

function pickBestLocalModel(models: string[]): string {
  // Prefer coding models, then larger general models
  const preferences = [
    /coder/i, /qwen.*:14b/i, /qwen.*:9b/i, /qwen.*:7b/i, /gemma.*:9b/i,
    /llama.*:13b/i, /llama.*:7b/i, /gemma/i, /qwen/i, /llama/i,
  ];

  for (const pref of preferences) {
    const match = models.find((m) => pref.test(m) && !m.includes("embed"));
    if (match) return match;
  }

  // Fallback: first non-embedding model
  return models.find((m) => !m.includes("embed")) ?? models[0] ?? "default";
}

function pickCheapLocalModel(models: string[]): string | null {
  // Prefer smaller models for cheap tasks
  const cheap = models.find(
    (m) => (/:(1b|3b|4b)/i.test(m) || /mini/i.test(m)) && !m.includes("embed"),
  );
  return cheap ?? null;
}
