import type { SubstrateToolsImpl } from "../substrate/tools.js";
import type { Conductor, CompletionResponse } from "../types/conductor.js";
import type {
  ExecutionGraph,
  GraphExecution,
  GraphNode,
  NodeResult,
  StepNode,
  WeaveMutation,
} from "../types/weaver.js";
import type { GraphId } from "../types/common.js";
import { createLogger } from "../util/logger.js";
import { newId } from "../util/id.js";
import { createSubstrateToolDefs, executeToolCall } from "../conductor/tools.js";
import { parseWeaveMutations, stripTags } from "./dsl.js";
import { topologicalSort, flattenNodes } from "./validator.js";
import { applyMutation } from "./mutator.js";

const log = createLogger("weaver");

export interface SchedulerConfig {
  nodeTimeout: number; // ms
  maxLoopIterations: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  nodeTimeout: 300_000,
  maxLoopIterations: 10,
};

/**
 * Execute an execution graph, yielding NodeResults as nodes complete.
 */
export async function* executeGraph(
  graph: ExecutionGraph,
  systemPrompt: string,
  conductor: Conductor,
  substrate: SubstrateToolsImpl,
  config: SchedulerConfig = DEFAULT_CONFIG,
): AsyncGenerator<NodeResult, GraphExecution, undefined> {
  const execution: GraphExecution = {
    id: newId(),
    graphId: graph.id,
    status: "running",
    results: new Map(),
    startedAt: Date.now(),
    totalTokensIn: 0,
    totalTokensOut: 0,
  };

  let currentNodes = [...graph.nodes];

  try {
    yield* executeNodes(
      currentNodes,
      graph.id,
      systemPrompt,
      conductor,
      substrate,
      execution,
      config,
    );

    execution.status = execution.results.size > 0 &&
      [...execution.results.values()].some((r) => r.status === "failure")
      ? "failed"
      : "completed";
  } catch (error) {
    execution.status = "failed";
    log.error({ error, graphId: graph.id }, "Graph execution failed");
  }

  execution.completedAt = Date.now();
  return execution;
}

async function* executeNodes(
  nodes: GraphNode[],
  graphId: GraphId,
  systemPrompt: string,
  conductor: Conductor,
  substrate: SubstrateToolsImpl,
  execution: GraphExecution,
  config: SchedulerConfig,
): AsyncGenerator<NodeResult> {
  // Get top-level execution order
  const order = topologicalSort(nodes);
  const nodeMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Track completed nodes
  const pending = new Set(order);

  while (pending.size > 0) {
    // Find nodes whose dependencies are all satisfied
    const ready: string[] = [];
    for (const nodeId of pending) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const depsReady = node.dependsOn.every(
        (dep) => !pending.has(dep),
      );
      if (depsReady) ready.push(nodeId);
    }

    if (ready.length === 0) {
      log.warn("No ready nodes but pending nodes remain — possible deadlock");
      break;
    }

    // Execute ready nodes in parallel
    const results = await Promise.allSettled(
      ready.map(async (nodeId) => {
        const node = nodeMap.get(nodeId)!;
        return executeNode(
          node,
          graphId,
          systemPrompt,
          conductor,
          substrate,
          execution,
          config,
        );
      }),
    );

    // Process results and yield
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const nodeId = ready[i]!;
      pending.delete(nodeId);

      if (result.status === "fulfilled") {
        const nodeResult = result.value;
        execution.results.set(nodeId, nodeResult);
        execution.totalTokensIn += nodeResult.tokenUsage.input;
        execution.totalTokensOut += nodeResult.tokenUsage.output;
        yield nodeResult;

        // Handle mutations
        if (nodeResult.mutations?.length) {
          for (const mutation of nodeResult.mutations) {
            const mutResult = applyMutation(
              { id: graphId, nodes, contentHash: "", metadata: { task: "", createdAt: 0, model: "" } },
              mutation,
            );
            if (mutResult.ok) {
              // Add new nodes to pending
              for (const newNode of mutation.nodes) {
                const flat = flattenNodes([newNode]);
                for (const fn of flat) {
                  nodeMap.set(fn.id, fn);
                  pending.add(fn.id);
                }
              }
              log.info(
                { mutation: mutation.action, target: mutation.targetNodeId },
                "Graph mutation applied",
              );
            }
          }
        }

        // Skip dependents of failed nodes
        if (nodeResult.status === "failure") {
          skipDependents(nodeId, nodes, pending, execution);
        }
      } else {
        // Promise rejected — node crashed
        const errorResult: NodeResult = {
          nodeId,
          status: "failure",
          output: "",
          duration: 0,
          tokenUsage: { input: 0, output: 0 },
          error: result.reason?.message ?? "Unknown error",
        };
        execution.results.set(nodeId, errorResult);
        yield errorResult;
        skipDependents(nodeId, nodes, pending, execution);
      }
    }
  }
}

