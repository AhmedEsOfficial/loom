import { LoomKernel } from "../../kernel.js";
import { loadConfig } from "../config.js";

export async function graphCommand(
  action: "list" | "show" | "replay",
  id?: string,
): Promise<void> {
  const config = loadConfig();
  const kernel = new LoomKernel(config);

  try {
    switch (action) {
      case "list": {
        const templates = kernel.graphCache.list(20);
        if (templates.length === 0) {
          console.log("No cached graph templates found.");
          return;
        }
        console.log(`Graph templates (${templates.length}):\n`);
        for (const t of templates) {
          const successRate =
            t.successCount + t.failureCount > 0
              ? (
                  (t.successCount / (t.successCount + t.failureCount)) *
                  100
                ).toFixed(0)
              : "N/A";
          console.log(
            `  ${t.id} | pattern: ${t.taskPattern.slice(0, 12)}... | success: ${successRate}% (${t.successCount}/${t.successCount + t.failureCount}) | ${t.avgDuration ? `avg: ${(t.avgDuration / 1000).toFixed(1)}s` : ""}`,
          );
        }
        break;
      }

      case "show": {
        if (!id) {
          console.error("Usage: loom graph show <id>");
          return;
        }
        const templates = kernel.graphCache.list(100);
        const template = templates.find((t) => t.id === id);
        if (!template) {
          console.error(`Template not found: ${id}`);
          return;
        }
        console.log(`Template: ${template.id}`);
        console.log(`Pattern: ${template.taskPattern}`);
        console.log(`Hash: ${template.contentHash}`);
        console.log(`Success: ${template.successCount} | Failure: ${template.failureCount}`);
        console.log(`\nGraph:`);
        console.log(JSON.stringify(JSON.parse(template.graphJson), null, 2));
        break;
      }

      case "replay": {
        if (!id) {
          console.error("Usage: loom graph replay <id>");
          return;
        }
        console.log(`Replaying graph ${id}...`);
        // Find and execute the template's graph
        const templates = kernel.graphCache.list(100);
        const template = templates.find((t) => t.id === id);
        if (!template) {
          console.error(`Template not found: ${id}`);
          return;
        }

        const result = await kernel.run(`Replay template: ${template.taskPattern}`);
        console.log(`Replay ${result.success ? "succeeded" : "failed"} in ${(result.duration / 1000).toFixed(1)}s`);
        break;
      }
    }
  } finally {
    kernel.shutdown();
  }
}
