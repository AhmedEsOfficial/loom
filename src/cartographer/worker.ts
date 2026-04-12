/**
 * Worker thread for CPU-bound tree-sitter parsing.
 * Used by the WorkerPool to parallelize file parsing.
 *
 * Message format:
 *   Input: { filePath: string }
 *   Output: ParsedFile | null
 */
import { parentPort } from "node:worker_threads";
import { parseFile } from "./parser.js";

if (parentPort) {
  parentPort.on("message", async (data: { filePath: string }) => {
    try {
      const result = await parseFile(data.filePath);
      parentPort!.postMessage(result);
    } catch (error) {
      parentPort!.postMessage(null);
    }
  });
}