async function executeNode(
  node: GraphNode,
  graphId: GraphId,
  systemPrompt: string,
  conductor: Conductor,
  substrate: SubstrateToolsImpl,
  execution: GraphExecution,
  config: SchedulerConfig,
): Promise<NodeResult> {
  const startTime = performance.now();

  switch (node.type) {
    case "step":
      return executeStepNode(
        node,
        graphId,
        systemPrompt,
        conductor,
        substrate,
        execution,
        config,
      );

    case "parallel":
      return executeParallelNode(
        node,
        graphId,
        systemPrompt,
        conductor,
        substrate,
        execution,
        config,
        startTime,
      );

    case "loop_until":
      return executeLoopNode(
        node,
        graphId,
        systemPrompt,
        conductor,
        substrate,
        execution,
        config,
        startTime,
      );
  }
}

async function executeStepNode(
  node: StepNode,
  graphId: GraphId,
  systemPrompt: string,
  conductor: Conductor,
  substrate: SubstrateToolsImpl,
  execution: GraphExecution,
  config: SchedulerConfig,
): Promise<NodeResult> {
  const startTime = performance.now();
  const model = conductor.resolveModel(node.model);

  // Build context from dependency outputs
  const depOutputs: string[] = [];
  for (const depId of node.dependsOn) {
    const depResult = execution.results.get(depId);
    if (depResult?.output) {
      depOutputs.push(`[Result from "${depId}"]: ${depResult.output}`);
    }
  }

  const userContent = depOutputs.length > 0
    ? `${depOutputs.join("\n\n")}\n\n---\n\n${node.prompt}`
    : node.prompt;

  const tools = createSubstrateToolDefs();
  let totalInput = 0;
  let totalOutput = 0;
  let finalContent = "";
  let allMutations: WeaveMutation[] = [];

  // Tool-use loop
  const messages: { role: "user" | "assistant" | "tool"; content: string; toolCallId?: string }[] = [
    { role: "user", content: userContent },
  ];

  const maxRounds = 10;
  for (let round = 0; round < maxRounds; round++) {
    const response = await conductor.complete({
      messages,
      model,
      tools,
      systemPrompt,
      maxTokens: node.maxTokens ?? 4096,
      temperature: 0.3,
    });

    totalInput += response.usage.inputTokens;
    totalOutput += response.usage.outputTokens;

    // Parse mutations from response
    const mutations = parseWeaveMutations(response.content);
    allMutations.push(...mutations);

    if (response.stopReason === "tool_use" && response.toolCalls.length > 0) {
      // Add assistant message
      messages.push({ role: "assistant", content: response.content });

      // Execute tool calls
      for (const tc of response.toolCalls) {
        const toolResult = await executeToolCall(tc.name, tc.input, substrate);
        messages.push({
          role: "tool",
          content: toolResult,
          toolCallId: tc.id,
        });

        // Store tool episode
        await substrate.storeEpisode({
          taskFingerprint: "",
          role: "tool",
          content: toolResult,
          toolName: tc.name,
          toolInput: JSON.stringify(tc.input),
          toolOutput: toolResult,
          graphId: graphId as any,
          nodeId: node.id as any,
          tokenCount: 0,
        });
      }
    } else {
      finalContent = stripTags(response.content);
      break;
    }
  }

  const duration = performance.now() - startTime;

  // Store episode
  const episodeId = await substrate.storeEpisode({
    taskFingerprint: "",
    role: "assistant",
    content: finalContent,
    graphId: graphId as any,
    nodeId: node.id as any,
    tokenCount: totalOutput,
  });

  log.info(
    {
      nodeId: node.id,
      model,
      duration: Math.round(duration),
      tokens: { input: totalInput, output: totalOutput },
    },
    "Step node completed",
  );

  return {
    nodeId: node.id,
    status: "success",
    output: finalContent,
    fullTranscriptRef: episodeId,
    duration,
    tokenUsage: { input: totalInput, output: totalOutput },
    mutations: allMutations.length > 0 ? allMutations : undefined,
  };
}

