import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { mapCommand } from "./commands/map.js";
import { searchCommand } from "./commands/search.js";
import { graphCommand } from "./commands/graph.js";
import { serveCommand } from "./commands/serve.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("loom")
    .description("Loom — an emergent AI harness for model-authored execution graphs")
    .version("0.1.0");

  program
    .command("init [repo-path]")
    .description("Initialize Loom for a repository")
    .action(async (repoPath?: string) => {
      await initCommand(repoPath);
    });

  program
    .command("run <task>")
    .description("Run a task (model builds and executes a graph)")
    .action(async (task: string) => {
      await runCommand(task);
    });

  program
    .command("map")
    .description("Show or refresh the codebase map")
    .option("--refresh", "Rebuild the codebase map")
    .option("--zoom <path>", "Zoom into a specific path")
    .action(async (opts) => {
      await mapCommand(opts);
    });

  program
    .command("search <query>")
    .description("Search the substrate (episodes, symbols, skills)")
    .action(async (query: string) => {
      await searchCommand(query);
    });

  program
    .command("graph <action> [id]")
    .description("Manage graph templates (list, show, replay)")
    .action(async (action: string, id?: string) => {
      if (action !== "list" && action !== "show" && action !== "replay") {
        console.error("Usage: loom graph <list|show|replay> [id]");
        process.exit(1);
      }
      await graphCommand(action, id);
    });

  program
    .command("serve")
    .description("Start the MCP server")
    .option("--port <port>", "Port for SSE transport", parseInt)
    .action(async (opts) => {
      await serveCommand(opts);
    });

  return program;
}
