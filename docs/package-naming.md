# 工作区包命名

库包保留 `packages/<domain>/<package-name>` 两级目录。领域目录只分类；叶目录名必须与 `package.json` 的 `@workbench/` 后缀完全一致。例如 `packages/workspace/workspace-runtime` 对应 `@workbench/workspace-runtime`，`packages/extension-platform/extension-host` 对应 `@workbench/extension-host`。目录保留领域前缀是为了让包目录、import、pnpm filter 和错误栈中的名称一一对应。

- Client 通用应用 UI 能力使用 `ui-<capability>`，如 `ui-settings`、`ui-model-selection`、`ui-token-usage` 和 `ui-terminal`；已有基础组件包 `ui` 和职责明确的格式渲染/外观基础设施名称保留。
- Pi SDK 接入位于 `pi-sdk/pi-sdk-<capability>`；Workbench 适配位于 `pi-runtime/`，使用 `pi-runtime-*`、`pi-rpc-*` 与 `pi-conversation-adapter`；Pi UI 位于 `pi-ui/pi-ui-*`。产品装配位于 `product/pi-workbench`（前端）与 `product/pi-workbench-runtime`（Node）。不使用 `pi-shared`、`pi-contributions` 等职责不明确的包名。
- Runtime、契约和服务端保留明确角色：`agent-runtime-core`、`core-contracts`、`server-core`，避免把不同职责都命名为 `core`。
- package name 只标识代码包。扩展 ID、翻译 bundle ID、协议、持久化键及工具 ID 保持兼容，不随目录名变化。例如 `workbench.agent-runtime-pi-contributions` 仍是稳定 bundle ID。
- 跨包引用使用公开 exports 和 `workspace:*`。重命名必须同步消费者、资源/构建路径、边界检查、锁文件和当前文档。

`scripts/check-package-structure.mjs` 强制检查所有库包的目录/name 对应关系；缺失名称由工作区依赖检查负责。负例测试中的旧包名故意保留。

## 早期统一记录（历史名称）

基于提交 `e2605719`：72 个包保持原能力边界，53 个目录移动、15 个包名调整。完整前后映射见 [package-naming-map.json](package-naming-map.json)。Spec 001/002 及历史重构计划记录各自完成时的状态，不改写历史验收。

| 原包名                                      | 当前包名                          |
| ------------------------------------------- | --------------------------------- |
| `@workbench/agent-controls`                 | `@workbench/ui-agent-controls`    |
| `@workbench/automation-ui`                  | `@workbench/ui-automation`        |
| `@workbench/settings-ui`                    | `@workbench/ui-settings`          |
| `@workbench/terminal-ui`                    | `@workbench/ui-terminal`          |
| `@workbench/contracts`                      | `@workbench/core-contracts`       |
| `@workbench/agent-runtime-pi-client`        | `@workbench/pi-client`            |
| `@workbench/agent-runtime-pi-contributions` | `@workbench/pi-contributions`     |
| `@workbench/pi-diagnostics-ui`              | `@workbench/pi-ui-diagnostics`    |
| `@workbench/agent-runtime-pi-protocol`      | `@workbench/pi-protocol`          |
| `@workbench/agent-runtime-pi-server`        | `@workbench/pi-server`            |
| `@workbench/pi-session-import-ui`           | `@workbench/pi-ui-session-import` |
| `@workbench/pi-settings-ui`                 | `@workbench/pi-ui-settings`       |
| `@workbench/agent-runtime-pi-shared`        | `@workbench/pi-shared`            |
| `@workbench/pi-status-ui`                   | `@workbench/pi-ui-status`         |
| `@workbench/pi-toolbox-ui`                  | `@workbench/pi-ui-toolbox`        |

上表是历史包名映射，保留用于解释早期重构记录。Spec004 又将 `@workbench/ui-agent-controls` 的模型选择与 Token 用量能力分别迁移到 `@workbench/ui-model-selection` 和 `@workbench/ui-token-usage`；该历史中间包名不再作为新增能力的示例。

