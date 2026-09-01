# Phase 7 Desktop Electron Evidence

记录日期：2026-08-31

本文件收口
[Apps / Packages / Electron / Tauri 迁移计划的 Phase 7](../workbench-apps-packages-tauri-migration-plan.md)：
Electron 已成为 `apps/desktop-electron` 拥有的容器与 artifact composition app；生产运行只消费 staged Web/Runtime
artifacts，开发运行由根 orchestrator 分别拥有 Web、Runtime 与 Electron，不让 Electron 读取 sibling app source。

本文件不把静态 desktop renderer、Tauri、macOS/Windows packaged execution、musl、签名、notarization 或 installer
验证计为完成。

基线 source revision：`77322072c64aa6a15d8ee8bf34927a91669db488`

分支：`codex/agent-runtime-workspace-refactor`

证据来自共享 dirty worktree；最终记录时 `git status --short` 为 `927` 项。没有 commit、stage、reset、clean checkout
或覆盖其他参与者的改动。Phase 7 fresh build/package 与开发 E2E 完成后，Phase 8 的 artifact-policy package 与根
Runtime 文档/残留清理已在同一共享树开始；下文明确区分 Phase 7 发行产物与后续源码整理。

## 最终所有权与运行拓扑

- 根 manifest 不再拥有 Electron `main`、electron-builder config、`productName`、`desktopName` 或 Electron-only
  dependencies；这些均属于 `@workbench/desktop-electron`。
- Electron main/preload、窗口、packaged lifecycle、probe、packaging、budget 与 tests 均位于
  `apps/desktop-electron`。
- Electron production main 只解析 `process.resourcesPath/desktop-runtime` 内的 composition 与 child manifests；不读取
  `apps/runtime-node/src`，也不从 workspace `node_modules` 猜测 Runtime。
- 生产顺序是 Web ready → Runtime start（`allowedOrigins = [Web origin]`）→ Runtime ready → BrowserWindow；退出顺序
  是先停止 renderer 请求，再 Runtime shutdown/ack，最后 Web shutdown/ack，并对超时或 crash 做有界 exact-tree cleanup。
- preload 是 sandbox-compatible、staging-time bundled 的 Electron adapter。renderer 只能从可信当前 main frame 同步取得
  `runtime.bootstrap`；token 不进入 argv、环境变量、ready frame 或 renderer-readable diagnostics。
- managed development 的稳定 manager 启动一个 token-free source sentinel 和 one-shot orchestrator。每一代依次拥有
  Web、Runtime、Electron；owner 通过严格 Node IPC frame 登记，manager 在回 ACK 前自行采集 PID/start identity、PGID、
  cwd、executable 与 exact argv。
- Web 与 Runtime 的 TypeScript entry 使用 Node `--import <exact tsx loader>` 在原进程内加载，因此 child PID、控制帧 PID
  与 detached PGID leader 保持相同；没有把 Runtime NDJSON stdout 交给 `tsx watch`。

## Fresh production build 与 Linux packaged execution

Phase 7 的 fresh production 输出使用 Web build ID `a7XnX-XKCD7jYB96oCAFr`。随后执行 app-owned canonical directory
package：

```bash
pnpm --filter @workbench/desktop-electron run pack
```

结果 exit `0`，并实际完成：

1. manifest-owned Web 与 Runtime artifact admission；
2. Electron `43.4.1` / Node `24.18.1` / ABI `148` / N-API `10` target 的 native materialization；
3. electron-builder `--dir` 到 `dist-electron/linux-unpacked`；
4. native Linux packaged-app execution smoke；
5. 最终 packaged layout/budget validation。

本轮 Web payload 约 `124.5 MiB`，Runtime payload 约 `29.0 MiB`，最终 budget 报告 `7,241` 个文件。Web manifest
记录 `4,629` files / `4,627` resources，source 与 staged manifest 的 build ID 相同。Runtime materializer 只可修改
producer-owned临时 candidate 内、共享 native policy 导出的 exact roots；最终 artifact、任意仓库内目录、伪 target、外部
package/symlink/hardlink provenance 与 non-native mutation 均 fail closed。

Linux packaged-app smoke 不是“进程启动即通过”。它在自有 Xvfb、isolated state 与 start-time-anchored process groups 下
验证：

- BrowserWindow 创建、sandboxed bundled preload 与可信 `runtime.bootstrap`；
- Web/Runtime ready 与 exact host identity；
- authenticated HTTP RPC、Pi WebSocket、Terminal WebSocket/PTY；
- titlebar overlay contract；
- graceful renderer stop、Runtime/Web acknowledged shutdown；
- Electron、Web、Runtime、PTY helper 与 Xvfb 无残留。

补充的 packaged lifecycle direct diagnostic 使用实际 unpacked Electron-as-Node executable 与 packaged
`resources/desktop-runtime`：Web `GET /` 返回 `200`，Runtime protocol v1 ready，`session.stop()` 后两个 detached leaders 与
PGID 均消失，外部端口/process census 为零。该诊断没有输出 token、原始子进程环境或未脱敏 stderr。

## Managed development 与 connect-existing E2E

核心开发 E2E 使用：

```bash
xvfb-run -a pnpm electron:dev
```

最终实际结果：

1. Web 在 `http://127.0.0.1:3000` ready；代理后的 `/api/identity` 返回 HTTP `200`、Host protocol v1 与 exact Runtime
   PID/instance ID。
