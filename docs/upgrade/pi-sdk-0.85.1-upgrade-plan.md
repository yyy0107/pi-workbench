# Pi SDK 0.85.1 升级计划及执行记录

| 项目     | 记录                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| 执行日期 | 2026-09-07                                                                                |
| 工作分支 | `chore/adapt-pi-0.85.1`                                                                   |
| 对比基线 | `6f0149dff9d080fb801d47d7ce17ac6d55d96075`；见 [版本迭代对比](pi-sdk-0.84.2-to-0.85.1.md) |
| 目标版本 | `@earendil-works/pi-ai@0.85.1`、`@earendil-works/pi-coding-agent@0.85.1`                  |
| 执行环境 | Node `24.16.0`、pnpm `11.22.0`、Linux x64                                                 |
| 总体状态 | 已完成：依赖、类型、定向回归、真实构建及独立制品验收全部通过                              |

## 1. 已确定的行为与兼容边界

- 模型与推理等级采用 Pi 0.85.1 的会话级设置；现有调用不添加 `persist: true`。
- Workbench 继续通过自己的 `modelSelector` 设置记忆 UI 选择，并在新 UI 会话提交时显式传入。
- 未指定模型的自动化和后端会话采用 Pi 已保存的全局默认；显式指定的自动化模型优先，普通会话切换不再隐式改变这些默认值。
- 保留现有会话架构、HTTP/WebSocket RPC、`pi-messages-v1` 和 JSONL 版本 `3`。消息 DTO 仅增加可选 `providerThinkingLevel?: string`，旧消息继续有效。
- 保留受控 fetch、现有 compaction/retry 事件和交互状态所有者。现有 `fetchDeferred()` 已经过包装；没有直接使用新增的 `streamDeferred()`，本轮不增加空闲适配。
- 外部会话存储、新 frame 协议、PowerShell UI、新模型配置 UI、产品版本和发布不在本轮范围。模型目录继续由 Pi SDK 提供。

## 2. 分阶段实施

| 阶段         | 实施内容                                                                                                         | 状态                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 依赖和补丁   | 5 个工作区、6 处直接依赖固定 `0.85.1`；重新生成只补三个 stdout 根导出的 JS/类型补丁；pnpm 重算锁文件             | 已完成，安装成功                                  |
| Runtime 解析 | 删除无调用者的 `/rpc-entry`、`/client` 精确映射；NFT 从候选制品目录推导运行目录；保留根映射和两个 SDK 完整发布树 | 已完成，59 项相关测试、真实构建和独立制品验证通过 |
| 消息契约     | 声明可选 thinking 元数据；沿既有 copy、chunk、重连快照、最终消息和冷历史链路验证                                 | 已完成，8 项定向测试通过                          |
| 模型和会话   | 不改已有模型调用；补会话隔离、冷恢复、自动化默认及压缩边界回归                                                   | 已完成，74 项会话测试与 11 项选择器测试通过       |
| 开发文档     | 更新两个 SDK 技能的公开入口、流语义和模型持久化约定；修正对比记录的 Runtime 追踪范围                             | 已完成，技能验证和文档路径验收通过                |

依赖更新涉及 [Runtime Node](../../apps/runtime-node/package.json)、[Pi Server](../../packages/agent-runtime/runtimes/pi/server/package.json)、[Pi Protocol](../../packages/agent-runtime/runtimes/pi/protocol/package.json)、[Pi Shared](../../packages/agent-runtime/runtimes/pi/shared/package.json) 和 [Terminal Pi Tool](../../packages/terminal/pi-tool/package.json)。`chord` 等由 pnpm 解析为传递依赖，未额外声明。旧 `pi-client` / `pi-protocol` 传递依赖随新依赖闭包移除。

[stdout 补丁](../../patches/@earendil-works__pi-coding-agent@0.85.1.patch)只在 `dist/index.js` 和 `dist/index.d.ts` 根入口导出 `isStdoutTakenOver`、`restoreStdout`、`takeOverStdout`，不修改 SDK 实现。新版类型入口已改变，因此从 0.85.1 发布包重新生成补丁，没有仅重命名旧补丁。

[Runtime 构建](../../apps/runtime-node/scripts/build-runtime-artifact.ts)仍把 Pi AI 和 Coding Agent 的全部 `dist` JavaScript 加入 NFT roots，包括 CLI/RPC bundle；不能将其描述为仅追踪根 SDK 导入闭包。

## 3. 验证命令和结果

### 安装与类型

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @workbench/agent-runtime-pi-protocol \
  --filter @workbench/agent-runtime-pi-shared \
  --filter @workbench/agent-runtime-pi-server \
  --filter @workbench/agent-runtime-pi-client \
  --filter @workbench/pi-terminal-tool \
  --filter @workbench/runtime-node typecheck
