# Phase 8 Milestone A Evidence

记录日期：2026-08-31

本文件收口
[Apps / Packages / Electron / Tauri 迁移计划的 Phase 8 与 Milestone A](../workbench-apps-packages-tauri-migration-plan.md)：
仓库根已从产品 source owner 收缩为 workspace orchestration、共享工具和文档；Web、Runtime 与 Electron
分别由真实 app 拥有，正式 artifact contracts、source-closure 与 hoist-free install 边界已成为永久门禁，
且 Milestone A 的 fresh build、standalone、package、budget 与 native Linux packaged execution 已在清理后产物上通过。

本文件不把 Tauri、静态 desktop renderer、macOS/Windows packaged execution、安装器、签名或 notarization 计为
完成。Phase 9 从本文件记录的已清理 Milestone A 边界继续，不恢复 transition source 或从
Electron artifact 借用 Tauri native bytes。

基线 source revision：`77322072c64aa6a15d8ee8bf34927a91669db488`

分支：`codex/agent-runtime-workspace-refactor`

证据来自共享 dirty worktree；文档起草前 `git status --short` 为 `956` 项。没有 commit、stage、reset、clean
checkout 或覆盖其他参与者的改动。本轮在 exact 输出位置外保留/移走旧的根 `.next` 与
pre-package `dist-electron`，随后由 canonical commands 重建同名输出；这证明的是共享分支当前状态，
不声称执行了 clean-room checkout。

## 最终 source ownership 与根目录闭包

- 根 `app`、`components`、`electron`、`extensions`、`hooks`、`i18n`、`lib`、`platform`、`runtime`、
  `services`、`stores`、`test-utils` 与 `workbench` 旧 production roots 均不存在；根 `server.ts`、
  `next.config.ts` 与迁移期 root `tsconfig.json` 也已删除。空目录不作为视觉残留保留。
- `apps/web`、`apps/runtime-node` 和 `apps/desktop-electron` 各自拥有 entry、manifest、config、build、
  process lifecycle 与 tests。package 只能消费 package public seams，app 之间只通过版本化 artifact manifest
  组合，不通过 import、dynamic import 或 fs/path 回读 sibling app source。
- `scripts/check-source-closure.mjs` 与 workspace dependency、transport、Runtime ownership gates 在根 `pnpm check`
  的唯一聚合路径上执行，机械拒绝根旧 production source、package → app、app → sibling app
  source 以及 Core/Shell 反向引入 Pi/平台实现。Phase 0 machine inventory 已按最终拓扑重生成，
  其 focused test 为 `3/3` pass。
- 共享 artifact admission/source-shape/model-readable policy 归属
  `@workbench/host-artifact-policy`，不再由根 desktop script 隐式拥有；Runtime 遗留 README、test 和 Pi
  resolver hooks 也已迁移或删除。

## Tooling-only workspace root 与 hoist removal

- 根 `package.json` 没有 `dependencies`、Electron `main` 或 electron-builder 产品配置。其唯一的 `8` 个
  `devDependencies` 是仓库工具/测试直接使用的
  `@workbench/agent-runtime-pi-contributions`、`@workbench/extension-sdk`、`@workbench/host-contracts`、
  `@workbench/host-server`、`@workbench/shell` 以及 `oxfmt`、`oxlint`、`tsx`；根 `node_modules` 的
  direct workspace/tool links 与该列表一致。
- 带 `shamefully-hoist=true` 的根 `.npmrc` 已删除，`pnpm config get shamefully-hoist` 返回
  `undefined`。根不再用全局 hoist 掩盖 app/package 未声明依赖。
- `pnpm install --offline --frozen-lockfile` exit `0`，证明当前 lockfile 与收紧后 manifests 一致，
  且安装结果不依赖旧 hoisted layout。
- 根 `dev`、`dev:once` 与 `start` 现由永久 Web/Runtime orchestrators 拥有；`build` 仅依次委托
  Runtime、Web 与 Electron app，`electron:*` 仅编排 app-owned build/package commands。

## 永久 Web/Runtime 拓扑与 artifact contract

- `apps/web/src/server/web-application-host.ts` 是 Web application host；
  `runtime-connected-web-host.ts` 和 `runtime-connected-web-process.ts` 只通过 Runtime connection/control
  contract 组合。旧 compatibility supervisor、external Runtime dev entry、Runtime sidecar child、10 条 transition
  routes 与 delegator 均已删除。
- 根 `web-runtime-orchestrator.mjs`、`web-runtime-watch.mjs` 与 `runtime-source-watch.mjs` 只负责跨 app
  lifecycle/watch orchestration；Web 与 Runtime 仍是独立 process owner，stdout 仅用于版本化 control frames。
- Web manifest 已固定为 schema `2`，唯一 entrypoint 是 artifact-root `web-server.mjs`，不再携带
  transition artifact entry。source、staged 与 packaged manifests 均记录最终 build ID
  `KwGsUzNXjDwCJn0T30at3`、`4,545` files 与 `4,544` resources。
- hoist-free Next standalone 下，completion 只从已验证的
  `apps/web/node_modules/next` app alias 建立 artifact-root `node_modules/next` alias；既有 alias 必须指向同一
  pnpm physical owner，冲突、逃逸或非 symlink 情形全部 fail closed。
