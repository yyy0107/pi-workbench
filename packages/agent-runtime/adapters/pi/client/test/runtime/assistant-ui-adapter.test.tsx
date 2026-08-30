import assert from "node:assert/strict";
import test from "node:test";

import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PiAssistantMessage } from "@workbench/agent-runtime-pi-protocol/messages";
import { piAssistantToThreadMessage } from "../../src/messages/messages";

function AssistantMessageProbe() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts>
        {({ part }) =>
          part.type === "tool-call" ? (
            <output
              data-args={JSON.stringify(part.args)}
              data-args-text={part.argsText}
              data-tool-name={part.toolName}
            />
          ) : null
        }
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function AssistantUiBoundary({ messages }: Readonly<{ messages: readonly ThreadMessage[] }>) {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: true,
    onNew: async () => undefined,
  });
  return createElement(
    AssistantRuntimeProvider,
    { runtime },
    createElement(ThreadPrimitive.Messages, {
      components: { Message: AssistantMessageProbe },
    }),
  );
}

test("renders Pi partial tool arguments through the public assistant-ui boundary", () => {
  const rawToolArgsText = '{"query":"hel';
  const message: PiAssistantMessage = {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tool-1",
        name: "search",
        arguments: { query: "hel" },
      },
    ],
  };
  const projected = piAssistantToThreadMessage(message, "assistant-1", {
    streaming: true,
    rawToolArgsText: { "0": rawToolArgsText },
  });

  const markup = renderToStaticMarkup(
    createElement(AssistantUiBoundary, { messages: [projected] }),
  );

  assert.match(markup, /data-tool-name="search"/);
  assert.match(markup, /data-args="\{&quot;query&quot;:&quot;hel&quot;\}"/);
  assert.match(markup, /data-args-text="\{&quot;query&quot;:&quot;hel"/);
  assert.doesNotMatch(markup, /data-args-text="\{&quot;query&quot;:&quot;hel&quot;\}"/);
});
