# Pi bash 工具合并计划

基线为 `aa87792b` 加已验证但未提交的 Spec009，库包数 99 → 98。本期与 Spec009 分开记录，保留其完成时验证。

| 来源                                                    | 目标                                                 |
| ------------------------------------------------------- | ---------------------------------------------------- |
| pi-runtime-terminal/src/index.ts                        | pi-runtime-tools/src/bash.ts                         |
| pi-runtime-terminal/lib/command-options.ts              | pi-runtime-tools/lib/bash-command-options.ts         |
| pi-runtime-terminal/tests/interactive-bash-tool.test.ts | pi-runtime-tools/tests/interactive-bash-tool.test.ts |
| @workbench/pi-runtime-terminal                          | @workbench/pi-runtime-tools/bash                     |

只迁移文件及导入；SDK 公共导入、函数声明、工具 Schema 与执行体保持原样。新入口仅从 package.json 导出，根入口与 builtin-tools 不静态引用 bash。Runtime Node 组合根继续提供既有 toolTerminalSessions 实例，source 仍为 workbench.terminal。

将 terminal-contracts/terminal-server 依赖移入工具包，应用改为依赖工具包。独立包的边界规则并入工具包 AGENTS，当前 README/导航和 SDK source-routing 同步更新；历史规格和映射保留。

验证：冻结锁文件安装；工作区结构/依赖；tools、runtime-server、runtime-node、产品 Runtime 类型检查；tools 与终端非 UI 行为/覆盖选择/会话传递/构建边界测试；Runtime Node 构建及 Electron 应用标准构建（Renderer 与 Electron Runtime 制品组合）。排除 UI 测试。