- Runtime artifact builder 从 `apps/runtime-node` 的 production dependency 声明和 app-local direct pnpm symlink
  证明 `ws` authority，将 exact package/subpath NFT resolution 重锚到 Runtime app issuer，再投影唯一
  artifact-root `node_modules/ws` alias。它不纳入 `apps/runtime-node` source subtree，也不放宽其他 external
  package 的 provenance。
- Runtime source、staged 与 packaged manifests 均是 schema `2`、`server.mjs`、`2,592` resources，
  且目标一致为 Electron `43.4.1`、Node `24.18.1`、ABI `148`、N-API `10`、
  `x86_64-unknown-linux-gnu` / glibc。

## Fresh Milestone A release gates

本轮仅保留两个核心端到端证据：fresh raw Web standalone 和 canonical native Linux packaged-app
execution。其他错误边界由 focused tests、静态 closure gates 与最终一次全仓 check 覆盖。

1. `pnpm build` 从 fresh exact outputs exit `0`，依次产生 Runtime artifact、Next production/Web artifact 和
   Electron desktop composition。raw standalone smoke 后续 exit `0`：`GET /` 返回 HTTP `200` 与
   `75,880` bytes SSR，并从 standalone 内的 physical pnpm closure 解析 `@swc/helpers`。
2. canonical `pnpm electron:pack` 先再次执行 fresh root build，生成本文件记录的最终 Web build ID
   `KwGsUzNXjDwCJn0T30at3`，然后完成 Electron target native rebuild、staging、budget、
   electron-builder `--dir` 与 Linux packaged execution，整体 exit `0`。
3. packaged smoke 不是启动即通过。它在隔离的 Xvfb/state 下确认唯一 BrowserWindow、sandboxed
   bundled preload、窄 `runtime.bootstrap`、Web/Runtime identity 与 health、authenticated RPC
   (`host.describe` / `session.list`)、Pi Host/multiplex WebSocket、Terminal PTY、titlebar contract，
   并在 app/Web/Runtime acknowledged shutdown 后验证 process groups 为空、ports 关闭。
4. pack pipeline 内的 staged native/API-only/Web-only/split smokes 均通过；pack 结束后的外部
   `/proc` census 不存在 argv/cwd 指向新 staged/unpacked 路径的其他进程，临时 packaged-smoke
   state 目录也已清理。
5. 最终 `pnpm check` exit `0`：oxlint/oxfmt 覆盖 `1,686` 个文件；workspace dependency、
   transport、Runtime ownership 与 source-closure checks 通过；`3` 个 apps 与 `29` 个 packages 的
   typecheck 通过；root tests 为 `152` pass、`1` 个预期 Windows skip，apps/packages tests 全部通过。

## 最终 artifact 与 budget 记录

| Surface                         | Final evidence                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Web manifest                    | schema `2`; `web-server.mjs`; build ID `KwGsUzNXjDwCJn0T30at3`                     |
| Web manifest closure            | `4,545` files / `4,544` resources                                                  |
| Staged/packaged Web payload     | `129,661,826` bytes (`123.7 MiB`)                                                  |
| Runtime manifest                | schema `2`; `server.mjs`; `2,592` resources                                        |
| Staged/packaged Runtime payload | `30,421,327` bytes (`29.0 MiB`)                                                    |
| Electron target                 | `43.4.1`; Node `24.18.1`; ABI `148`; N-API `10`; Linux x64 glibc                   |
| Staged app budget               | `160,313,886` regular-file bytes (`152.9 MiB`); `7,156` regular files; budget pass |

source、staged 和 `dist-electron/linux-unpacked/resources/desktop-runtime` 中的 Web build ID、Runtime target、
entrypoint 与 manifest closure 相同。Web 与 Runtime 的 staged/packaged regular-file bytes 也分别一致；
symlink provenance 由 artifact admission/equivalence gates 另行校验，不靠这个 byte 汇总代替。

## Focused safety gates

| Boundary                                                                      | Result         |
| ----------------------------------------------------------------------------- | -------------- |
| Runtime/artifact-policy focused aggregate                                     | `64/64` pass   |
| Runtime artifact builder（含 hoist-free `ws` authority/projection）           | `47/47` pass   |
| Web standalone Next root alias completion                                     | `5/5` pass     |
| 剩余 Pi resolver/legacy root regression set                                   | `104/104` pass |
| workspace dependency/transport/Runtime ownership/source closure               | pass           |
| frozen offline install                                                        | pass           |
| fresh Runtime/Web/Electron build + raw standalone + canonical pack/budget     | pass           |
| native Linux packaged Window/RPC/Pi WS/Terminal PTY/titlebar/shutdown cleanup | pass           |

## Explicit non-claims

1. packaged execution contract 当前只在 native Linux x64 glibc + Xvfb + `/proc`/POSIX process groups 上完成。
   macOS/Windows 目标目录或 manifest 的结构检查不等于相同平台的 window/RPC/WS/PTY/cleanup
   execution。
2. 没有验证 musl、macOS/Windows native runner、DMG/ZIP/NSIS/AppImage 安装行为、代码签名、
   notarization 或发布上传。
3. Tauri sidecar、Rust supervisor、bundled diagnostics renderer 与它们的 target-triple/native matrix 尚未由
   Phase 8 实现；它们属于下一步 Phase 9。
4. Electron 仍使用 Next Web application；共享静态 desktop renderer 是 Milestone B 工作。
5. 证据来自共享 dirty worktree，没有 clean checkout。`--offline --frozen-lockfile`、fresh exact-output
   build/package 和全部机械 gates 已通过，但本文件不把它们改写为没有实际执行的
   clean-room run。
