# 验证与继续执行

## Spec Kit

在仓库根运行 `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks`，应返回本 Spec。使用 `$speckit-implement` 继续第一个未完成且前置已满足的任务，使用 `$speckit-converge` 核对实际代码。checks/requirements 只表示规范就绪。

## 每项迁移

1. 核对 package-map 中来源、目标、公开入口和消费者，运行对应 package 的 `pnpm --filter <name> typecheck` 与 `pnpm --filter <name> test`。
2. 运行 `pnpm check:workspace-dependencies`，结构检查启用后同时运行 `pnpm check:package-structure`。
3. 对照迁移前后的测试清单；文件移动不能减少发现数量。
4. 格式和静态检查使用 `pnpm exec oxfmt --check <changed>`、`pnpm exec oxlint <changed>`。

## 最终验收

运行 `pnpm check`、`pnpm build`；运行当前 app manifest 中的 Runtime native smoke、Electron artifact/native smoke 和代表性 renderer smoke。仅使用已有自测试或 mock，不发起付费模型请求。

Web/Desktop 冒烟覆盖：会话创建/恢复与流式取消、Composer命令/附件、Markdown/代码/文件链接、Explorer/Review/浏览器/终端、设置中英文及主题密度圆角、Pi配置与资源重载。未执行的检查必须写入 tasks 证据为未完成，不能用构建通过代替交互验证。

## src/lib 验证

类型配置同时包含 src 与 lib；测试发现兼容两处的历史共置测试，完成迁移后仅 tests 保留测试。结构检查要求 src/lib 有实际源码、各最多一级子目录，公开 TypeScript 入口（既有 CommonJS 构建工具除外）在 src；依赖检查将 lib 视为生产源码并禁止跨包引用 lib。Web/Desktop Tailwind 同时扫描两处，现有源码 bundling 保持。

逐包核对 src 有实际能力实现/契约，lib 为有实际消费者的辅助模块，README 给出职责。实现保留 TS/TSX，不将 TS 改写为 JS；执行所属包与消费者 typecheck、相关测试与 lint。检查器拒绝整个 src 只有导出的空壳；语义职责需要结合模块内容审查，不能只看文件数。

## 已使用的产物与浏览器验证入口

```bash
pnpm --filter @workbench/runtime-node run smoke:native
pnpm --filter @workbench/desktop-electron run smoke:native
pnpm --filter @workbench/web run smoke:standalone
pnpm --filter @workbench/desktop-electron run pack
PI_PROMPT_HIGHLIGHT_BROWSER=/usr/bin/google-chrome node --import ./scripts/register-typescript-test-loader.mjs --test packages/pi/settings-ui/tests/prompt-placeholder-highlight.browser.test.ts
```

Electron 必须使用 `run pack`，该脚本包含 staged Runtime 与实际打包应用的窗口、RPC、双 Pi WebSocket、PTY、标题栏、重启/清理及产物预算验证。这里产物仅在本地生成，不发布。浏览器可执行文件按当前环境替换。

打开运行中的 Workbench 后，`node scripts/check-workbench-style-scope.mjs <renderer-websocket-url>` 可通过已有 CDP 入口验证作用域与两个安装实例隔离、区域控件 token、Portal 圆角、滚动条主题和窗口 resize 动画。该检查已按现有图标档位（S 14/24、M 16/28、L 18/32）更新旧断言，产品样式没有因此改变。

原生 Node/构建工具直接消费的 TS 模块使用显式 `.ts` 引用；`allowImportingTsExtensions` 配合现有 `noEmit` 只处理模块解析，不允许 JS 实现，不改变应用 bundling。
