# Packages 导航

先按职责找目录，再按能力找包。叶目录名始终等于 `@workbench/` 后的包名；跨包通过 `package.json` 的 `exports` 导入。

| 你要做什么                                                    | 从哪里开始                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| 接入 Pi SDK：模型、会话、资源加载                             | [pi-sdk](pi-sdk/README.md)                                           |
| 将 Pi 接到 Workbench：客户端、服务端、RPC、会话投影与工具适配 | [pi-runtime](pi-runtime/README.md)                                   |
| 修改 Pi 专属界面、扩展贡献和词典                              | [pi-ui](pi-ui/README.md)                                             |
| 选择内置 Skills、Prompts、默认扩展及安装顺序                  | [product](product/README.md)                                         |
| 找通用 Agent 抽象、客户端能力合同和服务端执行端口             | `agent-runtime/agent-runtime-{core,contracts,client,server,testkit}` |
| 找可复用 UI、Shell、设置与外观能力                            | `client/ui-*`、`client/shell`、`client/settings-*`                   |
| 找工作区状态、目录、文件与 Git 能力                           | `workspace/`；工作区界面在 `client/ui-workspace`                     |
| 找通用扩展 SDK、安装与 Host 生命周期                          | `extension-platform/`                                                |
| 找连接认证、Runtime Host 和宿主适配                           | `host/`；浏览器端 Host 能力在 `client/host-*`                        |
| 找通用 RPC/HTTP 基础能力                                      | `transport/api`（Pi 协议在 `pi-runtime/pi-rpc-contracts`）           |
| 找业务 DTO 和公共服务                                         | `contracts/`、`server/`                                              |
| 找 PTY、终端连接与合同                                        | `terminal/`；Pi 工具适配在 `pi-runtime/pi-runtime-terminal`          |
| 找可复用测试支持                                              | `test-support/`、`agent-runtime/agent-runtime-testkit`               |

`agent-runtime` 是 Workbench 的通用抽象；实际 Pi SDK 接入在 `pi-sdk`。这次名称整理保持现有依赖关系：三类 Pi 目录表达职责，并不宣称严格单向依赖。SDK 实现仍使用 `pi-rpc-contracts` 和纯数据适配器；后续若解耦传输 DTO，应另立行为重构任务。

## Pi SDK 如何导入

Workbench 封装和上游 SDK 是两个入口。已有 Workbench 功能优先使用下面的封装；编写新的 SDK 接入时，从已安装的上游包公开入口取 API，不深导入其 `dist/` 私有实现。

```ts
// Node：Workbench 的 SDK 接入能力
import { createWorkbenchAgentSessionServices } from "@workbench/pi-sdk-models/services";
import { createPiSessionRegistry } from "@workbench/pi-sdk-sessions/registry";
// 产品默认扩展清单（工具实现由 pi-runtime-tools 提供）
import { createWorkbenchInternalPiExtensions } from "@workbench/pi-workbench-runtime/extensions";

// 浏览器：将 Pi 安装为 Workbench Runtime
import { createPiAgentRuntimeInstallation } from "@workbench/pi-runtime-client/installation";

// Node：将 SDK 能力装配到 Workbench Runtime Host
import { createPiAgentServerImplementation } from "@workbench/pi-runtime-server/installation";

// 上游 SDK 的公开 API（SDK 接入代码使用）
import {
  createAgentSessionServices,
  createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
```

这些是导入示例，创建实例时仍须提供对应入口声明的依赖。前端产品入口使用 `@workbench/pi-workbench/application` 与 `/installation`；Node 产品资源和扩展清单使用 `@workbench/pi-workbench-runtime/resources` 与 `/extensions`。浏览器代码不导入 Node SDK 会话或服务。部分包只有明确子路径，不能省略 `/installation`、`/registry` 等；所有导出见各包 manifest。

名称规则与旧名迁移见 [package-naming.md](../docs/package-naming.md) 和 [本轮映射](../docs/package-layout-map.json)。已有协议、扩展、工具、持久化和翻译 bundle ID 保持稳定。

## 全部库包

以下 97 个库包按当前目录列出。每个链接指向实际包目录，其 package.json exports 是公开入口的准确信息源。

