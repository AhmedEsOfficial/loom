import type { LoomConfig, ModelRole, ProviderConfig } from "../types/common.js";
import type {
  CompletionRequest,
  CompletionResponse,
  Conductor,
  Provider,
  TrajectoryEntry,
} from "../types/conductor.js";
import type { GraphId } from "../types/common.js";
import { createLogger } from "../util/logger.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import { LocalProvider } from "./local.js";
import { TrajectoryStore } from "./trajectory.js";

export { AnthropicProvider } from "./anthropic.js";
export { OpenAIProvider } from "./openai.js";
export { OpenRouterProvider } from "./openrouter.js";
export { LocalProvider } from "./local.js";
export { TrajectoryStore } from "./trajectory.js";
export { createSubstrateToolDefs, executeToolCall } from "./tools.js";

const log = createLogger("conductor");

export class ConductorImpl implements Conductor {
  private providers = new Map<string, Provider>();
  private modelToProvider = new Map<string, string>();
  private trajectory = new TrajectoryStore();

  constructor(private modelRoles: Record<ModelRole, string>) {}

  registerProvider(provider: Provider): void {
    this.providers.set(provider.name, provider);

    // Map each supported model to this provider
    for (const model of provider.supportedModels) {
      this.modelToProvider.set(model, provider.name);
    }

    log.info(
      { provider: provider.name, models: provider.supportedModels.length },
      "Provider registered",
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = this.findProvider(request.model);
    if (!provider) {
      throw new Error(
        `No provider found for model "${request.model}". Registered providers: ${[...this.providers.keys()].join(", ")}`,
      );
    }

    const response = await provider.complete(request);

    // Record trajectory
    this.trajectory.record({
      request,
      response,
      timestamp: Date.now(),
    });

    return response;
  }

  resolveModel(role: ModelRole): string {
    const model = this.modelRoles[role];
    if (!model) {
      throw new Error(`No model configured for role "${role}"`);
    }
    return model;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Find a provider that supports embeddings
    for (const provider of this.providers.values()) {
      if (provider.embedText) {
        return provider.embedText(texts);
      }
    }
    throw new Error("No provider supports embeddings");
  }

  getTrajectory(graphId?: GraphId): TrajectoryEntry[] {
    if (graphId) return this.trajectory.getByGraph(graphId);
    return this.trajectory.getAll();
  }

  recordTrajectory(entry: TrajectoryEntry): void {
    this.trajectory.record(entry);
  }

  clearTrajectory(): void {
    this.trajectory.clear();
  }

  getTrajectoryStats() {
    return this.trajectory.getStats();
  }

  private findProvider(model: string): Provider | undefined {
    // Direct model mapping
    const providerName = this.modelToProvider.get(model);
    if (providerName) {
      return this.providers.get(providerName);
    }

    // For OpenRouter and local, accept any model
    // Try OpenRouter first (it accepts arbitrary model paths)
    const openrouter = this.providers.get("openrouter");
    if (openrouter) return openrouter;

    // Then local
    const local = this.providers.get("local");
    if (local) return local;

    return undefined;
  }
}

/**
 * Create and configure a Conductor from LoomConfig
 */
export function createConductor(config: LoomConfig): ConductorImpl {
  const conductor = new ConductorImpl(config.modelRoles as Record<ModelRole, string>);

  for (const providerConfig of config.providers) {
    const provider = createProvider(providerConfig);
    conductor.registerProvider(provider);
  }

  return conductor;
}

function createProvider(config: ProviderConfig): Provider {
  switch (config.name) {
    case "anthropic":
      return new AnthropicProvider(config.apiKey);
    case "openai":
      return new OpenAIProvider(config.apiKey, config.baseUrl);
    case "openrouter":
      return new OpenRouterProvider(config.apiKey);
    case "local":
      return new LocalProvider(config.baseUrl);
    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}
