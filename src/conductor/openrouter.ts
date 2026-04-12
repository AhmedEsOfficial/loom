import type {
  CompletionRequest,
  CompletionResponse,
  ToolCall,
} from "../types/conductor.js";
import { createLogger } from "../util/logger.js";
import { BaseProvider } from "./provider.js";

const log = createLogger("conductor");

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterProvider extends BaseProvider {
  readonly name = "openrouter";
  readonly supportsPromptCaching = false;
  readonly supportedModels: string[] = []; // Dynamic — accepts any model path

  private apiKey: string;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey ?? process.env["OPENROUTER_API_KEY"] ?? "";
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
        temperature: request.temperature,
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

      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/loom-harness",
          "X-Title": "Loom Harness",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenRouter API error ${res.status}: ${text}`);
      }

      return res.json() as Promise<any>;
    });

    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map(
      (tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      }),
    );

    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };

    log.debug(
      { model: request.model, usage, latency: Math.round(latency) },
      "OpenRouter completion",
    );

    return {
      content,
      toolCalls,
      usage,
      stopReason:
        choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
      latency,
      model: response.model ?? request.model,
    };
  }
}
