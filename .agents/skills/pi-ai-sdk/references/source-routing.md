# Pi AI source routing

## Source-of-truth order

For Workbench code, resolve the API in this order:

1. `package.json` for the declared `@earendil-works/pi-ai` version.
2. `node_modules/@earendil-works/pi-ai/package.json` for the resolved version and supported subpaths.
3. `node_modules/@earendil-works/pi-ai/dist/index.d.ts` plus referenced declarations for the exact installed surface.
4. `node_modules/@earendil-works/pi-ai/README.md` for documentation bundled with that version.
5. `/home/wy/projects/pi/packages/ai/src/` and its tests for implementation reasoning and upstream changes.

The local Pi checkout may be newer or older than Workbench's dependency. Do not code against a source-only symbol until the installed package exports it.

## Package ownership map

Pi AI belongs to:

```text
/home/wy/projects/pi/packages/ai
```

| Concern                              | Pi source                                                   |
| ------------------------------------ | ----------------------------------------------------------- |
| Public root exports                  | `src/index.ts`                                              |
| Core API/model/message/tool types    | `src/types.ts`                                              |
| Provider collection and dispatch     | `src/models.ts`                                             |
| Dynamic catalog persistence          | `src/models-store.ts`                                       |
| Generated static catalog helpers     | `src/model-catalog.ts`, `src/models.generated.ts`           |
| Built-in provider catalog entrypoint | `src/providers/all.ts`                                      |
| Provider factories                   | `src/providers/<provider>.ts`                               |
| Provider model definitions/data      | `src/providers/<provider>.models.ts`, `src/providers/data/` |
| Wire API implementations             | `src/api/<api>.ts`                                          |
| Lazy API wrappers                    | `src/api/<api>.lazy.ts`                                     |
| Pi Messages wire protocol            | `src/api/pi-messages.ts`                                    |
| Auth resolution and stores           | `src/auth/`                                                 |
| Image-generation collections         | `src/images-models.ts`                                      |
| Event stream implementation          | `src/utils/event-stream.ts`                                 |
| Partial JSON parsing                 | `src/utils/json-parse.ts`                                   |
| Tool argument validation             | `src/utils/validation.ts`                                   |
| Test-only scripted provider          | `src/providers/faux.ts`                                     |
| Public guide                         | `README.md`                                                 |

Do not edit `src/models.generated.ts` directly. Upstream catalog work changes the generator/data inputs and regenerates the output.

## Workbench ownership map

| Concern                                 | Workbench path                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pi dependency and version               | `package.json`, `pnpm-lock.yaml`                                                         |
| Next server externalization             | `next.config.ts`                                                                         |
| Product model/provider/auth adapter     | `packages/agent-runtime/adapters/pi/server/src/models/model-service.ts`                  |
| Coding-agent model runtime construction | `packages/agent-runtime/adapters/pi/server/src/sessions/session-registry.ts`             |
| Browser-facing model RPC types          | `packages/agent-runtime/adapters/pi/protocol/src/rpc.ts`                                 |
| Compact streamed-message wire types     | `packages/agent-runtime/adapters/pi/protocol/src/stream.ts`                              |
| Immutable message delta reducer         | `packages/agent-runtime/adapters/pi/shared/src/messages.ts`                              |
| Server stream compaction/snapshots      | `packages/agent-runtime/adapters/pi/server/src/sessions/session-registry.ts`             |
| Client stream accumulation              | `packages/agent-runtime/adapters/pi/client/src/transport/session-message-accumulator.ts` |
| Multimodal model selection              | `packages/agent-runtime/adapters/pi/server/src/attachment-understanding/multimodal.ts`   |

Search before adding an abstraction:

```bash
rg -n '@earendil-works/pi-ai|PiMessagesEvent|parseStreamingJson|builtinProviders' packages/agent-runtime/adapters/pi next.config.ts
rg -n '<Symbol>' node_modules/@earendil-works/pi-ai/dist node_modules/@earendil-works/pi-ai/README.md
rg -n '<Symbol>' /home/wy/projects/pi/packages/ai/src /home/wy/projects/pi/packages/ai/test
```

Replace `<Symbol>` with the actual type, function, API id, or provider id.

## Import routing

Use the root for shared types and collection utilities:

```ts
import {
  createModels,
  hasApi,
  parseStreamingJson,
  Type,
  validateToolCall,
} from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  Context,
  Model,
  PiMessagesEvent,
  Tool,
} from "@earendil-works/pi-ai";
```

Use provider subpaths deliberately:

```ts
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
```

Use API subpaths only for direct/custom-provider wire implementations:

```ts
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
```

Never use:

```ts
import type { Model } from "@earendil-works/pi-ai/dist/types";
```

`@earendil-works/pi-ai/compat` preserves the old global API and pulls a broad catalog surface. Keep it for migration only, not new integrations.
