import type {
  CompletionRequest,
  CompletionResponse,
  ToolCall,
} from "../types/conductor.js";
import { createLogger } from "../util/logger.js";
import { BaseProvider } from "./provider.js";

const log = createLogger("conductor");

export type LocalBackend = "openai-compat" | "ollama";

/**
 * Auto-detect which local backend is available.
 */
export async function detectLocalBackend(): Promise<{
  backend: LocalBackend;
  baseUrl: string;
  models: string[];
} | null> {
  // Try Ollama (port 11434)
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.models ?? []).map((m: any) => m.name as string);
      return { backend: "ollama", baseUrl: "http://localhost:11434", models };
    }
  } catch {}

  // Try LM Studio (port 1234, OpenAI-compatible)
  try {
    const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.data ?? []).map((m: any) => m.id as string);
      return { backend: "openai-compat", baseUrl: "http://localhost:1234/v1", models };
    }
  } catch {}

  // Try llama-server / llama.cpp (port 8080)
  try {
    const res = await fetch("http://localhost:8080/health", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      return { backend: "openai-compat", baseUrl: "http://localhost:8080/v1", models: ["default"] };
    }
  } catch {}

  // Try generic OpenAI-compatible (port 8000, e.g. vLLM)
  try {
    const res = await fetch("http://localhost:8000/v1/models", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.data ?? []).map((m: any) => m.id as string);
      return { backend: "openai-compat", baseUrl: "http://localhost:8000/v1", models };
    }
  } catch {}

  return null;
}

/**
 * Local provider for OpenAI-compatible endpoints (vLLM, llama.cpp, LM Studio)
 * and Ollama's native API.
 */
export class LocalProvider extends BaseProvider {
  readonly name = "local";
  readonly supportsPromptCaching = false;
  readonly supportedModels: string[];

  private baseUrl: string;
  private backend: LocalBackend;

  constructor(baseUrl?: string, backend?: LocalBackend, models?: string[]) {
    super();
    this.baseUrl = baseUrl ?? process.env["LOCAL_MODEL_URL"] ?? "http://localhost:11434";
    this.backend = backend ?? (this.baseUrl.includes("11434") ? "ollama" : "openai-compat");
    this.supportedModels = models ?? [];
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (this.backend === "ollama") {
      return this.completeOllama(request);
    }
    return this.completeOpenAICompat(request);
  }

  private async completeOllama(request: CompletionRequest): Promise<CompletionResponse> {
    const [response, latency] = await this.measureLatency(async () => {
      const messages: any[] = [];

      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }

      for (const msg of request.messages) {
        if (msg.role === "system") continue;
        const content =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("");
        messages.push({ role: msg.role, content });
      }

      const body: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? 4096,
        },
      };

      // Ollama supports tools via the /api/chat endpoint
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));
      }

      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama API error ${res.status}: ${text}`);
      }

      return res.json() as Promise<any>;
    });

    const content = response.message?.content ?? "";
    const toolCalls: ToolCall[] = (response.message?.tool_calls ?? []).map(
      (tc: any) => ({
        id: tc.id ?? `tool_${Date.now()}`,
        name: tc.function?.name ?? "",
        input: typeof tc.function?.arguments === "string"
          ? safeJsonParse(tc.function.arguments)
          : tc.function?.arguments ?? {},
      }),
    );

    const usage = {
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
    };

    log.debug(
      { model: request.model, usage, latency: Math.round(latency) },
      "Ollama completion",
    );

    return {
      content,
      toolCalls,
      usage,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      latency,
      model: request.model,
    };
  }

  private async completeOpenAICompat(request: CompletionRequest): Promise<CompletionResponse> {
    const [response, latency] = await this.measureLatency(async () => {
      const messages: any[] = [];

      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }

      for (const msg of request.messages) {
        if (msg.role === "system") continue;
        const content =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("");

        messages.push({ role: msg.role, content });
      }

      const body: Record<string, unknown> = {
        model: request.model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
      };

      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Local model API error ${res.status}: ${text}`);
      }

      return res.json() as Promise<any>;
    });

    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map(
      (tc: any) => ({
        id: tc.id ?? "",
        name: tc.function?.name ?? "",
        input: safeJsonParse(tc.function?.arguments ?? "{}"),
      }),
    );

    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };

    log.debug(
      { model: request.model, usage, latency: Math.round(latency) },
      "Local completion",
    );

    return {
      content,
      toolCalls,
      usage,
      stopReason:
        choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
      latency,
      model: request.model,
    };
  }

  /**
   * Ollama also supports embeddings via nomic-embed-text or similar.
   */
  async embedText(texts: string[]): Promise<Float32Array[]> {
    if (this.backend !== "ollama") {
      throw new Error("Embeddings only supported via Ollama backend");
    }

    const results: Float32Array[] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: text }),
      });

      if (!res.ok) {
        throw new Error(`Ollama embedding error: ${res.status}`);
      }

      const data = await res.json() as any;
      const embedding = data.embeddings?.[0] ?? [];
      results.push(new Float32Array(embedding));
    }

    return results;
  }
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
