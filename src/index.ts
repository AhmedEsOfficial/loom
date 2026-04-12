// Loom Harness — Public API

// Types
export type {
  LoomConfig,
  LoomError,
  Result,
  ErrorCode,
  ModelRole,
  ProviderConfig,
} from "./types/common.js";
export type {
  Episode,
  EpisodeInsert,
  SubstrateTools,
  SubstrateResult,
  FtsResult,
  SymbolDetail,
  SkillEntry,
  VectorEntry,
} from "./types/substrate.js";
export type {
  MapNode,
  CodebaseMap,
  Cartographer,
  ParsedFile,
  ParsedSymbol,
} from "./types/cartographer.js";
export type {
  ExecutionGraph,
  GraphNode,
  StepNode,
  ParallelNode,
  LoopUntilNode,
  WeaveMutation,
  NodeResult,
  GraphExecution,
  GraphTemplate,
  Weaver,
} from "./types/weaver.js";
export type {
  ContextEntry,
  ContextManager,
  HandoffBrief,
  CompactionResult,
} from "./types/context.js";
export type {
  Message,
  Provider,
  Conductor,
  CompletionRequest,
  CompletionResponse,
  ToolDefinition,
  TrajectoryEntry,
} from "./types/conductor.js";

// Core
export { LoomKernel, type RunResult } from "./kernel.js";

// Substrate
export { initDatabase, closeDatabase } from "./substrate/db.js";
export { SubstrateToolsImpl } from "./substrate/tools.js";

// Conductor
export { ConductorImpl, createConductor } from "./conductor/index.js";
export { AnthropicProvider } from "./conductor/anthropic.js";
export { OpenAIProvider } from "./conductor/openai.js";
export { OpenRouterProvider } from "./conductor/openrouter.js";
export { LocalProvider } from "./conductor/local.js";

// Weaver
export { parseGraph, validateGraph, executeGraph } from "./weaver/index.js";
export { GraphCache } from "./weaver/cache.js";

// Cartographer
export { CartographerImpl } from "./cartographer/index.js";

// Context
export { ContextManagerImpl } from "./context/manager.js";

// CLI
export { createCli } from "./cli/index.js";

// MCP
export { createMcpServer } from "./mcp/index.js";
