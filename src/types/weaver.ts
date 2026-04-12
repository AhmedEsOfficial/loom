import { z } from "zod";
import type { GraphId, ModelRole, NodeId, TemplateId } from "./common.js";

// --- Graph DSL Zod Schemas ---

const BaseNodeSchema = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
});

export const StepNodeSchema = BaseNodeSchema.extend({
  type: z.literal("step"),
  prompt: z.string().min(1),
  model: z.enum(["planner", "worker", "critic"]).default("worker"),
  tools: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
});

export const ParallelNodeSchema: z.ZodType<ParallelNodeInput> =
  BaseNodeSchema.extend({
    type: z.literal("parallel"),
    branches: z.lazy(() => z.array(GraphNodeSchema)),
    merge: z.enum(["all", "first", "majority"]).default("all"),
  });

export const LoopUntilNodeSchema: z.ZodType<LoopUntilNodeInput> =
  BaseNodeSchema.extend({
    type: z.literal("loop_until"),
    body: z.lazy(() => z.array(GraphNodeSchema)),
    until: z.string().min(1),
    maxIterations: z.number().int().positive().default(10),
  });

export const GraphNodeSchema: z.ZodType<GraphNodeInput> = z.discriminatedUnion(
  "type",
  [StepNodeSchema, ParallelNodeSchema as any, LoopUntilNodeSchema as any],
);

// Input types (before parse — may have defaults applied)
interface ParallelNodeInput {
  type: "parallel";
  id: string;
  dependsOn?: string[];
  branches: GraphNodeInput[];
  merge?: "all" | "first" | "majority";
}

interface LoopUntilNodeInput {
  type: "loop_until";
  id: string;
  dependsOn?: string[];
  body: GraphNodeInput[];
  until: string;
  maxIterations?: number;
}

type GraphNodeInput =
  | z.input<typeof StepNodeSchema>
  | ParallelNodeInput
  | LoopUntilNodeInput;

// --- Parsed output types ---

export interface StepNode {
  type: "step";
  id: string;
  prompt: string;
  model: ModelRole;
  tools?: string[];
  dependsOn: string[];
  maxTokens?: number;
  timeout?: number;
}

export interface ParallelNode {
  type: "parallel";
  id: string;
  branches: GraphNode[];
  merge: "all" | "first" | "majority";
  dependsOn: string[];
}

export interface LoopUntilNode {
  type: "loop_until";
  id: string;
  body: GraphNode[];
  until: string;
  maxIterations: number;
  dependsOn: string[];
}

export type GraphNode = StepNode | ParallelNode | LoopUntilNode;

// --- Execution Graph ---

export interface ExecutionGraph {
  id: GraphId;
  nodes: GraphNode[];
  contentHash: string;
  metadata: {
    task: string;
    createdAt: number;
    model: string;
  };
}

// --- Weave Mutations ---

export const WeaveMutationSchema = z.object({
  action: z.enum([
    "insert_after",
    "insert_before",
    "replace",
    "append_to_loop",
  ]),
  targetNodeId: z.string().min(1),
  nodes: z.array(GraphNodeSchema),
});

export interface WeaveMutation {
  action: "insert_after" | "insert_before" | "replace" | "append_to_loop";
  targetNodeId: string;
  nodes: GraphNode[];
}

// --- Node Execution Result ---

export type NodeStatus = "pending" | "running" | "success" | "failure" | "skipped" | "timeout";

export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  output: string;
  fullTranscriptRef?: string; // Substrate episode ID
  duration: number; // ms
  tokenUsage: { input: number; output: number };
  mutations?: WeaveMutation[];
  error?: string;
}

export interface GraphExecution {
  id: string;
  graphId: GraphId;
  status: "running" | "completed" | "failed" | "cancelled";
  results: Map<string, NodeResult>;
  startedAt: number;
  completedAt?: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

// --- Graph Templates ---

export interface GraphTemplate {
  id: TemplateId;
  contentHash: string;
  taskPattern: string;
  graphJson: string;
  successCount: number;
  failureCount: number;
  avgDuration?: number;
  createdAt: number;
  lastUsedAt?: number;
}

// --- Execution context passed to each node ---

export interface NodeExecutionContext {
  systemPrompt: string;
  nodePrompt: string;
  dependencyOutputs: Map<string, string>; // nodeId -> distilled output
  availableTools: string[];
  graphId: GraphId;
  nodeId: string;
  maxTokens?: number;
  timeout?: number;
}

// --- Weaver interface ---

export interface Weaver {
  parseGraph(input: string, task: string): import("./common.js").Result<ExecutionGraph>;
  validate(graph: ExecutionGraph): import("./common.js").Result<void>;
  execute(
    graph: ExecutionGraph,
    systemPrompt: string,
  ): AsyncGenerator<NodeResult, void, undefined>;
  applyMutation(
    graph: ExecutionGraph,
    mutation: WeaveMutation,
  ): import("./common.js").Result<ExecutionGraph>;
  cacheGraph(graph: ExecutionGraph): Promise<void>;
  lookupCachedGraph(contentHash: string): Promise<ExecutionGraph | null>;
  extractTemplate(
    graph: ExecutionGraph,
    execution: GraphExecution,
  ): Promise<GraphTemplate | null>;
  findMatchingTemplate(taskFingerprint: string): Promise<GraphTemplate | null>;
}
