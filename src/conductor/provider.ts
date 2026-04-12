import type {
  CompletionRequest,
  CompletionResponse,
  Provider,
} from "../types/conductor.js";

/**
 * Base class for providers with common utilities.
 */
export abstract class BaseProvider implements Provider {
  abstract readonly name: string;
  abstract readonly supportsPromptCaching: boolean;
  abstract readonly supportedModels: string[];

  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;

  embedText?(texts: string[]): Promise<Float32Array[]>;

  protected measureLatency<T>(fn: () => Promise<T>): Promise<[T, number]> {
    const start = performance.now();
    return fn().then((result) => [result, performance.now() - start]);
  }
}
