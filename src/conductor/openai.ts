import OpenAI from "openai";
import type {
  CompletionRequest,
  CompletionResponse,
  ToolCall,
  ToolDefinition,
} from "../types/conductor.js";
import { createLogger } from "../util/logger.js";
import { BaseProvider } from "./provider.js";

const log = createLogger("conductor");

export class OpenAIProvider extends BaseProvider {
  readonly name = "openai";
  readonly supportsPromptCaching = false;
  readonly supportedModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
    "text-embedding-3-small",
    "text-embedding-3-large",
  ];

  private client: OpenAI;

  constructor(apiKey?: string, baseUrl?: string) {
    super();
    this.client = new OpenAI({
      apiKey: apiKey ?? process.env["OPENAI_API_KEY"],
      baseURL: baseUrl,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const [response, latency] = await this.measureLatency(async () => {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];

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

        if (msg.role === "tool" && msg.toolCallId) {
          messages.push({
            role: "tool",
            tool_call_id: msg.toolCallId,
            content,
          });
        } else {
          messages.push({
            role: msg.role as "user" | "assistant",
            content,
          });
        }
      }

      const tools = request.tools?.map(toOpenAITool);

      return this.client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        messages,
        tools,
        stop: request.stopSequences,
      });
    });

    const choice = response.choices[0]!;
    const content = choice.message.content ?? "";
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(
      (tc) => ({
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
      "OpenAI completion",
    );

    return {
      content,
      toolCalls,
      usage,
      stopReason: mapStopReason(choice.finish_reason),
      latency,
      model: response.model,
    };
  }

  async embedText(texts: string[]): Promise<Float32Array[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });

    return response.data.map(
      (d) => new Float32Array(d.embedding),
    );
  }
}

function toOpenAITool(
  tool: ToolDefinition,
): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as any,
    },
  };
}

function mapStopReason(
  reason: string | null,
): CompletionResponse["stopReason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}
