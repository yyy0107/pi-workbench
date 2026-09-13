# Spec011 验证记录

日期：2026-09-13。基线为 `aa87792b` 加已完成的 Spec009/010 未提交工作区。本次未提交或推送；保留此前修改和历史规格。

## 实施结果

- 删除 `pi-runtime-tools`，40 个工具源码、辅助、测试和许可证文件迁入 `product/pi-workbench-runtime`；逐文件前后 SHA-256 与公开入口映射见 migration-inventory.json。
- 产品包提供 29 个明确入口，工具归 `src/<tool-name>/`，Todo 实现与状态归 `src/rpiv-todo`，默认扩展及 Skills/Prompts 安装仍由产品管理。
- SDK 会话的工具覆盖和审查快照读取改为装配方注入；SDK 源码和生产依赖均不引用产品包。审查逻辑移到产品且保留工作区身份检查、记录过滤和错误语义。
- 工具源码快照采用开发部署和产物构建共享的明确路径清单；不复制整个产品包，清理已知退役文件并保留未知文件。
- 独立 Pi CLI 可复用的 Browser 包保留；PTY、工作区服务等通用能力保持独立。工具根及 builtin-tools 入口不会聚合加载 terminal-server。

## 初次合并检查与证据（目录调整前）

| 验证                                       | 结果                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --offline` | 通过，102 个 workspace projects                                         |
| `pnpm check:workspace-dependencies`        | 通过，包含 Runtime Host 所有权检查                                      |
| `pnpm check:package-structure`             | 通过，97 个库包、549 个库测试文件、0 项已跟踪迁移违规                   |
| `pnpm typecheck`                           | 全量通过；新增测试后产品包补充类型检查通过                              |
| `pnpm lint`                                | 最终通过，2918 个文件格式检查通过                                       |
| non-ui-tests.json 精选非 UI 测试           | 48 个文件、359 项通过，0 失败、跳过或取消                               |
| `pnpm build`                               | 通过：Node Runtime、Web、Desktop Renderer、Electron Runtime 及最终组合  |
| 产品中英文 README 校验                     | 29 个独立公开入口、58 行双语入口说明、96 个本地链接、10 个导入符号通过  |
| 迁移声明等价检查                           | 31 个迁移源码模块保留原有声明、Schema、提示与行为，归一化模块路径后通过 |
| `git diff --check`                         | 通过                                                                    |

新增行为覆盖：工具源码清单部署、排除无关产品文件、旧快照清理、未知文件保留、重复部署，以及审查快照有效性过滤和跨工作区拒绝。新增结构检查覆盖所有产品入口、SDK 生产依赖和旧包移除。

首次 lint 与测试并发时命中了测试期间生成的临时发布锁 owner.json；测试清理完成后重跑通过，未修改格式规则或临时文件。

锁文件更新 workspace 引用，并由 pnpm 清理不再使用的 Pi peer snapshots；第三方 packages 区的版本和 integrity 记录与基线完全一致，无依赖升级。

此前六份用户 skill 编辑均保留；其中 Pi coding-agent skill 只额外更新产品工具路径，其余五份内容与迁移前哈希一致。旧包名在当前源码中仅作为架构测试的否定断言保留，历史规格记录不重写。

## 验证范围

按用户约束，未新增或执行 UI、DOM、Hook 渲染测试，也未运行 Browser/Electron UI 交互冒烟。构建结果证明当前目标可编译和组合；交互行为不额外声称经过 UI 实测。

## 每个工具独立目录：补充验证

本轮按用户补充整理 27 个文件，删除 6 个多余转发文件；将 Grep/Find 各自放入工具目录，共用 lib/multi-root-search.ts，原有增强搜索入口保持装配顺序与 Windows 策略。Todo 的 README、MIT 许可证和状态辅助实现全部共置 src/rpiv-todo；resources 下只有 skills/prompts。最新路径与哈希见 migration-inventory.json。

- 全量 `pnpm typecheck` 通过。
- 依赖和结构检查通过：97 个库包、549 个库测试文件、0 项已跟踪结构违规。
- 48 个精选非 UI 测试文件、361 项全部通过；新增全新部署资源分类检查，以及旧快照父目录为符号链接时保护外部文件的检查。
- `pnpm --filter @workbench/runtime-node build` 通过，实际 Node Runtime 产物按新工具目录生成；Runtime artifact builder 行为测试同时通过。本轮不重复运行无关前端构建或 UI 测试。
- 中英文 README 的 29 个公开入口、96 个本地链接与 10 个导入符号校验通过，公开导入路径保持不变。
- 迁移兼容测试最初因旧快照 fixture 被误改为新工具名称而失败；恢复原先已发布名称后，重新运行全部 48 个文件通过，未扩大清理范围。

最终 `pnpm lint` 通过（2916 个文件）；`git diff --check` 通过。当前变更文档的 554 个本地链接检查无缺失。

## 扩展资源入口：最终验证

本轮将 8 组实际注册入口放入 resources/extensions：builtin-tools、ask-user、rpiv-todo、workbench-settings、workspace-review、composer-context、message-termination、context-trace。工具定义和执行、Todo 状态、投影和诊断辅助保留在 src；共享偏好生命周期绑定继续复用原实现。SDK 0.85.1 的公开 defineTool 只返回传入定义，用于保留拆分后的参数类型推导，不改变工具运行行为。

原有 29 个入口保持，新增 8 个明确的 /extensions/<name> 入口，合计 37 个；旧混合工具/扩展入口与新入口解析到同一个资源模块。产品静态装配保留注册顺序、隐藏标记、宿主依赖和启停规则；不新增文件发现注册路径。

- 全量类型检查通过，resources/extensions/**/*.ts 显式纳入产品 typecheck。
- 依赖及结构检查通过：97 个库包、549 个库测试文件、0 项已跟踪违规。结构规则只为本产品 resources/extensions/<name>/index.ts 开放可执行资源入口，并用测试确认其他资源路径/包仍被拒绝。
- 49 个精选非 UI 测试文件、371 项全部通过，无失败、跳过或取消；覆盖工具行为、会话、资源部署、实际注册位置及结构例外边界。
- Runtime 构建通过；实际产物包含 8 个扩展注册源码入口，开发部署与产物共享同一白名单。源码副本供查看，执行工厂已编译进 Runtime。
- 最终 lint 通过（2926 个文件），diff 空白检查通过。
- 中英文产品 README 共 37 个公开入口、74 行入口说明、116 个本地链接、10 个导入符号校验通过。

初轮部署测试还保留旧资源分类预期 skills/prompts，更新为 extensions/skills/prompts 后通过。未修改依赖版本，未运行 UI 渲染或交互测试，未提交或推送。
