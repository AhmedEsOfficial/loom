import type {
  CompletionRequest,
  CompletionResponse,
  ToolCall,
} from "../types/conductor.js";
import { createLogger } from "../util/logger.js";
import { BaseProvider } from "./provider.js";

const log = createLogger("conductor");

/**
 * Local provider for OpenAI-compatible endpoints (vLLM, llama.cpp, Ollama, etc.)
 */
export class LocalProvider extends BaseProvider {
  readonly name = "local";
  readonly supportsPromptCaching = false;
  readonly supportedModels: string[] = [];

  private baseUrl: string;

  constructor(baseUrl?: string) {
    super();
    this.baseUrl = baseUrl ?? process.env["LOCAL_MODEL_URL"] ?? "http://localhost:8000/v1";
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
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
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