Spec005 将会话能力继续拆分为 `@workbench/ui-composer`、`@workbench/ui-conversation`、`@workbench/ui-conversation-list`、`@workbench/ui-conversation-messages`、`@workbench/ui-conversation-nodes` 和 `@workbench/ui-message-blocks`。新增代码应按这些 owner 的实际职责引用公开入口，不再使用旧的 `@workbench/composer` 或 `@workbench/conversation` 包名。

## Pi 名称整理记录

基于 `a2427637`，21 个既有包移动、15 个包重命名，并新增独立 Node 产品包，总计 97 个库包。见[包导航和导入示例](../packages/README.md)、[本轮完整映射](package-layout-map.json)及[验证记录](package-layout-validation.md)。内置资源、默认扩展清单与部署策略由 Node 产品包拥有，工具实现移到 `pi-runtime`；SDK 接入仍可引用既有 RPC 合同与纯数据适配器，目录分类不等同于进一步解耦。

新增代码按当前导航导入。下述早期验证与 Spec001–008 保留各自完成时的名称和记录。稳定扩展、工具、线协议、持久化和翻译 bundle ID 不跟随包名改动。

## 当前应用基础设施命名

基于 `aa87792b`，原 `packages/host` 的两个包及 `client/host-client`、`client/host-contracts` 调整为六个明确能力包，总计 99 个库包。详细来源、子路径归属和验证见 [Spec009](../specs/009-host-infrastructure-naming/plan.md) 与 [逐文件清单](../specs/009-host-infrastructure-naming/migration-inventory.json)。

| 查找职责                                   | 当前目录                             |
| ------------------------------------------ | ------------------------------------ |
| Runtime 连接、宿主能力、控制与产物格式合同 | `contracts/runtime-contracts`        |
| 客户端 HTTP / WebSocket 传输               | `transport/runtime-transport-client` |
| 服务端 HTTP / WebSocket、认证与代理        | `transport/runtime-transport-server` |
| Runtime/Web 进程启动、探测与退出           | `process/application-process`        |
| Runtime/Web 产物读取与完整性校验           | `build/artifact-reader`              |
| 原生依赖、资源和 Next 产物准入策略         | `build/artifact-policy`              |

`packages/build` 是手写能力源码领域，生成物仍在各应用原有输出目录。`extension-host` 继续表示扩展安装与界面挂载；`local-host-server` 继续提供宿主文件/目录与本地应用能力。协议符号中已有的 Host 名称和所有稳定 ID 保持原值，不随包名机械替换。

## 自定义 bash 工具归并

Spec010 将独立的 `pi-runtime-terminal` 暂时合并为 `@workbench/pi-runtime-tools/bash`，当时库包总数为 98。工具定义放在 `pi-runtime-tools/src/bash.ts`，终端执行仍归 `terminal-server`，保持原有应用注入和工具来源标识。详细映射与验证见 [Spec010](../specs/010-pi-bash-tool-consolidation/plan.md)。上文及历史规格中的数量描述各自完成时状态。

## 当前产品工具所有权

Spec011 将 Workbench 专属工具、提示、交互与 Todo 策略统一归入 `product/pi-workbench-runtime`，移除 pi-runtime-tools，当前共 97 个库包。工具入口为 `@workbench/pi-workbench-runtime/tools/*`，Todo 状态入口为 `/todo/*`；SDK 通过既有装配层注入的回调使用工具覆盖与审查策略，不依赖产品。通用终端/工作区能力和具有独立 CLI 用途的 Browser 包保持原归属。详见 [Spec011](../specs/011-product-tool-ownership/plan.md)。

## 验证策略

不新增或运行 UI 测试、Browser/Electron UI 自动化或手工 UI 冒烟；既有测试随包保留。执行 frozen-lockfile 安装、静态路径/命名/依赖检查、类型检查、lint、精选非 UI 检查及完整构建。详细执行结果见 [package-naming-validation.md](package-naming-validation.md)。

会话与输入相关 UI 能力统一归 `packages/client/`；原 `packages/conversation/` 已并入 client。包名及公共入口不因领域目录调整而变化。
