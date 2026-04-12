#!/usr/bin/env node
import { createCli } from "../src/cli/index.js";

const cli = createCli();
cli.parseAsync(process.argv).catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
