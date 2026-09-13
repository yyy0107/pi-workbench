# 工作区包命名

库包保留 `packages/<domain>/<package-name>` 两级目录。领域目录只分类；叶目录名必须与 `package.json` 的 `@workbench/` 后缀完全一致。例如 `packages/workspace/workspace-runtime` 对应 `@workbench/workspace-runtime`，`packages/extension-platform/extension-host` 对应 `@workbench/extension-host`。目录保留领域前缀是为了让包目录、import、pnpm filter 和错误栈中的名称一一对应。

- Client 通用应用 UI 能力使用 `ui-<capability>`，如 `ui-settings`、`ui-model-selection`、`ui-token-usage` 和 `ui-terminal`；已有基础组件包 `ui` 和职责明确的格式渲染/外观基础设施名称保留。
- Pi 实现使用 `pi-<capability>`；Pi UI 使用 `pi-ui-<capability>`。不再混用 `agent-runtime-pi-*` 与 `pi-*`。
- Runtime、契约和服务端保留明确角色：`agent-runtime-core`、`core-contracts`、`server-core`，避免把不同职责都命名为 `core`。
- package name 只标识代码包。扩展 ID、翻译 bundle ID、协议、持久化键及工具 ID 保持兼容，不随目录名变化。例如 `workbench.agent-runtime-pi-contributions` 仍是稳定 bundle ID。
- 跨包引用使用公开 exports 和 `workspace:*`。重命名必须同步消费者、资源/构建路径、边界检查、锁文件和当前文档。

`scripts/check-package-structure.mjs` 强制检查所有库包的目录/name 对应关系；缺失名称由工作区依赖检查负责。负例测试中的旧包名故意保留。

## 本次统一

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

## 验证策略

不新增或运行 UI 测试、Browser/Electron UI 自动化或手工 UI 冒烟；既有测试随包保留。执行 frozen-lockfile 安装、静态路径/命名/依赖检查、类型检查、lint、精选非 UI 检查及完整构建。详细执行结果见 [package-naming-validation.md](package-naming-validation.md)。

会话与输入相关 UI 能力统一归 `packages/client/`；原 `packages/conversation/` 已并入 client。包名及公共入口不因领域目录调整而变化。
