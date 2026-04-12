/**
 * Benchmark: Compare Loom graph execution vs direct model call.
 *
 * This measures:
 * 1. Quality: Does Loom produce better/more structured output?
 * 2. Efficiency: Token usage comparison
 * 3. Reliability: Does the multi-step approach catch more issues?
 *
 * Usage: npx tsx test/benchmark.ts
 */

import { readFileSync } from "node:fs";

const OLLAMA_URL = "http://localhost:11434";
const MODEL = "qwen2.5-coder:7b";

const TASK = `Analyze the following TypeScript codebase and:
1. Identify any bugs or missing error handling
2. List security vulnerabilities
3. Suggest specific improvements with code examples

Here are the files:`;

const FILES = [
  { path: "src/user-service.ts", content: readFileSync("/tmp/loom-benchmark/src/user-service.ts", "utf-8") },
  { path: "src/api.ts", content: readFileSync("/tmp/loom-benchmark/src/api.ts", "utf-8") },
];

const FILE_CONTEXT = FILES.map(f => `\n--- ${f.path} ---\n${f.content}`).join("\n");

interface BenchmarkResult {
  name: string;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  output: string;
  steps: number;
}

async function ollamaChat(messages: { role: string; content: string }[], maxTokens = 4096): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
  duration: number;
}> {
  const start = performance.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: { temperature: 0.3, num_predict: maxTokens },
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json() as any;
  const duration = performance.now() - start;

  return {
    content: data.message?.content ?? "",
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
    duration,
  };
}