async function executeParallelNode(
  node: GraphNode & { type: "parallel" },
  graphId: GraphId,
  systemPrompt: string,
  conductor: Conductor,
  substrate: SubstrateToolsImpl,
  execution: GraphExecution,
  config: SchedulerConfig,
  startTime: number,
): Promise<NodeResult> {
  const branchResults = await Promise.allSettled(
    node.branches.map((branch) =>
      executeNode(branch, graphId, systemPrompt, conductor, substrate, execution, config),
    ),
  );

  const outputs: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (let i = 0; i < branchResults.length; i++) {
    const result = branchResults[i]!;
    if (result.status === "fulfilled") {
      const nr = result.value;
      execution.results.set(nr.nodeId, nr);
      outputs.push(`[Branch "${nr.nodeId}"]: ${nr.output}`);
      totalInput += nr.tokenUsage.input;
      totalOutput += nr.tokenUsage.output;
    } else {
      outputs.push(`[Branch ${i}]: FAILED - ${result.reason?.message}`);
    }
  }

  const mergedOutput = mergeOutputs(outputs, node.merge);
  const duration = performance.now() - startTime;

  return {
    nodeId: node.id,
    status: branchResults.every((r) => r.status === "fulfilled") ? "success" : "failure",
    output: mergedOutput,
    duration,
    tokenUsage: { input: totalInput, output: totalOutput },
  };
}

async function executeLoopNode(
  node: GraphNode & { type: "loop_until" },
  graphId: GraphId,
  systemPrompt: string,
  conductor: Conductor,
  substrate: SubstrateToolsImpl,
  execution: GraphExecution,
  config: SchedulerConfig,
  startTime: number,
): Promise<NodeResult> {
  let totalInput = 0;
  let totalOutput = 0;
  let lastOutput = "";
  const maxIter = Math.min(node.maxIterations, config.maxLoopIterations);

  for (let iteration = 0; iteration < maxIter; iteration++) {
    log.info({ nodeId: node.id, iteration, maxIter }, "Loop iteration");

    // Execute loop body
    for (const bodyNode of node.body) {
      const result = await executeNode(
        bodyNode,
        graphId,
        systemPrompt,
        conductor,
        substrate,
        execution,
        config,
      );
      execution.results.set(result.nodeId, result);
      totalInput += result.tokenUsage.input;
      totalOutput += result.tokenUsage.output;
      lastOutput = result.output;
    }

    // Evaluate the "until" condition
    const conditionMet = await evaluateCondition(
      node.until,
      lastOutput,
      conductor,
    );

    totalInput += conditionMet.tokensUsed.input;
    totalOutput += conditionMet.tokensUsed.output;

    if (conditionMet.result) {
      log.info(
        { nodeId: node.id, iteration },
        "Loop condition met",
      );
      break;
    }
  }

  const duration = performance.now() - startTime;

  return {
    nodeId: node.id,
    status: "success",
    output: lastOutput,
    duration,
    tokenUsage: { input: totalInput, output: totalOutput },
  };
}

/**
 * Evaluate a natural-language condition using a cheap model.
 */
async function evaluateCondition(
  condition: string,
  output: string,
  conductor: Conductor,
): Promise<{ result: boolean; tokensUsed: { input: number; output: number } }> {
  const response = await conductor.complete({
    messages: [
      {
        role: "user",
        content: `Given the following output, has this condition been met?\n\nCondition: "${condition}"\n\nOutput:\n${output.slice(0, 2000)}\n\nAnswer with only "YES" or "NO".`,
      },
    ],
    model: conductor.resolveModel("compactor"),
    maxTokens: 10,
    temperature: 0,
  });

  const answer = response.content.trim().toUpperCase();

  return {
    result: answer.startsWith("YES"),
    tokensUsed: {
      input: response.usage.inputTokens,
      output: response.usage.outputTokens,
    },
  };
}

function mergeOutputs(
  outputs: string[],
  strategy: "all" | "first" | "majority",
): string {
  switch (strategy) {
    case "first":
      return outputs[0] ?? "";
    case "all":
      return outputs.join("\n\n");
    case "majority":
      // For majority, just return all for now
      return outputs.join("\n\n");
  }
}

function skipDependents(
  failedNodeId: string,
  nodes: GraphNode[],
  pending: Set<string>,
  execution: GraphExecution,
): void {
  const flat = flattenNodes(nodes);
  for (const node of flat) {
    if (node.dependsOn.includes(failedNodeId) && pending.has(node.id)) {
      pending.delete(node.id);
      execution.results.set(node.id, {
        nodeId: node.id,
        status: "skipped",
        output: `Skipped: dependency "${failedNodeId}" failed`,
        duration: 0,
        tokenUsage: { input: 0, output: 0 },
      });
    }
  }
}
