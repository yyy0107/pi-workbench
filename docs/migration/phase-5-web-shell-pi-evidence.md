# Phase 5 Web / Shell / Pi Evidence

记录日期：2026-08-30

本文件收口 [Apps / Packages / Electron / Tauri 迁移计划的 Phase 5](../workbench-apps-packages-tauri-migration-plan.md)：
Next 产品入口已从仓库根物理迁入 `apps/web`，Workbench Shell 与 Pi contributions 的 owner/组合边界已稳定，Web
standalone 能从原始 Next 输出直接启动。本文件不把 Phase 6 standalone/Runtime manifest staging、Phase 7 Electron app
relocation、静态 desktop renderer 或 Tauri 提前计为完成。

基线 source revision：`77322072c64aa6a15d8ee8bf34927a91669db488`

分支：`codex/agent-runtime-workspace-refactor`

本次记录来自共享 dirty worktree；没有在此 gate 中提交、暂存、reset 或覆盖既有改动，也不是 clean checkout +
`pnpm install --frozen-lockfile` 的证据。

## Physical ownership 与 composition boundary

Phase 5 完成的是原子物理 relocation，而不是为旧根路径保留兼容 shim：

| Owner               | Phase 5 后的物理边界                                                                                                                                                                                  | 约束                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Web app             | [`apps/web`](../../apps/web/package.json) 拥有 `src/app`、Web-only `src/components`/`src/i18n`/`src/workbench`、`public`、Next/PostCSS/components/TypeScript 配置与 custom server                     | 根 `dev`/`build`/`start` 仅保留命令委派和 artifact 启动职责；旧根 `app`、`public`、`server.ts`、Web `workbench` shim 均不保留 |
| Workbench Shell     | [`@workbench/shell`](../../packages/workbench/shell/package.json) 拥有 generic frame、layout、workspace surfaces、共享 UI、Shell i18n 与安装 effect seams                                             | Shell production source 不导入 Pi；宿主通过公开 owner/effect seam 安装产品能力                                                |
| Pi browser adapter  | [`@workbench/agent-runtime-pi-client`](../../packages/agent-runtime/adapters/pi/client/package.json) 拥有 transport、manager、assistant-ui projection 与 client installation                          | 不导入 Pi Server、Node native runtime、应用 store 或 app source                                                               |
| Pi UI contributions | [`@workbench/agent-runtime-pi-contributions`](../../packages/agent-runtime/adapters/pi/contributions/package.json) 拥有 Pi 专属 extension、renderer、settings/toolbox/workspace contribution metadata | `apps/web` 只从 public exports 静态选择并注入；Shell 不反向依赖该 package                                                     |
| Runtime Host        | [`apps/runtime-node`](../../apps/runtime-node/package.json) 继续唯一拥有 Pi Server、Terminal、Automation、Execution 与 native Runtime assembly                                                        | Web settings/SSR 与 standalone closure 不加载 Pi Server、Pi SDK 或 native Runtime graph                                       |

[`apps/web/package.json`](../../apps/web/package.json) 是真实 `@workbench/web` manifest，声明 Web source 的全部直接依赖；
它不声明 `@earendil-works/pi-coding-agent`、`node-pty`、`tree-sitter`、`tree-sitter-bash` 或 `ws`。app alias 只在
[`apps/web/tsconfig.json`](../../apps/web/tsconfig.json) 内映射 `@/*` 到 `src/*`，根 TypeScript project 不再认领 Next
plugin、app alias 或 workspace source。

custom server 的入口现为 [`apps/web/src/server.ts`](../../apps/web/src/server.ts)，其 Next handler 显式调用
`next({ dir: webRoot, ... })`。[`apps/web/next.config.ts`](../../apps/web/next.config.ts) 将绝对
`outputFileTracingRoot` 与 `turbopack.root` 固定为 repository root；include/exclude pattern 仍以新 app root 为解析基准，
且不使用会吞掉共享 Runtime asset 的全局 `packages/**` 排除。source `pnpm dev/start` 与 staged Electron launcher 都从
可信 app-relative 路径注入精确 `WORKBENCH_WEB_ROOT`，不会接受继承的任意绝对覆盖。

Web SSR settings 继续显式接收 settings file 与 request locale。该读取路径只使用 server-safe settings service，不调用
`getAgentDir()`，也不通过 SSR 闭包引入 Pi SDK、Pi Server installation 或 native Runtime。

## Fresh Next standalone 与共享 runtime completion

fresh `pnpm --filter @workbench/web build` 首次证明了 Next `16.3.1` 在 Node `24.16.0` 的一个真实 closure 缺口：原始 trace
中的 `@swc/helpers` 不含 Node 24 `module-sync` 分支需要的 `esm/_interop_require_default.js`，因此未补全的 nested
`apps/web/.next/standalone/apps/web/server.js` 会在 listen 前失败。该失败没有被记录为通过。

最终实现将修复收口为唯一共享 seam
[`scripts/complete-next-standalone-runtime.cjs`](../../scripts/complete-next-standalone-runtime.cjs)：

- `@workbench/web` 的 `postbuild` 对最终 raw standalone root 补全与已安装 Next 精确匹配的完整
  `@swc/helpers` 和 `tslib` package；
