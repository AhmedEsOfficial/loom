import { LoomKernel } from "../../kernel.js";
import { loadConfig } from "../config.js";

export async function runCommand(task: string): Promise<void> {
  const config = loadConfig();
  const kernel = new LoomKernel(config);

  console.log(`Task: ${task}`);
  console.log(`Model: ${kernel.conductor.resolveModel("planner")}`);
  console.log("---");

  try {
    const result = await kernel.run(task);

    console.log();
    console.log("---");
    console.log(`Status: ${result.success ? "SUCCESS" : "FAILED"}`);

    if (result.error) {
      console.error(`Error: ${result.error}`);
    }

    if (result.nodeResults) {
      console.log(`\nNodes executed: ${result.nodeResults.length}`);
      for (const nr of result.nodeResults) {
        const statusIcon =
          nr.status === "success" ? "+" :
          nr.status === "failure" ? "x" :
          nr.status === "skipped" ? "-" : "?";
        console.log(
          `  [${statusIcon}] ${nr.nodeId} (${Math.round(nr.duration)}ms, ${nr.tokenUsage.input + nr.tokenUsage.output} tokens)`,
        );
        if (nr.output && nr.output.length > 0) {
          const preview = nr.output.length > 200
            ? nr.output.slice(0, 200) + "..."
            : nr.output;
          console.log(`      ${preview}`);
        }
      }
    }

    if (result.tokenUsage) {
      console.log(
        `\nTotal tokens: ${result.tokenUsage.input} in / ${result.tokenUsage.output} out`,
      );
    }

    console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);
  } finally {
    kernel.shutdown();
  }
}