```

结果：安装成功，0.85.1 补丁应用成功；六个包类型检查通过。只读核对确认六处 SDK 声明及实际实例均为 `0.85.1`，锁文件 importer 除 SDK 版本和 patch hash 外没有直接依赖漂移。新增会话测试补齐 mock 参数类型后，Pi Server 类型检查再次通过。

### 定向测试

在仓库根目录以既有 TypeScript loader 运行下表文件，不新增测试框架：

```bash
node --no-warnings=ExperimentalWarning \
  --import ./scripts/register-typescript-test-loader.mjs \
  --test <下表中的测试文件路径>
```

| 组别               | 文件（路径相对仓库根目录）                                                                                                                                                                   | 结果                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 消息契约           | `packages/agent-runtime/runtimes/pi/shared/test/reducer.test.ts`；`packages/agent-runtime/runtimes/pi/client/test/transport/session-message-accumulator.test.ts`                             | 8/8 通过                                   |
| 模型与请求         | `packages/agent-runtime/runtimes/pi/server/test/models/{model-service,model-request-transport}.test.ts`                                                                                      | 与下面四组合计 128/128 通过                |
| 会话状态与恢复     | `packages/agent-runtime/runtimes/pi/server/test/sessions/{session-queue,session-resume,session-interruption,session-context-policy,session-context-trace}.test.ts`                           | 通过                                       |
| 内置工具与技能     | `packages/agent-runtime/runtimes/pi/server/test/internal-extensions/{builtin-tools,enhanced-search}.test.ts`；`packages/agent-runtime/runtimes/pi/server/test/skills/builtin-skills.test.ts` | 通过                                       |
| 终端执行           | `packages/terminal/pi-tool/test/interactive-bash-tool.test.ts`                                                                                                                               | 通过                                       |
| 已安装 Host RPC    | `apps/runtime-node/test/installed-pi-server-rpc.test.ts`                                                                                                                                     | 通过，包括 `host.describe.piVersion`       |
| stdout、扩展、构建 | `apps/runtime-node/test/{installed-api-only-runtime-host,package-control-stdout,session-extension-lifecycle,runtime-artifact-builder}.test.ts`                                               | 新增 NFT 回归后重跑，59/59 通过            |
| 模型默认与压缩边界 | `packages/agent-runtime/runtimes/pi/server/test/sessions/session-registry-metadata.test.ts`，以及同目录的 context-policy、resume、queue、context-trace 测试                                  | 74/74 通过；其中四个文件与上方已有回归重复 |
| UI 模型记忆        | `packages/workbench/shell/src/extensions/builtin/model-selector/model-selector-state.test.ts`                                                                                                | 11/11 通过                                 |

消息回归覆盖可选元数据与签名复制、交错 text/thinking、部分工具 JSON、持久化 chunk、JSON snapshot 重连、后续 chunk 缺少元数据时保留，以及最终错误消息覆盖和冷历史恢复。现有 interruption 测试包含进程被强制终止后的恢复，避免仅凭 JSONL 版本号断言兼容。

`session-registry-metadata.test.ts` 新增三个真实边界回归：

1. 会话 A 选择模型和 effort 不影响 B；A 冷恢复保留选择；prompt 指定和自动化显式模型优先，未指定模型的自动化继承 Pi 默认；每次检查 Pi Settings 文件没有被改写。
2. 使用已有 `fauxProvider` 执行工具和模型循环，80 KB 工具结果触发自动压缩，下一次模型请求发生在压缩结束后；context-only 消息位于工具结果之后，最终 running/busy 和两类队列收敛。
3. 省略锚点和显式锚点的 detached fork 都正确处理指向 label 的 compaction 保留边界；源文件不变，子会话从真实 JSONL 冷打开后上下文、`providerThinkingLevel` 和 thinking 签名完整相等。

UI 记忆测试覆盖草稿优先级、不同草稿隔离、最近选择共享和设置恢复。代码检查进一步确认：`model-selector-store.ts` 从 Workbench Settings 恢复/保存选择，`model-selector-state.ts` 按草稿选择→最近选择→可用模型解析；Pi Client 在草稿转远程会话时捕获选择，在第一次 prompt 前等待 `selectSessionModel()`，这条既有调用顺序保持不变。

上表共 20 个不同测试文件、259 项不重复测试通过；重复运行的四个会话文件包含 21 项测试，没有重复计入总数。

### Runtime 制品

```bash
pnpm --filter @workbench/runtime-node build
```

首轮构建暴露了本轮依赖变化所需的适配：Anthropic SDK `0.123.0` 的 `tools/agent-toolset/skills.mjs` 通过 `path.resolve(context.workdir, "skills", ...)` 查找运行目录资源。NFT 原先把 `processCwd` 设为仓库根，推导路径时将仓库源码和旧制品中的 `skills` 纳入追踪，随后把 NOTICE/TypeScript 当作脚本解析而失败。

修复只将 import/require 两次 NFT trace 的 `processCwd` 改为本次候选制品目录；`base`、根入口映射和包解析规则不变，正式内置资源继续由原有 copier 显式复制。新增测试通过真实 NFT 执行同形状的技能路径查找，断言两种条件都不把仓库文件带入制品；没有新增告警豁免或复制框架。

修复后真实构建通过。验证目标为 `x86_64-unknown-linux-gnu`，Node `24.16.0` / ABI `137`；制品位于 `.desktop-build/runtime-node/node-linux-x64-glibc-abi137`。本轮没有运行其他平台或 Electron 的构建矩阵。

将完整制品复制到 `/tmp/pi-0.85.1-runtime-smoke-t5muwv` 后完成：

| 检查                 | 实际结果                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node ESM 导入        | Coding Agent `VERSION === "0.85.1"`；三个 stdout 根导出存在                                                                                                 |
| stdout 接管和恢复    | 状态 `false → true → false`，恢复原始 `process.stdout.write`                                                                                                |
| 实际 SDK 依赖链      | `pi-coding-agent`、`pi-ai`、`pi-agent-core`、`chord/context` 均为 `0.85.1`；入口 realpath 全部位于复制制品内                                                |
| 制品 manifest        | schemaVersion `2`，2880 resources、223 links；含 30 个内置技能文件和 22 个内部扩展文件                                                                      |
| 真实 Host 启动和退出 | 独立临时 agentDir 收到 `ready`，调用 `host.describe` 返回 `piVersion: "0.85.1"`；最后收到 `shutdown-ack`，退出码 `0`                                        |
| 安装后的文档描述     | Host 自动生成 `agent/skills/.builtin/pi-docs/runtime.json`，其 `version` 为 `0.85.1`；`packageDir`、`readme`、`docs`、`examples` 的 realpath 全在复制制品内 |
| 文档可读性           | 实际读取 `README.md`、`docs/sdk.md`、`docs/extensions.md`，确认 `examples` 非空                                                                             |

Chord 的真实导入链是 `pi-coding-agent → pi-agent-core → @earendil-works/chord/context`，按此入口验证精确闭包；没有为未使用的 Chord 根入口额外扩充分发范围。独立 Host 检查没有创建会话或发送模型请求，临时 agentDir 已清理。

执行时保留的诊断日志（临时目录，不作为仓库长期资源）：

- `/tmp/pi-0.85.1-runtime-build.log`：初次构建失败及具体解析告警。
- `/tmp/pi-0.85.1-runtime-build-fixed.log`：修复后构建通过。
- `/tmp/pi-0.85.1-runtime-tests.log`：59 项 Runtime 定向测试。
- `/tmp/pi-0.85.1-runtime-artifact-smoke-final.log`：独立制品的 SDK、stdout 和依赖验证。
- `/tmp/pi-0.85.1-runtime-installed-docs-smoke.log`：真实 Host 安装生成文档描述、路径与退出验证。

## 4. 文档资源与验收限制

- [Pi AI 技能](../../.agents/skills/pi-ai-sdk/SKILL.md)补充 `utils/*`、共享 partial 累加器、请求开始前直接 `error` 和认证缺失时同步抛错等契约。
- [Pi Coding Agent 技能](../../.agents/skills/pi-coding-agent-sdk/SKILL.md)明确根 SDK、bundle RPC 与仅 `source` 条件的实验入口，以及会话选择和全局默认的关系。
- 两个技能目录均通过 `skill-creator/scripts/quick_validate.py`；本轮已完成修改文件的定向 lint 和格式检查，未运行全仓格式化。
- 内置 `pi-docs` 继续保留标注为 `0.84.2` 的历史快照；已有版本判断优先使用 `runtime.json` 指向的当前 SDK 文档和示例，不批量改写快照版本号。
- 模型回归使用 fake/provider 注入，不发送真实付费模型请求。本轮没有无法通过定向检查解释的 UI 渲染问题，不使用 Browser/E2E；未改变原生依赖，`smoke:native` 不代替 SDK 导入验收。
- 完成标准已满足：依赖/补丁安装、类型和定向测试、真实构建、独立制品导入、旧会话恢复、模型默认值及文档定位回归全部通过。后续如需回退，以本轮依赖、补丁和适配代码为单位并用 pnpm 重装，不改写用户会话数据。
