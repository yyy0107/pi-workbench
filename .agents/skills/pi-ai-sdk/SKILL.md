---
name: pi-ai-sdk
description: Use when changing Pi AI model/provider APIs, authentication, message streams, or image requests in Workbench. Coding-agent sessions and extensions belong to pi-coding-agent-sdk unless the change also touches Pi AI.
---

# Pi AI SDK

Use Pi AI as the provider-neutral model, message, streaming, tool-schema, authentication, and image-generation layer. Reuse Workbench's existing `ModelRuntime` and transport ownership unless the task genuinely needs an isolated Pi AI collection.

## Load the right context

1. Follow the repository `AGENTS.md` and applicable nested instructions; reuse instructions already read and unchanged.
2. For model, provider, auth, session stream, attachment, or browser transport changes, locate and read the relevant sections of `packages/agent-runtime/runtimes/pi/README.md`. Read additional sections only for unresolved ownership or behavior questions.
3. Read [references/source-routing.md](references/source-routing.md) before choosing an import. Resolve the installed package version and export map first.
4. Read [references/models-providers-auth.md](references/models-providers-auth.md) for model lookup, provider composition, custom providers, dynamic catalogs, authentication, or reasoning options.
5. Read [references/messages-streams-tools-images.md](references/messages-streams-tools-images.md) for contexts, message/event protocols, reducers, tool calls, image input, or image generation.
6. Also use `pi-coding-agent-sdk` when the change constructs a coding-agent session, uses `ModelRuntime`, or registers a Pi extension. If the task touches remaining assistant-ui compatibility code, follow [`docs/assistant-ui-removal-and-custom-runtime-plan.md`](../../../docs/assistant-ui-removal-and-custom-runtime-plan.md) and do not expand that surface.

## Follow the implementation workflow

### 1. Establish the active API

- Inspect `package.json`, the resolved `node_modules/@earendil-works/pi-ai/package.json`, and its `exports` map.
- Treat the installed `dist/*.d.ts` and bundled `README.md` as authoritative for Workbench compilation.
- Use `/home/wy/projects/pi/packages/ai/src/` to understand implementation or upstream ownership, but account for version drift.
- Import only from documented exports: the root, `providers/*`, `api/*`, `utils/*`, `oauth`, `bedrock-provider`, or `bun-oauth`. Never import `dist/**`.
- Avoid `@earendil-works/pi-ai/compat` in new code; it is the legacy global registry surface.

### 2. Choose the owning runtime

- In normal Workbench product code, reuse the coding-agent `ModelRuntime` obtained from `createAgentSessionServices()`. It owns configured providers, credentials, model overrides, availability, and session request behavior.
- Use root Pi AI types and pure helpers where Workbench contracts or reducers need the canonical shape.
- Use `createModels()` only for an isolated SDK consumer, a custom host component with independent ownership, or a focused test.
- Use a provider-specific factory under `providers/<id>` when only a small provider set is needed. Use `providers/all` only when the complete built-in catalog is intentional.
- Do not treat `builtinProviders()` as configured/authenticated runtime state; it returns fresh provider definitions.

### 3. Preserve type and stream semantics

- Keep `Model<TApi>` narrowed with `hasApi()` before passing API-specific options.
- Distinguish `AssistantMessageEvent` from serialized `PiMessagesEvent`; they are related but not interchangeable.
- Consume streams as `AsyncIterable` events and obtain the final message through `stream.result()`.
- Associate all text, thinking, and tool-call updates by `contentIndex`. Do not assume blocks are contiguous.
- Treat partial tool arguments as incomplete. Validate only the completed `ToolCall` against its TypeBox schema.
- Interpret request failures through terminal stream events and the final `AssistantMessage.stopReason`; reserve thrown-error handling for APIs that document rejection, such as auth resolution or argument validation.

### 4. Preserve the Workbench boundary

- Keep provider credentials, OAuth, Bedrock, dynamic catalog refreshes, and real model requests on the server.
- It is acceptable for shared/client code to import canonical types or browser-safe pure utilities such as `parseStreamingJson` when the current bundle supports them, as `packages/agent-runtime/runtimes/pi/shared/src/messages.ts` does.
- Expose only validated, JSON-compatible subsets through Workbench RPC/stream contracts. Do not send `Models`, `Provider`, credential stores, event-stream instances, callbacks, or secrets to the browser.
- Reuse the existing durable compact `PiMessagesEvent` chunk protocol and final `message_end` correction instead of creating a second token stream; `session/message-update` is read only for rolling compatibility.
- Keep `@earendil-works/pi-ai` in `next.config.ts` server externals unless a deliberate bundling change is required and verified.

## Validate proportionally

- For imports and types, verify the installed declaration and run the cheapest relevant TypeScript check.
- For reducers or stream contracts, run their focused tests with interleaved content blocks, partial tool JSON, terminal events, and reconnect state as applicable.
- For model/provider/auth service changes, use structural fakes or Pi AI's `fauxProvider()`; do not make real paid provider requests.
- For custom provider behavior, test abort, auth failure, error-result, and dynamic refresh paths relevant to the change.
- Do not open a browser unless a concrete browser-bundling or live stream synchronization uncertainty remains.

## Guardrails

- Prefer Pi AI's `Models`, provider factories, message types, event stream, validation helpers, and image collections over parallel abstractions.
- Never copy the generated model catalog or edit `/home/wy/projects/pi/packages/ai/src/models.generated.ts` directly.
- Never persist API keys in browser-visible Workbench state, logs, RPC errors, or snapshots.
- Never use direct `api/*` calls when provider-owned auth and routing are required; direct API calls bypass collection auth.
- Never assume `contextWindow` controls output length; `maxTokens` is separate output metadata/request behavior.
- Preserve unrelated worktree changes in `packages/agent-runtime/runtimes/pi/server/src/models/`, protocol stream contracts, and shared message reducers.
