# Spec010 验证记录

完成日期：2026-09-13。基线为 `aa87792b` 加未提交的 Spec009；本期也未提交或推送。

## 实施结果

- 自定义 bash 工具合并到 `pi-runtime-tools/src/bash.ts`，通过 `@workbench/pi-runtime-tools/bash` 导入。
- 命令选项辅助与全部 6 项既有工具行为测试随实现迁移；测试改为使用新的公开入口。
- 删除原 pi-runtime-terminal 包及其元数据；工作区 99 → 98 个库包，104 → 103 个项目，库测试文件仍为 548 个。
- terminal-contracts/terminal-server 依赖归工具包，Runtime Node 直接消费工具包子路径。PTY 原生依赖和终端会话实现仍归 terminal-server。
- 应用仍把同一个 toolTerminalSessions 通过既有宿主绑定传给工厂；bash 名称、workbench.terminal 来源、参数、超时、输入归属、取消和输出截断不变。
- 工具包根入口和 builtin-tools 与基线逐字节一致，不新增 bash 聚合加载。
- 中英文 README 的 25 个公开入口与实际 exports 一致，84 处本地链接和 8 处导入符号有效；总导航完整列出当前 98 包。
- SDK source-routing 和终端边界说明同步到新入口；既有六处 skill 工作区修改保持原样。

## 验证命令与结果

| 检查                                                               | 结果                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `pnpm install --offline`                                           | 通过；合并 workspace 依赖与锁文件，第三方 packages/snapshots 数据不变 |
| `pnpm install --frozen-lockfile --offline`                         | 通过；103 个工作区项目                                                |
| `pnpm check:workspace-dependencies`                                | 通过；依赖、公开入口、无环及 Runtime 所有权检查                       |
| `pnpm check:package-structure`                                     | 通过；98 库包、548 个库测试文件、0 迁移违规                           |
| tools、runtime-server、runtime-node、pi-workbench-runtime 类型检查 | 四包全部通过                                                          |
| [非 UI 测试白名单](non-ui-tests.json)                              | 15 文件、174 项全部通过，无失败或跳过                                 |
| `pnpm lint`                                                        | 通过；最终文档更新后补做格式和差异检查                                |
| `pnpm --filter @workbench/runtime-node build`                      | 通过；Node 目标 server.mjs 生成成功                                   |
| `pnpm --filter @workbench/desktop-electron run build`              | 通过；Renderer 1967 个静态文件及 Electron Node Runtime 生成并组合成功 |

测试覆盖 bash 会话地址、用户/Agent 输入、命令策略、超时与参数拒绝，工具覆盖选择、Pi 会话绑定、终端执行、现有工具回归以及 Runtime 产物边界。没有新增 UI 测试，没有运行 UI/DOM/Hook 渲染或交互冒烟。

最初尝试直接调用 Desktop 制品脚本及 pnpm exec，均因脚本要求 npm_execpath 而在启动校验处被拒绝；随后使用项目已有 `pnpm ... run build` 完成标准构建。未修改构建脚本或绕过校验。

## 行为和记录完整性

新 bash 文件与原源码逐字节比较，仅内部辅助导入路径不同；辅助实现完全一致；迁移测试仅改公开导入路径。已安装 Pi SDK 为 0.85.1，createBashToolDefinition、defineTool 和相关类型均由 SDK 根公开，不使用私有深导入。输出截断仍委托原 SDK 工具，未添加第二套输出处理。

Spec001–009 及历史名称映射保留完成时记录；当前名称归并由 Spec010 解释。本机详细日志位于 `/tmp/pi-bash-{install,frozen,typecheck,tests,boundaries,structure,lint,runtime-build,desktop-build}.log`，不作为仓库必需文件。
