import type Database from "better-sqlite3";
import type { LoomConfig } from "./types/common.js";
import type { Conductor } from "./types/conductor.js";
import type { ContextManager } from "./types/context.js";
import { initDatabase, closeDatabase } from "./substrate/db.js";
import { SubstrateToolsImpl } from "./substrate/tools.js";
import { ConductorImpl, createConductor } from "./conductor/index.js";
import { ContextManagerImpl } from "./context/manager.js";
import { CartographerImpl } from "./cartographer/index.js";
import { GraphCache } from "./weaver/cache.js";
import {
  parseGraph,
  validateGraph,
  executeGraph,
  extractTemplate,
  findMatchingTemplate,
} from "./weaver/index.js";
import { createLogger } from "./util/logger.js";

const log = createLogger("kernel");

/**
 * LoomKernel is the composition root — it wires all five layers together.
 */
export class LoomKernel {
  readonly config: LoomConfig;
  readonly db: Database.Database;
  readonly substrate: SubstrateToolsImpl;
  readonly conductor: ConductorImpl;
  readonly contextManager: ContextManagerImpl;
  readonly cartographer: CartographerImpl;
  readonly graphCache: GraphCache;

  private initialized = false;

  constructor(config: LoomConfig) {
    this.config = config;

    // Layer 1: Substrate
    this.db = initDatabase({
      dataDir: config.dataDir,
      embeddingDimensions: config.embedding.dimensions,
    });
    this.substrate = new SubstrateToolsImpl(this.db, config.embedding.dimensions);

    // Layer 5: Conductor
    this.conductor = createConductor(config);

    // Layer 4: Context Engine
    this.contextManager = new ContextManagerImpl(
      this.substrate,
      this.conductor,
      {
        recentTurns: config.context.recentTurns,
        externalizeThreshold: config.context.externalizeThreshold,
        forkThreshold: config.context.forkThreshold,
        compactionInterval: config.context.compactionInterval,
        maxContextTokens: config.context.maxContextTokens,
      },
    );

    // Layer 2: Cartographer
    this.cartographer = new CartographerImpl(
      this.db,
      this.conductor,
      this.conductor.resolveModel("cartographer"),
      config.cartographer.ignorePatterns,
      config.cartographer.summaryBatchSize,
    );

    // Layer 3: Weaver (graph cache)
    this.graphCache = new GraphCache(this.db);

    this.initialized = true;
    log.info("Loom kernel initialized");
  }

  /**
   * Run a task: generate a graph, validate, execute, and optionally extract template.
   */
  async run(task: string, systemPrompt?: string): Promise<RunResult> {
    const startTime = performance.now();

    const prompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    // Check for matching template
    const template = findMatchingTemplate(task, this.graphCache);
    if (template) {
      log.info(
        { templateId: template.id, pattern: template.taskPattern },
        "Found matching graph template",
      );
    }

    // Ask the model to generate a graph
    const planningPrompt = template
      ? `${task}\n\nA previous similar task used this graph structure (you can adapt it):\n${template.graphJson}`
      : task;

    const planResponse = await this.conductor.complete({
      messages: [{ role: "user", content: planningPrompt }],
      model: this.conductor.resolveModel("planner"),
      systemPrompt: prompt,
      maxTokens: 4096,
      temperature: 0.3,
    });

    // Parse and validate the graph
    const parseResult = parseGraph(planResponse.content, task, planResponse.model);
    if (!parseResult.ok) {
      return {
        success: false,
        error: parseResult.error.message,
        duration: performance.now() - startTime,
      };
    }

    const graph = parseResult.value;
    const validation = validateGraph(graph, {
      maxNodes: this.config.weaver.maxNodes,
      maxLoopIterations: this.config.weaver.maxLoopIterations,
    });

    if (!validation.ok) {
      return {
        success: false,
        error: validation.error.message,
        duration: performance.now() - startTime,
      };
    }

    // Execute the graph
    const results: import("./types/weaver.js").NodeResult[] = [];
    const executor = executeGraph(
      graph,
      prompt,
      this.conductor,
      this.substrate,
      {
        nodeTimeout: this.config.weaver.nodeTimeout,
        maxLoopIterations: this.config.weaver.maxLoopIterations,
      },
    );

    let execution: import("./types/weaver.js").GraphExecution | undefined;
    let iterResult = await executor.next();

    while (!iterResult.done) {
      const nodeResult = iterResult.value;
      results.push(nodeResult);
      log.info(
        {
          nodeId: nodeResult.nodeId,
          status: nodeResult.status,
          duration: Math.round(nodeResult.duration),
        },
        "Node completed",
      );
      iterResult = await executor.next();
    }

    execution = iterResult.value;

    // Record execution
    if (execution) {
      this.graphCache.recordExecution(
        execution.id,
        execution.graphId,
        execution.status,
        JSON.stringify([...execution.results.entries()]),
        execution.startedAt,
        execution.completedAt ?? null,
        execution.totalTokensIn,
        execution.totalTokensOut,
      );

      // Try to extract template
      await extractTemplate(graph, execution, this.conductor, this.graphCache);
    }

    const duration = performance.now() - startTime;
    const trajectoryStats = this.conductor.getTrajectoryStats();

    return {
      success: execution?.status === "completed",
      graphId: graph.id,
      nodeResults: results,
      duration,
      tokenUsage: {
        input: trajectoryStats.totalInputTokens,
        output: trajectoryStats.totalOutputTokens,
      },
    };
  }

  /**
   * Shutdown: close database, stop watcher, cleanup.
   */
  shutdown(): void {
    this.cartographer.stopWatching();
    closeDatabase(this.db);
    this.initialized = false;
    log.info("Loom kernel shut down");
  }
}

export interface RunResult {
  success: boolean;
  error?: string;
  graphId?: string;
  nodeResults?: import("./types/weaver.js").NodeResult[];
  duration: number;
  tokenUsage?: { input: number; output: number };
}

const DEFAULT_SYSTEM_PROMPT = `You are Loom, an AI harness that solves tasks by authoring execution graphs.

When given a task, analyze it and create an execution graph using <graph> tags. The graph should use these node types:
- **step**: A single model call with a prompt, model role (planner/worker/critic), and optional tool access
- **parallel**: Concurrent branches with a merge strategy (all/first/majority)
- **loop_until**: Repeating body until a condition is met (natural language condition)

Each node has an "id" and optionally "dependsOn" to reference other node IDs.

Available tools:
- substrate_search: Full-text search over memory
- substrate_expand_symbol: Look up code symbols from the AST index
- substrate_related_episodes: Find episodes from similar tasks
- map_query: Browse the codebase map
- refetch: Re-fetch externalized content

During execution, you can mutate the graph using <weave> tags to add, replace, or modify nodes based on what you learn.

Example graph:
<graph task="fix the login bug">
{
  "nodes": [
    {"type": "step", "id": "analyze", "prompt": "Search the codebase for auth-related files and identify the login bug.", "model": "worker", "tools": ["substrate_search", "substrate_expand_symbol"]},
    {"type": "step", "id": "fix", "prompt": "Fix the identified bug.", "model": "worker", "dependsOn": ["analyze"]},
    {"type": "step", "id": "verify", "prompt": "Verify the fix by reviewing the changes.", "model": "critic", "dependsOn": ["fix"]}
  ]
}
</graph>`;
