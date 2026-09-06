import type {
  PiConversationAssistantMessage,
  PiConversationMessage,
} from "../../src/conversation/pi-conversation-message";

const code = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`).join(
  "\n",
);
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="gray"/></svg>')}`;

/** Deterministic, network-free history shared by projection and browser benchmarks. */
export function longConversation(count: number): PiConversationMessage[] {
  return Array.from({ length: count }, (_, index): PiConversationMessage => {
    const base = {
      id: `message-${index}`,
      createdAt: new Date(1_725_000_000_000 + index * 60_000),
    };
    if (index % 2 === 0) {
      return {
        ...base,
        role: "user",
        content: [{ type: "text", text: `Question ${index}: explain the result. 请说明结果。` }],
        attachments: [],
        metadata: { custom: {} },
      };
    }
    const content: PiConversationAssistantMessage["content"][number][] = [
      {
        type: "text",
        text: `Answer ${index}\n\n${"A stable historical paragraph. 历史内容保持稳定。 ".repeat(12)}`,
      },
    ];
    if (index % 10 === 9) {
      content.push({ type: "text", text: `\n\n\`\`\`typescript\n${code}\n\`\`\`` });
      content.push({
        type: "tool-call",
        toolCallId: `tool-${index}`,
        toolName: "read",
        args: { path: "example.ts" },
        argsText: '{"path":"example.ts"}',
        result: "result ".repeat(512),
      });
    }
    if (index % 50 === 49) content.push({ type: "image", image });
    if (index === 51) {
      content.push({ type: "text", text: "Extended output. ".repeat(3_125) });
      for (let tool = 0; tool < 100; tool++) {
        content.push({
          type: "tool-call",
          toolCallId: `large-${tool}`,
          toolName: "read",
          args: { path: `file-${tool}` },
          argsText: "{}",
          result: `Result ${tool}`,
        });
      }
    }
    if (content.length > 1)
      content.push({
        type: "text",
        text: `Final answer ${index}. ${"Result confirmed. ".repeat(30)}`,
      });
    return {
      ...base,
      role: "assistant",
      content,
      status: { type: "complete", reason: "stop" },
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {},
      },
    };
  });
}

export function appendConversationDelta(messages: readonly PiConversationMessage[], delta: string) {
  const last = messages.at(-1);
  if (last?.role !== "assistant") throw new Error("Benchmark history must end with an assistant");
  const final = last.content.at(-1);
  if (final?.type !== "text") throw new Error("Benchmark assistant must end with text");
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      content: [...last.content.slice(0, -1), { ...final, text: final.text + delta }],
    },
  ] satisfies PiConversationMessage[];
}