// --- Baseline: Single direct call ---
async function runBaseline(): Promise<BenchmarkResult> {
  console.log("\n=== BASELINE: Direct single-shot call ===");
  const start = performance.now();

  const result = await ollamaChat([
    {
      role: "system",
      content: "You are an expert code reviewer. Analyze code thoroughly for bugs, security issues, and improvements.",
    },
    {
      role: "user",
      content: `${TASK}\n${FILE_CONTEXT}`,
    },
  ]);

  const duration = performance.now() - start;
  console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Tokens: ${result.promptTokens} in / ${result.completionTokens} out`);
  console.log(`  Output length: ${result.content.length} chars`);

  return {
    name: "Baseline (single call)",
    duration,
    inputTokens: result.promptTokens,
    outputTokens: result.completionTokens,
    output: result.content,
    steps: 1,
  };
}

// --- Loom-style: Multi-step structured approach ---
async function runMultiStep(): Promise<BenchmarkResult> {
  console.log("\n=== LOOM-STYLE: Multi-step structured analysis ===");
  const start = performance.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let steps = 0;

  // Step 1: Identify the structure
  console.log("  Step 1: Code structure analysis...");
  const step1 = await ollamaChat([
    {
      role: "system",
      content: "You are a code analyzer. List every function, its parameters, return type, and what it does. Be precise and exhaustive.",
    },
    {
      role: "user",
      content: `Analyze the structure of these files. List every function, class, type, and export with their signatures:\n${FILE_CONTEXT}`,
    },
  ], 2048);
  totalInputTokens += step1.promptTokens;
  totalOutputTokens += step1.completionTokens;
  steps++;
  console.log(`    ${(step1.duration / 1000).toFixed(1)}s, ${step1.completionTokens} tokens`);

  // Step 2: Bug analysis (focused on the structure from step 1)
  console.log("  Step 2: Bug analysis...");
  const step2 = await ollamaChat([
    {
      role: "system",
      content: "You are a bug hunter. Given the code and its structure analysis, find ALL bugs, edge cases, and missing error handling. For each bug, specify the exact file, line, and what goes wrong.",
    },
    {
      role: "user",
      content: `Here is the codebase:\n${FILE_CONTEXT}\n\nStructure analysis from previous step:\n${step1.content}\n\nFind all bugs, edge cases, and missing error handling. Be specific about file and location.`,
    },
  ], 2048);
  totalInputTokens += step2.promptTokens;
  totalOutputTokens += step2.completionTokens;
  steps++;
  console.log(`    ${(step2.duration / 1000).toFixed(1)}s, ${step2.completionTokens} tokens`);

  // Step 3: Security analysis (parallel-style, independent focus)
  console.log("  Step 3: Security analysis...");
  const step3 = await ollamaChat([
    {
      role: "system",
      content: "You are a security auditor. Focus ONLY on security vulnerabilities: injection, access control, data validation, information disclosure. Rate each by severity (critical/high/medium/low).",
    },
    {
      role: "user",
      content: `Audit these files for security vulnerabilities:\n${FILE_CONTEXT}\n\nFor each vulnerability, specify: severity, location, description, and remediation.`,
    },
  ], 2048);
  totalInputTokens += step3.promptTokens;
  totalOutputTokens += step3.completionTokens;
  steps++;
  console.log(`    ${(step3.duration / 1000).toFixed(1)}s, ${step3.completionTokens} tokens`);

  // Step 4: Synthesis — combine all findings
  console.log("  Step 4: Synthesis and recommendations...");
  const step4 = await ollamaChat([
    {
      role: "system",
      content: "You are a senior engineer synthesizing code review findings. Combine the bug analysis and security audit into a prioritized, actionable report. Include concrete code fixes.",
    },
    {
      role: "user",
      content: `Synthesize these findings into a final report:\n\n## Bug Analysis\n${step2.content}\n\n## Security Audit\n${step3.content}\n\nProvide a prioritized list of issues with concrete code fixes for each.`,
    },
  ], 2048);
  totalInputTokens += step4.promptTokens;
  totalOutputTokens += step4.completionTokens;
  steps++;
  console.log(`    ${(step4.duration / 1000).toFixed(1)}s, ${step4.completionTokens} tokens`);

  const duration = performance.now() - start;
  console.log(`  Total duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Total tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);

  return {
    name: "Loom-style (4-step graph)",
    duration,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    output: step4.content,
    steps,
  };
}

// --- Score the quality of outputs ---
async function scoreOutput(output: string, label: string): Promise<{ score: number; reasoning: string }> {
  const result = await ollamaChat([
    {
      role: "system",
      content: `You are a code review quality judge. Score the following code review output on a scale of 1-10 based on:
- Completeness (did it find all issues?)
- Specificity (exact locations, not vague)
- Actionability (concrete fixes, not just descriptions)
- Security awareness (did it catch security issues?)

The codebase being reviewed has these known issues:
1. divide() has no division-by-zero check
2. API has no input validation (missing name/email in POST)
3. Users stored in memory (no persistence) — not a bug but a design issue
4. No authentication/authorization on endpoints
5. regex match[1] could be undefined
6. No rate limiting
7. Email format not validated

Reply with ONLY a JSON object: {"score": N, "reasoning": "..."}`,
    },
    {
      role: "user",
      content: `Score this ${label} code review:\n\n${output}`,
    },
  ], 512);

  try {
    const json = result.content.match(/\{[^}]+\}/)?.[0];
    if (json) return JSON.parse(json);
  } catch {}
  return { score: 0, reasoning: "Failed to parse score" };
}

async function main() {
  console.log("================================================================");
  console.log("  LOOM BENCHMARK: Multi-step Graph vs Single-shot Baseline");
  console.log(`  Model: ${MODEL}`);
  console.log(`  Codebase: 2 TypeScript files (user-service + API handler)`);
  console.log("================================================================");

  const baseline = await runBaseline();
  const multiStep = await runMultiStep();

  // Score both outputs
  console.log("\n=== SCORING (using model as judge) ===");
  console.log("  Scoring baseline...");
  const baselineScore = await scoreOutput(baseline.output, "baseline (single-shot)");
  console.log("  Scoring multi-step...");
  const multiStepScore = await scoreOutput(multiStep.output, "multi-step (Loom-style)");

  // Results table
  console.log("\n================================================================");
  console.log("  RESULTS");
  console.log("================================================================");
  console.log(`
  Metric               | Baseline        | Loom-style
  ---------------------|-----------------|------------------
  Duration             | ${(baseline.duration / 1000).toFixed(1)}s            | ${(multiStep.duration / 1000).toFixed(1)}s
  Steps                | ${baseline.steps}               | ${multiStep.steps}
  Input tokens         | ${baseline.inputTokens}           | ${multiStep.inputTokens}
  Output tokens        | ${baseline.outputTokens}           | ${multiStep.outputTokens}
  Total tokens         | ${baseline.inputTokens + baseline.outputTokens}           | ${multiStep.inputTokens + multiStep.outputTokens}
  Quality score        | ${baselineScore.score}/10         | ${multiStepScore.score}/10
  `);

  console.log("  Baseline reasoning:", baselineScore.reasoning);
  console.log("  Multi-step reasoning:", multiStepScore.reasoning);

  // Highlight the improvement
  const qualityDiff = multiStepScore.score - baselineScore.score;
  const tokenDiff = (multiStep.inputTokens + multiStep.outputTokens) - (baseline.inputTokens + baseline.outputTokens);

  console.log("\n  === VERDICT ===");
  if (qualityDiff > 0) {
    console.log(`  Quality: Loom-style is +${qualityDiff} points better (${baselineScore.score} → ${multiStepScore.score})`);
  } else if (qualityDiff < 0) {
    console.log(`  Quality: Baseline is +${-qualityDiff} points better (${multiStepScore.score} → ${baselineScore.score})`);
  } else {
    console.log(`  Quality: Tied at ${baselineScore.score}/10`);
  }
  console.log(`  Token cost: Loom-style uses ${tokenDiff > 0 ? "+" : ""}${tokenDiff} tokens (${((tokenDiff / (baseline.inputTokens + baseline.outputTokens)) * 100).toFixed(0)}% ${tokenDiff > 0 ? "more" : "fewer"})`);
  console.log(`  Time: Loom-style takes ${((multiStep.duration / baseline.duration - 1) * 100).toFixed(0)}% ${multiStep.duration > baseline.duration ? "longer" : "less"}`);

  // Save outputs for manual review
  console.log("\n  Full outputs saved for manual review:");
  console.log("  /tmp/loom-benchmark-baseline.md");
  console.log("  /tmp/loom-benchmark-multistep.md");

  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/loom-benchmark-baseline.md", `# Baseline Output\n\n${baseline.output}`);
  writeFileSync("/tmp/loom-benchmark-multistep.md", `# Multi-step Output\n\n${multiStep.output}`);
}

main().catch(console.error);
