import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { convertToModelMessages, streamText } from "ai";

const custom = createOpenAICompatible({
  name: "custom",
  apiKey: process.env.CUSTOM_API_KEY,
  baseURL: process.env.CUSTOM_BASE_URL!,
});

export async function POST(req: Request) {
  const { messages, system, tools, config } = await req.json();

  const result = streamText({
    model: custom(config?.modelName ?? process.env.CUSTOM_MODEL!),
    system,
    messages: await convertToModelMessages(messages),
    tools: frontendTools(tools),
    providerOptions: {
      "openai-compatible":
        config?.reasoningEffort !== undefined
          ? { reasoningEffort: config.reasoningEffort }
          : {},
    },
  });

  return result.toUIMessageStreamResponse();
}