| 包目录                                                                         | 职责                                                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [agent-runtime/agent-runtime-client](agent-runtime/agent-runtime-client)       | The browser-side React integration layer for Workbench. This package connects React UI to the                                                      |
| [agent-runtime/agent-runtime-contracts](agent-runtime/agent-runtime-contracts) | Workbench 拥有的、与具体 Agent Runtime 实现无关的数据 contracts。                                                                                  |
| [agent-runtime/agent-runtime-core](agent-runtime/agent-runtime-core)           | React-free browser Agent Runtime contracts and notification primitives. Concrete adapters own                                                      |
| [agent-runtime/agent-runtime-server](agent-runtime/agent-runtime-server)       | Workbench 拥有、由具体 Agent Runtime 在宿主服务端实现的通用端口。                                                                                  |
| [agent-runtime/agent-runtime-testkit](agent-runtime/agent-runtime-testkit)     | Workbench Agent Runtime 的跨实现契约测试与最小 fixture。这个包只服务开发、测试和 adapter                                                           |
| [client/appearance](client/appearance)                                         | Owns appearance preferences, theme selection, font stacks and the installation-scoped settings store. Consumer…                                    |
| [client/code-highlighting](client/code-highlighting)                           | Owns Shiki registration/caches, retained streaming tokenization, literal code surfaces, editor rendering and d…                                    |
| [client/desktop-contracts](client/desktop-contracts)                           | Desktop bridge, title bar and Runtime bootstrap contracts.                                                                                         |
| [client/host-client](client/host-client)                                       | Runtime HTTP and WebSocket transport carriers.                                                                                                     |
| [client/host-contracts](client/host-contracts)                                 | Runtime capabilities, connections and host control protocols.                                                                                      |
| [client/i18n](client/i18n)                                                     | Shared translation runtime and controlled React Provider. Locale identities come from @workbench/core-contract…                                    |
| [client/markdown](client/markdown)                                             | Install the shared i18n/settings Providers and the Markdown plus code-highlighting bundles. Product assembly s…                                    |
| [client/services-client](client/services-client)                               | Client APIs for settings, automation, host and workspace services.                                                                                 |
| [client/settings-runtime](client/settings-runtime)                             | Installation-scoped React settings port and disposable presentation resources. Import the public package entry…                                    |
| [client/shell](client/shell)                                                   | Shell context, settings and locale adapters, extension registries, runtime and navigation ports,                                                   |
| [client/shell-context](client/shell-context)                                   | Shared installation contexts for DOM IDs, navigation, presentation, immutable Runtime connections and running-…                                    |
| [client/ui](client/ui)                                                         | Shared primitive controls, semantic tokens, Portal ownership, clipboard, keyboard ownership and general hooks.…                                    |
| [client/ui-attachment](client/ui-attachment)                                   | Owns the ui-attachment capability, its real source, consumed helpers and local dictionaries. Public exports pr…                                    |
| [client/ui-automation](client/ui-automation)                                   | Owns automation implementation and its bilingual translation bundle. Consumers use the package exports. The pr…                                    |
| [client/ui-composer](client/ui-composer)                                       | Owns the rich input editor and its document, history, token, markdown, submission, and composer surface code.…                                     |
| [client/ui-conversation](client/ui-conversation)                               | Owns the top-level conversation route and session assembly: WorkbenchConversation, WorkbenchThread, the em…                                        |
| [client/ui-conversation-list](client/ui-conversation-list)                     | Owns the sidebar conversation catalog: workspace grouping, navigation, pinning, order persistence, moves and m…                                    |
| [client/ui-conversation-messages](client/ui-conversation-messages)             | Owns the ordered conversation flow, date grouping, message pairing, layout, viewport compensation, and persist…                                    |
| [client/ui-conversation-nodes](client/ui-conversation-nodes)                   | Owns conversation node selection and presentation, the message and steered-turn contexts, message actions and…                                     |
| [client/ui-disclosure](client/ui-disclosure)                                   | Owns shared disclosure layout compensation for expanding conversation content. It provides the scroll-directio…                                    |
| [client/ui-file-presentation](client/ui-file-presentation)                     | Owns reusable file icons and browser save/download primitives. The icons entry uses an explicitly installed F…                                     |
| [client/ui-input-trigger](client/ui-input-trigger)                             | Owns the ui-input-trigger capability, its real source, consumed helpers and local dictionaries. Public exports…                                    |
| [client/ui-layout](client/ui-layout)                                           | Workbench frame, header, sidebar frame, global layer, status bar, responsive layout lifecycle, and brand toggl…                                    |
| [client/ui-message-actions](client/ui-message-actions)                         | Owns message-actions UI, its extension, local dictionaries and consumed helpers. Source remains shallow TypeSc…                                    |
| [client/ui-message-blocks](client/ui-message-blocks)                           | Owns reusable conversation block renderers: text, file, image, source, tool/data blocks, command responses, er…                                    |
| [client/ui-message-queue](client/ui-message-queue)                             | Owns message-queue UI, its extension, local dictionaries and consumed helpers. Source remains shallow TypeScri…                                    |
| [client/ui-model-selection](client/ui-model-selection)                         | Owns model selection state, view, reasoning labels, store, and extension registration. Labels are provided by…                                     |
| [client/ui-panels](client/ui-panels)                                           | Workbench panel layout, dock chrome, resizing, and the bottom terminal drawer wrapper.                                                             |
| [client/ui-resize](client/ui-resize)                                           | Owns the shared Workbench resize capability: collapsible and proportional sizing hooks, the accessible resize…                                     |
| [client/ui-selectors](client/ui-selectors)                                     | Owns the shared searchable, animated, and workspace selector controls. Labels and validation copy                                                  |
| [client/ui-settings](client/ui-settings)                                       | Owns the shared settings container: the settings registry integration, main view, navigation sidebar, sidebar…                                     |
| [client/ui-settings-archived-chats](client/ui-settings-archived-chats)         | Owns archived-chats UI, its extension, local dictionaries and consumed helpers. Source remains shallow TypeScr…                                    |
| [client/ui-settings-general](client/ui-settings-general)                       | Contributes locale and conversation preference settings to the existing settings container. It does not own th…                                    |
| [client/ui-side-chat](client/ui-side-chat)                                     | Owns side-chat UI, its extension, local dictionaries and consumed helpers. Source remains shallow TypeScript;…                                     |
| [client/ui-sidebar](client/ui-sidebar)                                         | Owns generic sidebar providers, row/group primitives, pointer drag sessions and regional styles. Conversation…                                     |
| [client/ui-terminal](client/ui-terminal)                                       | Owns terminal implementation and its bilingual translation bundle. Consumers use the package exports. The prod…                                    |
| [client/ui-theme](client/ui-theme)                                             | Owns appearance settings, background effects, color selection, appearance state, and their scoped styles. Shel…                                    |
| [client/ui-todo](client/ui-todo)                                               | Owns Todo result adaptation, task list presentation, composer panel, tool renderer, and extension registration…                                    |
| [client/ui-token-usage](client/ui-token-usage)                                 | Owns token usage, context statistics, animation helpers, and the token usage extension. UI tests remain coloca…                                    |
| [client/ui-tool](client/ui-tool)                                               | Owns the ui-tool capability, its real source, consumed helpers and local dictionaries. Public exports preserve…                                    |
| [client/ui-user-message-index](client/ui-user-message-index)                   | Owns user-message-index UI, its extension, local dictionaries and consumed helpers. Source remains shallow Typ…                                    |
| [client/ui-user-questions](client/ui-user-questions)                           | Owns interactive user questions and tool approval presentation, including form state, Ask User parsing, overla…                                    |
| [client/ui-workspace](client/ui-workspace)                                     | Owns the React installation adapter, hooks, surface hosts, workspace tabs, feedback forms, resize behavior, pr…                                    |
| [contracts/automation-contracts](contracts/automation-contracts)               | Workbench 定时 Composer 提交的 JSON-safe DTO、协议与运行来源 parser。                                                                              |
| [contracts/browser-contracts](contracts/browser-contracts)                     | Browser commands, permissions, events, settings and input validation.                                                                              |
| [contracts/core-contracts](contracts/core-contracts)                           | Workbench 拥有的、跨浏览器与服务端边界使用的基础 JSON-safe contracts。                                                                             |
| [extension-platform/extension-host](extension-platform/extension-host)         | Extension installation, lifecycle, services, the command palette, and UI hosts.                                                                    |
| [extension-platform/extension-sdk](extension-platform/extension-sdk)           | Extension authoring contracts, registries and contribution points.                                                                                 |
| [host/host-artifact-policy](host/host-artifact-policy)                         | Build artifact admission for source shape, native dependencies and resources. Existing CommonJS build tooling…                                     |
| [host/host-server](host/host-server)                                           | Node-only HTTP and WebSocket ingress for a Workbench Runtime Host. The package accepts application-provided HT…                                    |
| [pi-runtime/pi-conversation-adapter](pi-runtime/pi-conversation-adapter)       | src owns canonical Pi message contracts, parsing, history/RPC projection, message accumulation, the observable…                                    |
| [pi-runtime/pi-rpc-client](pi-runtime/pi-rpc-client)                           | src owns Pi RPC/HTTP operations, installation transport snapshots and paired WebSocket generation/reconnect/wa…                                    |
| [pi-runtime/pi-rpc-contracts](pi-runtime/pi-rpc-contracts)                     | Pi Runtime 在浏览器、Workbench Host 与 Pi server implementation 之间共享的 JSON-safe wire contracts。                                              |
| [pi-runtime/pi-runtime-adapters](pi-runtime/pi-runtime-adapters)               | Pi Runtime 的 client/server 共用纯逻辑：Runtime 身份、命令投影、消息 reducer、模型能力与会话展示/                                                  |
| [pi-runtime/pi-runtime-browser](pi-runtime/pi-runtime-browser)                 | Browser Pi Package 与配套 browser-use 技能                                                                                                         |
| [pi-runtime/pi-runtime-client](pi-runtime/pi-runtime-client)                   | Pi 的浏览器侧 Headless Runtime 实现。                                                                                                              |
| [pi-runtime/pi-runtime-server](pi-runtime/pi-runtime-server)                   | Pi's Node-side Workbench Runtime implementation. This package owns Pi sessions, resources, models, stream                                          |
| [pi-runtime/pi-runtime-terminal](pi-runtime/pi-runtime-terminal)               | Terminal 服务到 Pi 工具的适配                                                                                                                      |
| [pi-runtime/pi-runtime-tools](pi-runtime/pi-runtime-tools)                     | Workbench 工具与内联扩展实现；产品清单在 pi-workbench-runtime                                                                                      |
| [pi-sdk/pi-sdk-models](pi-sdk/pi-sdk-models)                                   | src owns provider/model configuration, auth/catalog operations and protected SDK service construction; lib sup…                                    |
| [pi-sdk/pi-sdk-ports](pi-sdk/pi-sdk-ports)                                     | src defines Host/tool preferences, extension UI, narrow session access and stream publication contracts. lib p…                                    |
| [pi-sdk/pi-sdk-resources](pi-sdk/pi-sdk-resources)                             | SDK 资源加载、查询、启停、持久化和重载服务                                                                                                         |
| [pi-sdk/pi-sdk-sessions](pi-sdk/pi-sdk-sessions)                               | src owns hosted sessions, registries, journals, history, attachments, imports, automation and Agent adapters.…                                     |
| [pi-ui/pi-ui-diagnostics](pi-ui/pi-ui-diagnostics)                             | Owns context trace and usage-statistics surfaces. Internal helpers project traces, select/cache details, index…                                    |
| [pi-ui/pi-ui-extensions](pi-ui/pi-ui-extensions)                               | Pi Settings, Toolbox, Context Trace, External Session Import, Pi Version/Connection Status, and Pi                                                 |
| [pi-ui/pi-ui-session-import](pi-ui/pi-ui-session-import)                       | Owns external-session scanning and import selection UI. Internal helpers identify selected sessions and bound…                                     |
| [pi-ui/pi-ui-settings](pi-ui/pi-ui-settings)                                   | Owns Pi agent configuration settings, system and append prompt editors, dynamic prompt placeholders, cache-mis…                                    |
| [pi-ui/pi-ui-settings-models](pi-ui/pi-ui-settings-models)                     | Owns Pi provider and model configuration UI, draft normalization, credentials links, autosave, and test feedba…                                    |
| [pi-ui/pi-ui-status](pi-ui/pi-ui-status)                                       | Owns Pi About and connection/version status, plus all four persisted Pi activity indicators. Internal wordmark…                                    |
| [pi-ui/pi-ui-toolbox](pi-ui/pi-ui-toolbox)                                     | Owns Skills, Extensions, Packages and prompt management, skill-reading presentation and the Pi resource file b…                                    |
| [product/pi-workbench](product/pi-workbench)                                   | 前端产品组合、默认配置与界面安装顺序                                                                                                               |
| [product/pi-workbench-runtime](product/pi-workbench-runtime)                   | Node 产品内置资源、默认扩展清单、部署和升级策略                                                                                                    |
| [server/automation-server](server/automation-server)                           | Automation persistence, scheduling services and RPC.                                                                                               |
| [server/browser-server](server/browser-server)                                 | The shared browser engine for Workbench Web and Electron. The Runtime owns one lazily started                                                      |
| [server/local-host-server](server/local-host-server)                           | Local directories, pickers, application detection and open operations.                                                                             |
| [server/server-core](server/server-core)                                       | Workbench 服务端进程复用的 Node-only 基础能力，不属于任何具体 Agent Runtime。                                                                      |
| [server/settings-server](server/settings-server)                               | Settings persistence, updates and RPC.                                                                                                             |
| [server/workspace-server](server/workspace-server)                             | Workspace file, Git, HTTP and RPC services.                                                                                                        |
| [terminal/terminal-client](terminal/terminal-client)                           | Terminal WebSocket clients and connection URLs.                                                                                                    |
| [terminal/terminal-contracts](terminal/terminal-contracts)                     | Terminal frames, sessions and Bash tool input contracts.                                                                                           |
| [terminal/terminal-server](terminal/terminal-server)                           | requires their physical package roots to remain inside the repository-local pnpm virtual store.                                                    |
| [test-support/ui-testkit](test-support/ui-testkit)                             | React 生命周期测试共用的最小 DOM 环境，只用作开发依赖。通过包公开入口使用 installMinimalReactDomEnvironment 和 flushReactMicrotasks。它不实现浏览… |
| [transport/api](transport/api)                                                 | Use the explicit subpaths:                                                                                                                         |
| [workspace/workspace-artifact](workspace/workspace-artifact)                   | Owns workspace-artifact implementation and its bilingual translation bundle. Consumers use the package exports…                                    |
| [workspace/workspace-browser](workspace/workspace-browser)                     | Owns workspace-browser implementation and its bilingual translation bundle. Consumers use the package exports.…                                    |
| [workspace/workspace-directory-picker](workspace/workspace-directory-picker)   | Owns workspace-directory-picker implementation and its bilingual translation bundle. Consumers use the package…                                    |
| [workspace/workspace-explorer](workspace/workspace-explorer)                   | Owns workspace-explorer implementation and its bilingual translation bundle. Consumers use the package exports…                                    |
| [workspace/workspace-file-view](workspace/workspace-file-view)                 | Registers workbench.workspace-file, its file Surface, opener and overlay bridge. Owns text/code/diff/Markd…                                        |
| [workspace/workspace-files](workspace/workspace-files)                         | Owns file services/buffers, ExplorerTree, FileLink/menu, local application selection/preferences, and shared f…                                    |
| [workspace/workspace-git-branch](workspace/workspace-git-branch)               | Owns git-branch implementation and its bilingual translation bundle. Consumers use the package exports. The pr…                                    |
| [workspace/workspace-review](workspace/workspace-review)                       | Owns workspace-review implementation and its bilingual translation bundle. Consumers use the package exports.…                                     |
| [workspace/workspace-runtime](workspace/workspace-runtime)                     | Owns the headless inspector controller, Surface state, draft and feedback stores, persistence and workspace-di…                                    |

产品内置 Skills 和 Prompts 位于 [pi-workbench-runtime/resources](product/pi-workbench-runtime/resources)。Browser 包配套的 browser-use 技能与扩展共置，供独立 Pi CLI 复用。
