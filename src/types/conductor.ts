import type { z } from "zod";
import type { GraphId, ModelRole, NodeId, TokenUsage } from "./common.js";

// --- Messages ---

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
  toolCallId?: string;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  toolUseId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  cacheControl?: { type: "ephemeral" };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// --- Tool Definitions ---

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

// --- Completion ---

export interface CompletionRequest {
  messages: Message[];
  model: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface CompletionResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  latency: number; // ms
  model: string;
}

// --- Trajectory ---

export interface TrajectoryEntry {
  request: CompletionRequest;
  response: CompletionResponse;
  graphId?: GraphId;
  nodeId?: string;
  timestamp: number;
}

// --- Provider ---

export interface Provider {
  readonly name: string;
  readonly supportsPromptCaching: boolean;
  readonly supportedModels: string[];

  complete(request: CompletionRequest): Promise<CompletionResponse>;
  embedText?(texts: string[]): Promise<Float32Array[]>;
}

// --- Conductor ---

export interface Conductor {
  /** Register a provider */
  registerProvider(provider: Provider): void;

  /** Complete a request — routes to the right provider based on model */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Resolve a model role to a concrete model ID */
  resolveModel(role: ModelRole): string;

  /** Generate embeddings */
  embed(texts: string[]): Promise<Float32Array[]>;

  /** Get trajectory entries, optionally filtered */
  getTrajectory(graphId?: GraphId): TrajectoryEntry[];

  /** Record a trajectory entry */
  recordTrajectory(entry: TrajectoryEntry): void;

  /** Clear trajectory */
  clearTrajectory(): void;
}
