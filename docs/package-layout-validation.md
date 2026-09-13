# Pi 包名称与产品资源边界验收

基线：`a2427637`。按确认的 `pi-sdk`、`pi-runtime`、`pi-ui` 和 `product` 分类执行，随后按所有权修正 SDK 内的产品内容。21 个既有包移动、15 个包重命名，新增一个独立 Node 产品包，合计 97 个库包。完整映射见 [package-layout-map.json](package-layout-map.json)，导入与职责见 [Packages 导航](../packages/README.md)。

> 后续状态：本页保留当时的迁移验收记录。当前模型可调用的 Browser package、扩展与 `browser-use` Skill 已退役；仅保留由 `workspace-browser` 与 `browser-server` 提供的右侧浏览器标签。

## 最终所有权

| 层                | 包与职责                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK 服务          | `pi-sdk-models`、`pi-sdk-sessions`、`pi-sdk-resources`、`pi-sdk-ports`：模型、会话、资源服务与注入合同                                                                             |
| Workbench Runtime | `pi-runtime-client/server/adapters`、`pi-rpc-client/contracts`、`pi-conversation-adapter`：客户端、服务端与协议适配；`pi-runtime-tools/browser/terminal`：Workbench 工具及扩展实现 |
| Pi UI             | `pi-ui-extensions` 与六个既有 `pi-ui-*` 能力包：界面贡献和词典                                                                                                                     |
| 前端产品          | `product/pi-workbench`：Shell、Provider、默认界面安装顺序                                                                                                                          |
| Node 产品         | `product/pi-workbench-runtime`：内置 Skills/Prompts、默认内联扩展清单、Browser 包注册、资源部署与兼容迁移                                                                          |

SDK 目录没有产品资源文件和默认扩展清单。`pi-sdk-resources` 保留加载、查询、启停、持久化、重载，以及已安装内置资源的稳定来源识别/保护规则。Node 产品包复用这些服务，由 `pi-runtime-server` 装配代码选择；SDK 服务和工具工厂均不导入产品包。

Browser 是可独立安装的 Pi Package，其 `browser-use` 技能与扩展共置于 `pi-runtime-browser`，供 Workbench 和独立 Pi CLI 共用。产品包决定默认安装与注册此包。`resources/prompts` 目前为空目录占位，未来产品模板放在这里。

## 已完成迁移

- [x] 原 Pi 工具、Browser、Terminal 接入移到 Runtime 目录，统一为 `pi-runtime-tools/browser/terminal`。
- [x] 35 个产品资源文件移到 `pi-workbench-runtime/resources`，内容保持原样。
- [x] 默认扩展工厂清单移到 `pi-workbench-runtime/src/extensions.ts`；函数体、名称、隐藏标记和顺序保持原样，Trace 观察者仍最后安装。
- [x] 内置资源部署、默认包注册、旧开关迁移和退役文件清理移到 Node 产品包。
- [x] Runtime 工具根入口仅保留结果处理和错误报告；默认清单从 `@workbench/pi-workbench-runtime/extensions` 导入。
- [x] SDK resources 删除产品安装/目录入口及对具体 Browser 包的依赖；产品入口独立于 React、前端产品与 Runtime Server。
- [x] 同步 workspace、依赖、锁文件链接、构建资源路径、Browser 归档名、边界检查和当前文档/技能。
- [x] Spec001–008 保留原完成记录；原有技能修改保留，按本轮边界更新相关路径与所有权说明。

## 验证