- Electron `prepare-package` 调用同一 seam，不复制 package resolution/copy 逻辑；
- 写入前验证 standalone root、现有 package、destination parent 与 realpath confinement；版本不匹配或越界 symlink
  会 fail closed；
- 替换完整 package 后验证 CommonJS、ESM/module-sync helper 与 `tslib.js`，重复执行保持幂等。

补全后的 fresh raw Next output 直接运行 nested `apps/web/.next/standalone/apps/web/server.js`，没有先经过 Electron
staging 或 `completeNextModuleSyncRuntime` 的第二份实现。实际 HTTP smoke 返回 `200`，SSR HTML 为 **75,880 bytes**；
独立 locale 请求在未配置 settings file 时发送 `Accept-Language: zh-CN`，并验证返回
`<html lang="zh-CN">`。显式 settings-file 行为由 Web server/unit boundary 覆盖；这里不把它与 raw smoke 的
字节计数混写，也不只以监听端口打开作为通过标准。

## Tailwind package scan proof

[`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css) 为 Shell 和 Pi contributions 声明窄 Tailwind v4
`@source`，没有扩大到整个 repository。验证 sentinel `bg-border/65` 的生产 source 只存在于
[`packages/workbench/shell/src/workspace-file-tree/explorer-tree.tsx`](../../packages/workbench/shell/src/workspace-file-tree/explorer-tree.tsx)，
不在 Web app source 中重复。fresh production CSS
`apps/web/.next/static/chunks/43wmlnqx_29bn.css` 实际包含对应 selector，证明 app 外 Shell source 被 production scan
覆盖，而不是由 Web 中的同名 class 假通过。

## Standalone closure

补全后的 fresh `apps/web/.next/standalone` closure 为：

| Measurement                                           |  Result |
| ----------------------------------------------------- | ------: |
| Regular files                                         | `2,535` |
| Symlinks                                              |    `81` |
| Total entries                                         | `2,616` |
| Forbidden Pi Server / Pi SDK / native Runtime payload |     `0` |
| Broken symlinks                                       |     `0` |

该 closure 允许 Web-owned Pi client/contributions 被 bundle，但拒绝 Pi Server、`@earendil-works/pi-coding-agent`、
`node-pty`、`tree-sitter`、`tree-sitter-bash` 与其他 Runtime-native ownership 漂入 Web artifact。完整
`@swc/helpers`/`tslib` 是 Next server 在 Node 24 的实际运行依赖，不被误归类为 Runtime payload。

## Final gate

最终 source、manifest、paths、tests 与 ledger 稳定后，以下验证在同一 Phase 5 tree 上通过：

| Gate                                                 | Result | Proof boundary                                                                                                                 |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Root tests                                           | Pass   | `pnpm test:root`：`186/186`；其中新 `scripts/extension-boundaries.test.ts` 为 `14/14`，旧 extension-owned boundary test 已删除 |
| Web tests                                            | Pass   | `@workbench/web`：`73/73`                                                                                                      |
| Shell tests                                          | Pass   | `@workbench/shell`：`334/334`                                                                                                  |
| Pi contributions tests                               | Pass   | `@workbench/agent-runtime-pi-contributions`：`242/242`                                                                         |
| TypeScript                                           | Pass   | root project；apps `2/2`；packages `28/28`                                                                                     |
| Boundary guards                                      | Pass   | workspace dependency、transport boundary、Runtime Host ownership 三项均 exit `0`                                               |
| Foundation / inventory / ledger / public composition | Pass   | 聚合 `15/15`；ownership ledger `--strict` 另行 exit `0`，无 `unassigned` source                                                |
| Electron / standalone hermetic regression            | Pass   | completion、supervisor build、launcher、prepare、budget、staged API-only/combined Runtime smoke：`51/51`                       |
| Fresh Web build and raw standalone                   | Pass   | postbuild 后 raw Node 24 nested server HTTP `200`、`75,880`-byte SSR；独立 `zh-CN` 请求返回正确 `<html lang>`                  |
| Tailwind production sentinel                         | Pass   | Shell-only `bg-border/65` 出现在 fresh production CSS                                                                          |
| Web standalone closure                               | Pass   | `2,535` files、`81` symlinks、`0` forbidden Pi/native payload、`0` broken symlinks                                             |

## Explicit non-claims 与下一阶段

1. 本轮没有运行 Browser、Playwright、full Electron pack 或 installer；没有把 hermetic Electron tests 表述成真实
   packaged application proof。
2. [Phase 4 Runtime Node Evidence](./phase-4-runtime-node-evidence.md) 的 Linux Electron `--dir`、native rebuild/load 与
   staged ↔ packaged full-tree 证据仍是独立历史 gate；本文件没有重跑，也不冒充该证据为 Phase 5 结果。
3. 本轮没有执行 clean checkout、frozen install、macOS、Windows、musl、签名或发行 installer 验证。
4. Phase 6 仍需让 standalone 与 Runtime staging 完全由独立 Web/Runtime manifests 驱动；Phase 7 才移动 Electron app
   并完成平台容器生命周期。静态 desktop renderer 与 Tauri 仍未开始。
