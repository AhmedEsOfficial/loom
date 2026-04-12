import { z } from "zod";

// Branded ID types for compile-time safety without runtime cost
export type EpisodeId = string & { readonly __brand: "EpisodeId" };
export type MapNodeId = string & { readonly __brand: "MapNodeId" };
export type GraphId = string & { readonly __brand: "GraphId" };
export type NodeId = string & { readonly __brand: "NodeId" };
export type SkillId = string & { readonly __brand: "SkillId" };
export type TemplateId = string & { readonly __brand: "TemplateId" };

// Rust-style Result for operations that can fail predictably
export type Result<T, E = LoomError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = LoomError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface LoomError {
  code: ErrorCode;
  message: string;
  cause?: unknown;
}

export function loomError(
  code: ErrorCode,
  message: string,
  cause?: unknown,
): LoomError {
  return { code, message, cause };
}

export const ERROR_CODES = {
  // Substrate
  SUBSTRATE_QUERY_FAILED: "SUBSTRATE_QUERY_FAILED",
  SUBSTRATE_MIGRATION_FAILED: "SUBSTRATE_MIGRATION_FAILED",
  SUBSTRATE_INSERT_FAILED: "SUBSTRATE_INSERT_FAILED",
  // Cartographer
  CARTOGRAPHER_PARSE_FAILED: "CARTOGRAPHER_PARSE_FAILED",
  CARTOGRAPHER_SUMMARIZE_FAILED: "CARTOGRAPHER_SUMMARIZE_FAILED",
  CARTOGRAPHER_MAP_BUILD_FAILED: "CARTOGRAPHER_MAP_BUILD_FAILED",
  // Weaver
  WEAVER_INVALID_GRAPH: "WEAVER_INVALID_GRAPH",
  WEAVER_CYCLE_DETECTED: "WEAVER_CYCLE_DETECTED",
  WEAVER_BUDGET_EXCEEDED: "WEAVER_BUDGET_EXCEEDED",
  WEAVER_MUTATION_INVALID: "WEAVER_MUTATION_INVALID",
  WEAVER_NODE_TIMEOUT: "WEAVER_NODE_TIMEOUT",
  WEAVER_NODE_FAILED: "WEAVER_NODE_FAILED",
  WEAVER_PARSE_FAILED: "WEAVER_PARSE_FAILED",
  // Context
  CONTEXT_COMPACTION_FAILED: "CONTEXT_COMPACTION_FAILED",
  CONTEXT_FORK_FAILED: "CONTEXT_FORK_FAILED",
  // Conductor
  CONDUCTOR_PROVIDER_ERROR: "CONDUCTOR_PROVIDER_ERROR",
  CONDUCTOR_MODEL_NOT_FOUND: "CONDUCTOR_MODEL_NOT_FOUND",
  CONDUCTOR_TOOL_ERROR: "CONDUCTOR_TOOL_ERROR",
  // General
  CONFIG_INVALID: "CONFIG_INVALID",
  NOT_FOUND: "NOT_FOUND",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Model roles — the Conductor maps these to concrete model IDs
export type ModelRole =
  | "planner"
  | "worker"
  | "critic"
  | "compactor"
  | "cartographer";

export const ModelRoleSchema = z.enum([
  "planner",
  "worker",
  "critic",
  "compactor",
  "cartographer",
]);

// Provider configuration
export const ProviderConfigSchema = z.object({
  name: z.enum(["anthropic", "openai", "openrouter", "local"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  models: z.record(z.string()),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Main configuration
export const LoomConfigSchema = z.object({
  dataDir: z.string().default(".loom"),
  repoPath: z.string(),
  providers: z.array(ProviderConfigSchema).min(1),
  modelRoles: z.object({
    planner: z.string(),
    worker: z.string(),
    critic: z.string(),
    compactor: z.string(),
    cartographer: z.string(),
  }),
  context: z
    .object({
      recentTurns: z.number().int().positive().default(10),
      externalizeThreshold: z.number().int().positive().default(2048),
      forkThreshold: z.number().min(0).max(1).default(0.7),
      compactionInterval: z.number().int().positive().default(5),
      maxContextTokens: z.number().int().positive().default(100_000),
    })
    .default({}),
  weaver: z
    .object({
      maxNodes: z.number().int().positive().default(50),
      maxLoopIterations: z.number().int().positive().default(10),
      nodeTimeout: z.number().int().positive().default(300_000),
    })
    .default({}),
  cartographer: z
    .object({
      languages: z
        .array(z.string())
        .default(["typescript", "javascript", "python", "go", "rust", "java", "c"]),
      ignorePatterns: z
        .array(z.string())
        .default(["node_modules", ".git", "dist", "build", "__pycache__", "target"]),
      summaryBatchSize: z.number().int().positive().default(15),
    })
    .default({}),
  embedding: z
    .object({
      dimensions: z.number().int().positive().default(1536),
      model: z.string().default("text-embedding-3-small"),
      provider: z.string().default("openai"),
    })
    .default({}),
});

export type LoomConfig = z.infer<typeof LoomConfigSchema>;

// Token counting helper type
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHits?: number;
}
