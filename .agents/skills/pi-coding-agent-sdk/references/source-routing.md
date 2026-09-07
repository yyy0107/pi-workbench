# Pi Coding Agent SDK source routing

Use this map to answer two different questions correctly:

1. What API can Workbench compile against now?
2. Where is that API implemented in the Pi monorepo?

## Source-of-truth order

For Workbench implementation, use this order:

1. `package.json` for the declared `@earendil-works/pi-coding-agent` version.
2. `node_modules/@earendil-works/pi-coding-agent/package.json` for the resolved version and public `exports` map.
3. `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` and referenced declarations for the exact installed API.
4. `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` and `docs/extensions.md` for documentation bundled with that version.
5. `/home/wy/projects/pi/packages/coding-agent/src/` for implementation reasoning and upstream changes.

Do not reverse steps 3 and 5. The local Pi checkout can be ahead of or behind the package installed by Workbench.

## Pi monorepo ownership map

All extension interfaces discussed by this skill belong to the Pi package:

```text
packages/coding-agent
```

Important source files under `/home/wy/projects/pi/packages/coding-agent/`:

| Concern                                         | Source                                     |
| ----------------------------------------------- | ------------------------------------------ |
| Public package exports                          | `src/index.ts`                             |
| High-level session SDK                          | `src/core/sdk.ts`                          |
| Split service/session construction              | `src/core/agent-session-services.ts`       |
| Session binding and reload                      | `src/core/agent-session.ts`                |
| Resource discovery and inline factories         | `src/core/resource-loader.ts`              |
| Extension public re-exports                     | `src/core/extensions/index.ts`             |
| Extension API, events, factories, loaded result | `src/core/extensions/types.ts`             |
| File/factory loading and runtime creation       | `src/core/extensions/loader.ts`            |
| Event dispatch and core/UI binding              | `src/core/extensions/runner.ts`            |
| Converting registered tools to agent tools      | `src/core/extensions/wrapper.ts`           |
| SDK guide                                       | `docs/sdk.md`                              |
| Extension guide                                 | `docs/extensions.md`                       |
| Executable patterns                             | `examples/sdk/` and `examples/extensions/` |

`InlineExtension` and `LoadExtensionsResult` are defined in `src/core/extensions/types.ts`, re-exported through `src/core/extensions/index.ts`, then through `src/index.ts` as part of `@earendil-works/pi-coding-agent`.

They are coding-agent concerns, not `@earendil-works/pi-agent-core` types.

## Workbench integration map

Inspect these repository paths before adding a new abstraction:

| Concern                                     | Workbench path                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Embedded runtime contract and architecture  | `packages/agent-runtime/runtimes/pi/README.md`                               |
| Session/service construction and binding    | `packages/agent-runtime/runtimes/pi/server/src/sessions/session-registry.ts` |
| Host-owned inline extensions                | `packages/agent-runtime/runtimes/pi/server/src/internal-extensions/`         |
| User extension listing/mutation             | `packages/agent-runtime/runtimes/pi/server/src/extensions/`                  |
| Installed Pi package management             | `packages/agent-runtime/runtimes/pi/server/src/packages/`                    |
| Browser-facing unary types                  | `packages/agent-runtime/runtimes/pi/protocol/src/rpc.ts`                     |
| Browser-facing stream types                 | `packages/agent-runtime/runtimes/pi/protocol/src/stream.ts`                  |
| Workbench conversation and capability DTOs  | `packages/agent-runtime/core/contracts/src/`                                 |
| Workbench Headless Agent Runtime contract   | `packages/agent-runtime/core/runtime/src/runtime.ts`                         |
| Workbench capability contracts and errors   | `packages/agent-runtime/core/client/src/capabilities.ts`                     |
| Pi session and conversation projection      | `packages/agent-runtime/runtimes/pi/client/src/runtime/session.ts`           |
| Pi-to-Workbench capability/error projection | `packages/agent-runtime/runtimes/pi/client/src/integration/capabilities.ts`  |
| Terminal-owned Pi bash `ToolDefinition`     | `packages/terminal/pi-tool/src/`                                             |
| Terminal sessions and native process owner  | `packages/terminal/server/src/`                                              |

Search before editing:

```bash
rg -n '@earendil-works/pi-coding-agent|extensionFactories|bindExtensions|extensionsOverride' packages/agent-runtime/runtimes/pi apps/runtime-node/src apps/web/src/server
rg -n 'export (type|interface|class|function).*<Name>|<Name>' node_modules/@earendil-works/pi-coding-agent/dist
rg -n '<Name>' /home/wy/projects/pi/packages/coding-agent/src /home/wy/projects/pi/packages/coding-agent/docs
```

Replace `<Name>` with the actual symbol or event. Prefer `rg` over directory-wide manual browsing.

## Public import rule

In Pi 0.85.1, the published SDK uses the modular root; `./rpc-entry` resolves to
`dist/bundle/rpc-entry.js`. The `./client` and `./experimental/plugin` entries have only a
`source` condition for upstream development, not a published runtime import. Workbench embeds
the root SDK and provides its own HTTP/WebSocket host. Declarations below `dist/core/**` are
useful for inspection but are not supported import paths.

Use:

```ts
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionFactory,
  InlineExtension,
  LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
```

Do not use:

```ts
import type { InlineExtension } from "@earendil-works/pi-coding-agent/dist/core/extensions/types";
```