| 检查                                               | 最终结果                                                       | 日志                                   |
| -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| frozen-lockfile 安装                               | PASS，102 workspace projects                                   | `/tmp/pi-ownership-install.log`        |
| frozen-lockfile 离线复验                           | PASS                                                           | `/tmp/pi-ownership-frozen-offline.log` |
| workspace dependencies / Runtime Host ownership    | PASS                                                           | 本轮终端输出                           |
| package structure                                  | PASS，97 库包、547 测试文件、0 结构违规                        | 本轮终端输出                           |
| 全仓 `pnpm typecheck`                              | PASS，含新 Node 产品包及全部 apps/packages                     | `/tmp/pi-ownership-types.log`          |
| `pnpm lint`                                        | PASS，oxlint 与 oxfmt                                          | `/tmp/pi-ownership-lint.log`           |
| [精确非 UI 集合](package-layout-non-ui-tests.json) | 86 文件、671 PASS、0 fail/skip                                 | `/tmp/pi-ownership-tests.log`          |
| Runtime 内置资源部署/裁剪定向测试                  | 1 PASS                                                         | `/tmp/pi-ownership-artifact-test.log`  |
| `pnpm build`                                       | PASS，Runtime、Web、Electron renderer 与 Electron Runtime 组合 | `/tmp/pi-naming-commit-build.log`      |
| 内容与默认清单复核                                 | 35 个资源文件内容保持；默认扩展工厂函数体保持                  | 本轮静态复核                           |
| 第三方锁文件解析记录                               | 与命名调整前一致                                               | 本轮静态复核                           |
| `git diff --check`                                 | PASS                                                           | 本轮终端输出                           |

新增两项非 UI 架构检查：SDK 不得携带产品资源或导入产品包；Node 产品的全部公开入口不得传递加载 React、UI、前端产品包或 Runtime Server。既有回归覆盖扩展顺序、Todo 冲突、工具开关、资源启停、旧路径迁移、软链接拒绝、资源部署及 Browser 包独立加载。

复现命令：

```bash
node --input-type=module -e 'import fs from "node:fs"; import { spawnSync } from "node:child_process"; const { files } = JSON.parse(fs.readFileSync("docs/package-layout-non-ui-tests.json", "utf8")); const result = spawnSync(process.execPath, ["--import", "./scripts/register-typescript-test-loader.mjs", "--test", ...files], { stdio: "inherit" }); process.exit(result.status ?? 1);'
node --import ./scripts/register-typescript-test-loader.mjs --test --test-name-pattern='bundled resources install' apps/runtime-node/test/runtime-artifact-builder.test.ts
```

## 兼容性与验证范围

稳定扩展/工具 ID、资源 `.builtin` 路径、启停状态、会话生命周期与产物 `internal-skills`、`internal-prompts`、`internal-extensions`、`internal-packages/browser` 保持原样。迁移公开入口仅涉及产品资源部署和默认清单的所有者变化，其他能力仍按现有子路径导入。

本轮未新增或运行 UI、DOM、Hook 渲染、Browser/Electron 交互冒烟。Browser 打包测试使用 faux model/host 验证加载，不启动浏览器界面。提交前修正 Web 与 Electron renderer 的 `turbopack.ignoreIssue` 路径：旧规则仍指向 `agent-configuration`，现精确匹配 `pi-ui-settings/src/prompt-placeholder-highlight.module.css`。仅过滤 [Lightning CSS #1300](https://github.com/parcel-bundler/lightningcss/issues/1300) 的已知 `highlight` 诊断；保留正确的 `::highlight()` 语法及其他 CSS 诊断。两端生成 CSS 均包含完整高亮规则，最终完整构建不再输出该警告。

新包结构检查要求实际使用的 `lib`，已将目录创建、比较写入与复制辅助函数提取到 `lib/builtin-files.ts`，产品部署策略仍在 `src`；相关类型、回归与构建按最终结构复验。

SDK 服务仍使用既有 Workbench 合同、纯数据适配器和部分工具协作接口。本轮落实产品内容与工具实现的所有权，不宣称所有 SDK 封装已完全独立于 Workbench。

提交前 Next 配置和 Desktop 静态边界检查通过，日志见 `/tmp/pi-naming-commit-config-tests.log`；最终 lint 见 `/tmp/pi-naming-commit-lint.log`。