2. owner census 同时看到一个稳定 manager、一个 source watcher/sentinel、一代 orchestrator，以及各自为 detached
   PGID leader 的 Web、Runtime 与 Electron；Electron window 完成真实 `GET / 200`。
3. 在 `packages/**/src` 创建一个无害、受监视的 JSON probe 后，manager 先完成旧 Electron→Runtime→Web cleanup，再启动
   新一代。manager PID 未变化；旧 Web/Runtime/Electron 三个 leader 全部消失；Runtime PID 与 instance ID 均变化；没有
   generation overlap。
4. 删除 probe 又完成一代同样的有序替换，临时文件没有留在工作树。
5. 从当前 Runtime PID 的唯一 loopback listening socket取得 direct origin 后，执行显式 connect mode：

   ```bash
   WORKBENCH_WEB_ORIGIN=http://127.0.0.1:3000 \
   WORKBENCH_RUNTIME_ORIGIN=http://127.0.0.1:<runtime-port> \
   xvfb-run -a pnpm electron:dev:connect
   ```

   命令 exit `0`，证明 Web 暴露有效 Runtime identity，且 direct Runtime 的 unauthenticated `401` Bearer/CORS fence
   明确允许该 Web origin。该模式不接收 token，也不伪称无凭据可以证明两个 origin 是同一 Runtime instance；它只拥有
   自己启动的 Electron。原 managed Runtime PID/instance ID 在该命令后保持不变。

## Crash 与 orphan cleanup E2E

第一次真实 crash 注入暴露了一个有效缺口：Electron 在 Linux 上启动约 `50 ms` 后会把 `/proc/cmdline` 从两个 NUL 参数
`[electronExecutable, desktopElectronRoot]` 改写成一个精确的
`"<electronExecutable> <desktopElectronRoot>"` process title。旧 registry 把这个合法、同 generation 的 title rewrite
视为 argv identity drift，因而 Web/Runtime/manager 已清理但 Electron PGID 残留。

修复没有放宽任意 argv：注册仍只接受精确两个参数；cleanup 仍要求同一 PID、Linux start time、PGID、cwd 与 executable，
并且只额外接受上述两个已登记参数的 exact space-joined 单参数转换。任何额外参数、quoted decoy、不同路径、不同
start time/PID reuse 或其他一参数值继续 fail closed。正负回归通过后重新执行真实 crash：

1. 完整启动 Web、Runtime、Electron 并取得 HTTP `200` identity；
2. 对当前 one-shot orchestrator execution PID 精确发送 `SIGKILL`；
3. 外层命令按预期 exit `1`，表示被注入的非正常 generation；
4. manager、TSX wrapper/execution、Web、Runtime、Electron 六个记录 PID 全部消失；
5. port `3000` 关闭；外部 census 无 source watcher、sentinel、orchestrator、Web、Runtime、Electron 或 Xvfb 残留。

这同时证明异常路径不会把一次 crash 误记为成功，也不会依靠 basename/port 范围猜测并误杀不相关进程。

## Focused safety gates

Phase 7 的高风险/错误边界使用聚焦测试，而不是为每个机械移动反复运行全仓：

| Boundary                                                                 | Result                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| packaged lifecycle + packaged execution + build-package focused set      | `34/34` pass                                        |
| Electron main/preload boundary                                           | `4/4` pass                                          |
| dev owner registry + watch, including exact Electron title rewrite/decoy | `29/29` pass                                        |
| Linux exact stale-owner/source-watcher classification                    | `11/11` pass                                        |
| Windows command-line static boundary                                     | pass；真实 argv execution test 在 Linux 按平台 skip |
| Runtime in-process loader direct control diagnostic                      | ready PID = child PID；graceful shutdown；0 errors  |
| Runtime/Web/Electron affected typechecks                                 | pass                                                |
| workspace dependency/transport/Runtime ownership checks                  | pass                                                |
| targeted oxlint/oxfmt                                                    | pass                                                |

在最终开发 PID 修正之前，完整 `pnpm test` 已通过（root `165` pass、`1` 个预期 Windows skip，apps/packages 全绿）；
最终 delta 由上表的 exact owner/loader/watch tests 与真实 managed E2E 覆盖。没有在每个小修正后机械重跑完整 suite。

## Explicit non-claims

1. packaged execution contract 当前只在 native Linux + Xvfb + `/proc`/POSIX PGID 上完成。macOS/Windows 或 cross target
   的 manifest/layout/budget artifact validation 不等同于 window/RPC/WS/PTY/cleanup execution。
2. canonical `electron:pack` / `electron:dist` 在无法运行 native execution contract 的 target 上 fail closed；只有显式
   `electron:*:artifact` 可返回结构化 `execution: "not-run"`，且不声明 release-green。
3. 没有验证 macOS/Windows native runner、musl、DMG/ZIP/NSIS/AppImage 安装行为、代码签名、notarization 或发布上传。
4. Electron renderer 仍使用 Next Web application；静态 desktop renderer 与 Tauri 尚未开始。
5. 没有 clean checkout 或 clean-room install；证据来自共享 dirty worktree。Phase 8 最终仍需自己的 frozen install、
   `pnpm check`、build 与重新打包门，不能把本文件的 Phase 7 artifact 证据代替后续 schema/closure 变更验证。
