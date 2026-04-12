import pino from "pino";

export type LogLayer =
  | "substrate"
  | "cartographer"
  | "weaver"
  | "context"
  | "conductor"
  | "cli"
  | "mcp"
  | "kernel";

export interface LogContext {
  layer?: LogLayer;
  graphId?: string;
  nodeId?: string;
  duration?: number;
  tokenUsage?: { input: number; output: number };
  [key: string]: unknown;
}

const baseLogger = pino({
  level: process.env["LOOM_LOG_LEVEL"] ?? "info",
  transport:
    process.env["NODE_ENV"] !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createLogger(layer: LogLayer): pino.Logger {
  return baseLogger.child({ layer });
}

export const logger = baseLogger;
