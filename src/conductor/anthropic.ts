import Anthropic from "@anthropic-ai/sdk";
import type {
  CompletionRequest,
  CompletionResponse,
  ToolCall,
  ToolDefinition,
} from "../types/conductor.js";
import { createLogger } from "../util/logger.js";
import { BaseProvider } from "./provider.js";

const log = createLogger("conductor");

export class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic";
  readonly supportsPromptCaching = true;
  readonly supportedModels = [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250514",
  ];

  private client: Anthropic;

  constructor(apiKey?: string) {
    super();
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env["ANTHROPIC_API_KEY"],
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const [response, latency] = await this.measureLatency(async () => {
      const messages = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content:
            typeof m.content === "string"
              ? m.content
              : m.content.map((b) => {
                  if (b.type === "text") {
                    return {
                      type: "text" as const,
                      text: b.text ?? "",
                      ...(b.cacheControl
                        ? { cache_control: b.cacheControl }
                        : {}),
                    };
                  }
                  if (b.type === "tool_use") {
                    return {
                      type: "tool_use" as const,
                      id: b.toolUseId ?? "",
                      name: b.toolName ?? "",
                      input: b.toolInput ?? {},
                    };
                  }
                  if (b.type === "tool_result") {
                    return {
                      type: "tool_result" as const,
                      tool_use_id: b.toolUseId ?? "",
                      content: b.text ?? "",
                    };
                  }
                  return { type: "text" as const, text: "" };
                }),
        }));

      const tools = request.tools?.map(toAnthropicTool);

      return this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: messages as any,
        tools: tools as any,
        stop_sequences: request.stopSequences,
      });
    });

    // Extract text and tool calls from response
    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheHits: (response.usage as any).cache_read_input_tokens,
    };

    log.debug(
      { model: request.model, usage, latency: Math.round(latency) },
      "Anthropic completion",
    );

    return {
      content,
      toolCalls,
      usage,
      stopReason: mapStopReason(response.stop_reason),
      latency,
      model: response.model,
    };
  }
}

function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function mapStopReason(
  reason: string | null,
): CompletionResponse["stopReason"] {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}
