# Messages, streams, tools, and images

## Contents

- [Build serializable contexts](#build-serializable-contexts)
- [Consume AssistantMessageEvent streams](#consume-assistantmessageevent-streams)
- [Handle Pi Messages wire events](#handle-pi-messages-wire-events)
- [Handle tool calls](#handle-tool-calls)
- [Use image input or image generation](#use-image-input-or-image-generation)
- [Test without provider calls](#test-without-provider-calls)

## Build serializable contexts

`Context` contains an optional system prompt, messages, and optional tool schemas:

```ts
const context: Context = {
  systemPrompt: "Answer precisely.",
  messages: [
    {
      role: "user",
      content: "Explain the result.",
      timestamp: Date.now(),
    },
  ],
  tools,
};
```

Message roles are `user`, `assistant`, and `toolResult`. Assistant content blocks are `text`, `thinking`, or `toolCall`; user/tool-result content can contain text and images.

Contexts and models are plain serializable data, but Workbench should still use its canonical session history/contracts rather than inventing a second persistence format.

Do not drop provider continuity fields such as response ids, thinking signatures, text signatures, or tool-call ids when replaying a message unless the owning adapter explicitly transforms them.

## Consume AssistantMessageEvent streams

`models.stream()` and `models.streamSimple()` return `AssistantMessageEventStream`, which is both an `AsyncIterable` and a final-result holder:

```ts
const stream = models.streamSimple(model, context, {
  reasoning: "medium",
  signal,
});

for await (const event of stream) {
  switch (event.type) {
    case "text_delta":
      applyTextDelta(event.contentIndex, event.delta);
      break;
    case "toolcall_end":
      handleCompletedToolCall(event.toolCall);
      break;
    case "error":
      reportMessageError(event.error);
      break;
  }
}

const message = await stream.result();
```

Stream invariants:

- `start` precedes partial updates.
- `done` or `error` is terminal.
- Text, thinking, and tool-call events may interleave; always route by `contentIndex`.
- The event's `partial` message is cumulative but should not be serialized into Workbench's compact delta channel on every token.
- Request failures do not normally throw from the stream; inspect the terminal event and final `AssistantMessage.stopReason`.
- `complete()` and `completeSimple()` consume the stream and return the same final message, including error/aborted results.

Use `streamSimple()` for provider-neutral reasoning levels. Use `stream()` plus `hasApi()` when provider-specific options are required.

## Handle Pi Messages wire events

`PiMessagesEvent` is the serialized event protocol used by a Pi Messages backend. Unlike `AssistantMessageEvent`, compact delta events do not carry cumulative `partial` messages.

Workbench reuses the content-event subset:

```ts
type SessionMessageDelta = Exclude<PiMessagesEvent, { type: "start" | "done" | "error" }>;
```

Preserve the existing Workbench protocol:

- `message_start` is the durable empty baseline.
- canonical `message_update` carries packed durable deltas with a session `seq`, `streamId`, `startSeq`, and a contiguous `firstRevision..revision` range.
- adjacent text, thinking, and tool-call argument fragments may be concatenated inside one chunk; apply the declared updates in order, then advance to its ending revision.
- `session/message-snapshot` restores active materialized content plus raw partial tool JSON as a reconnect bootstrap optimization; journal replay remains authoritative.
- durable `message_end` is the authoritative final correction.
- revisions are monotonic within one stream generation; a gap invalidates that generation.
- legacy transient `session/message-update` payloads remain a client-side rolling-upgrade input, not the current producer path.

Do not substitute raw `AssistantMessageEvent` objects into this contract. Workbench validates the Pi Messages subset at the boundary and deliberately excludes terminal wire events from durable chunks.

## Handle tool calls

Define tools with TypeBox schemas from the Pi AI root. Prefer `StringEnum()` over `Type.Enum()` for cross-provider compatibility, especially Google APIs.

Tool-call arguments are untrusted at every stage:

- During `toolcall_delta`, fields may be missing, truncated, or structurally incomplete.
- `parseStreamingJson()` is best-effort UI state, not validation.
- Keep the raw JSON buffer per `contentIndex`; parsed objects cannot be concatenated with later fragments.
- On `toolcall_end`, clear the raw buffer and use the completed `ToolCall`.
- Before execution, call `validateToolCall(tools, toolCall)` or `validateToolArguments(tool, toolCall)` and handle validation failure as a tool error result.

Pi AI's `Tool` describes what the model can call; it does not own execution. In Workbench, execution belongs to the coding-agent tool/runtime layer. Use the `pi-coding-agent-sdk` skill when registering or executing a coding-agent tool.

Tool results must retain the matching `toolCallId` and `toolName`, set `isError`, and use text/image content blocks. Never execute a partial tool call.

## Use image input or image generation

These are different surfaces:

| Need                                    | API                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Ask a chat model to understand an image | Add `ImageContent` to a chat `Context`; require `model.input.includes("image")` |
| Generate or transform an image          | Use an `ImagesModels` collection and `generateImages()`                         |

Image generation does not use the chat stream or tool-calling APIs:

```ts
import { builtinImagesModels } from "@earendil-works/pi-ai/providers/all";

const images = builtinImagesModels();
const model = images.getModel("openrouter", modelId);
if (!model) throw new Error("Image model not found");

const result = await images.generateImages(model, {
  input: [{ type: "text", text: prompt }],
});
```

Check both `model.input` and `model.output`. Image generation returns `AssistantImages`; failures are represented with `stopReason: "error"` rather than chat events.

Keep image bytes/base64 size limits, MIME validation, provider credentials, and real generation requests on the server. Use Workbench's existing attachment/image-understanding paths for chat input rather than bypassing them.

## Test without provider calls

Use Pi AI's scripted faux provider for collection and stream behavior:

```ts
import { createModels, fauxProvider } from "@earendil-works/pi-ai";

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
```

Use structural fakes when testing Workbench's `ModelRuntimeLike` adapter. Add targeted reducer/contract fixtures for:

- interleaved `contentIndex` events;
- partial and malformed tool JSON;
- `done`, `error`, and abort behavior;
- revision gaps and duplicate revisions;
- reconnect snapshots with raw tool-call buffers;
- final durable message correction.

Do not require environment API keys, OAuth login, network access, or paid model calls in project tests.
