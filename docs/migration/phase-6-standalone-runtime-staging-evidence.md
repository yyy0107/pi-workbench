# Phase 6 Monorepo Standalone / Runtime Staging Evidence

记录日期：2026-08-30

本文件收口
[Apps / Packages / Electron / Tauri 迁移计划的 Phase 6](../workbench-apps-packages-tauri-migration-plan.md)：
发行构建现在由独立 Web artifact manifest、Runtime artifact manifest 与只有四个字段的 desktop composition
驱动；Electron staging 不再从隐式根路径、调用者 cwd 或旧 single-server allowlist 推导入口和资源。

本文件不把 Phase 7 `apps/desktop-electron` relocation、静态 desktop renderer、Tauri scaffold、签名
installer、macOS/Windows/musl 发行验证计为完成。

基线 source revision：`77322072c64aa6a15d8ee8bf34927a91669db488`

分支：`codex/agent-runtime-workspace-refactor`

本次记录来自共享 dirty worktree（记录时 `git status --short` 为 `939` 项）；没有提交、暂存、reset 或覆盖其他
参与者的改动，也没有执行 clean checkout + `pnpm install --frozen-lockfile`。所有 artifact build、package smoke、budget
与产物指标均来自同一次 `pnpm electron:pack` fresh run；其 `prebuild` guarded 删除了 `apps/web/.next`、
`.desktop-build` 与 `.electron-build`，没有复用此前失败的 staged output。完整 `pnpm check` 与下文 focused verification
在最终 Phase 6 修正后、任何 Phase 7 relocation 改动前全绿；计数和历史 `electron/**` 命令边界冻结在该 Phase 6 tree，
不混入随后新增或移动的测试。

## Artifact authority 与拓扑

Source authority：

- `.desktop-build/web/artifact-manifest.json`
- `.desktop-build/runtime-node/<target-key>/artifact-manifest.json`
- `.desktop-build/desktop-artifacts.json`

Staged authority：

- `.electron-build/app/desktop-runtime/web/artifact-manifest.json`
- `.electron-build/app/desktop-runtime/runtime-node/<target-key>/artifact-manifest.json`
- `.electron-build/app/desktop-runtime/desktop-artifacts.json`

source 与 staged composition 都只有以下四个字段；source 选择 Node `abi137` target，staged 选择 Electron
`43.4.1` / Node ABI `148` target：

```json
{
  "schemaVersion": 1,
  "artifactKind": "workbench-desktop-artifacts",
  "webArtifactManifest": "web/artifact-manifest.json",
  "runtimeArtifactManifest": "runtime-node/<selected-target>/artifact-manifest.json"
}
```

Web、Runtime builders 各自只替换自己的最终 subtree，并通过同一个 public resolver 在 publish 前后重新 admission。
Electron staging 先 admission source children，copy 后再次 admission staged children，再生成 composition；launcher 只消费
composition 中的 manifest-relative path，不扫描目录猜测入口。

## Web artifact contract

fresh Web build ID：`Z9T5U7mbnxe_zYIqR8NUA`。

| Measurement                     | Value                                                             |
| ------------------------------- | ----------------------------------------------------------------- |
| manifest schema / kind          | `1` / `workbench-web`                                             |
| relative app directory          | `apps/web`                                                        |
| primary / compatibility entry   | `web-server.mjs` / `server.mjs`                                   |
| required server files           | `apps/web/.next/required-server-files.json`                       |
| control / shutdown              | NDJSON stdio v1; `shutdown` → `shutdown-ack`; maximum `60,000 ms` |
| external packages               | exact `[next]`                                                    |
| manifest files / resources      | `4,607` / `4,605`                                                 |
| actual regular files / links    | `4,608` / `66`                                                    |
| total tree entries / bytes      | `4,674` / `127,920,298`                                           |
| dependency packages             | `38`                                                              |
| TypeScript / maps / broken      | `0` / `0` / `0`                                                   |
| Runtime-owned Pi/native package | `0`                                                               |
| forbidden test-shaped files     | `0`                                                               |

Next `16.3.1` 的 `dist/server/config-schema.js` 在 production custom-server `app.prepare()` 路径中顶层、无条件
`require("../cli/next-test")`，并读取 `SUPPORTED_TEST_RUNNERS_LIST`。通用 source-shape policy 正确地把
`next-test.js` 识别为 test-shaped；直接删除却会使正式 Web Host 在 ready 前失败。因此 Web artifact 只有一个额外的
test-shaped production exception：Next package 在 artifact 内 canonical realpath 下的物理
`dist/cli/next-test.js`。

这个 exception 不是 basename allowlist。共享 policy
[`scripts/web-artifact-next-runtime-exception.cjs`](../../scripts/web-artifact-next-runtime-exception.cjs) 同时证明：

- `node_modules/next` confined realpath、`next` package identity 与 regular non-symlink files；
- `config-schema.js` 是可解析的 CommonJS script，且存在未被 program-scope binding shadow 的顶层静态
  `require("../cli/next-test")`；
- `createRequire(config-schema).resolve()` 精确落到同一 physical file；
- manifest resources 恰好拥有该 physical path 一次。

Producer 只为这一个 physical path 跳过 prune，Electron budget 复用同一 policy 只从 generic test-shaped report
减去它。相同 basename 位于其他 package、comment/dead/nested/shadowed/ESM dependency、缺失或 symlink file、逃逸 Next
alias、缺失 manifest ownership 都 fail closed。`folder-test.svg` 仍不是 code-shaped test file。

最后一个未通过的 candidate 没有作为独立 tree/manifest snapshot 保留，因此本文件不再给出无法从现存产物复核的
before/after 精确 byte、file 或 package delta。可复核的最终事实是：该 physical file 在 manifest resources 中恰好出现
一次，Web artifact 只有这一个 test-shaped production exception，其他 forbidden test-shaped files 为 `0`；删除它会使
正式 Web Host 在 ready 前失败。这是 production closure 修正，不是放宽通用裁剪。

## Runtime artifact contract

| Measurement                     | Source Node target             | Staged Electron target                       |
| ------------------------------- | ------------------------------ | -------------------------------------------- |
| schema / kind                   | `2` / `workbench-runtime-node` | `2` / `workbench-runtime-node`               |
| runtime / Node / ABI            | Node `24.16.0`, ABI `137`      | Electron `43.4.1`, Node `24.18.1`, ABI `148` |
| target envelope                 | Linux x64 glibc                | Linux x64 glibc                              |
| regular files / links           | `2,598` / `161`                | `2,603` / `161`                              |
| tree entries / bytes            | `2,759` / `30,446,196`         | `2,764` / `30,456,474`                       |
| dependency packages             | `104`                          | `104`                                        |
| resources / model-readable      | `2,592` / `160`                | `2,597` / `160`                              |
| TS / test-shaped                | `99` / `4`                     | `99` / `4`                                   |
| forbidden outside model closure | `0` TS / `0` test-shaped       | `0` TS / `0` test-shaped                     |
| maps / broken links / lockfiles | `0` / `0` / `0`                | `0` / `0` / `0`                              |

Runtime third-party ownership is exact：

- external：`[@earendil-works/pi-coding-agent,node-pty,tree-sitter,tree-sitter-bash,ws]`；
- dynamic：`[@earendil-works/pi-ai,@earendil-works/pi-coding-agent]`；
- native：`[node-pty,tree-sitter,tree-sitter-bash]`；
- aggregate Web + Runtime external：上述五项加 `next`，共六个唯一 package；
- `@workbench/*` external：`0`。

`160` 个 model-readable resources 是从 canonical Pi package 精确派生的 README/docs/examples closure。只有这个
manifest-owned closure 可以包含上述 `99` 个 TypeScript 与 `4` 个 test-shaped examples；它们不属于 startup、NFT 或
dynamic-loader admission，closure 外均为 `0`。

Electron native inventory 为 `1,098` bytes，SHA-256
`d6e47f535fc773326af0396f52164338af0cd3f3c158a5ca09ebf9e35ca5ffaf`。Electron-as-Node native smoke 从 staged
Runtime 内实际加载：

- `node-pty/build/Release/pty.node`
- `tree-sitter/prebuilds/linux-x64/tree-sitter.node`
- `tree-sitter-bash/prebuilds/linux-x64/tree-sitter-bash.node`

parser 解析 Bash program 无 error，PTY challenge 完成；没有从 workspace 或 staging 外加载 addon。

## Staging、packaging 与 full-tree equivalence

| Measurement                                                                      | Value                    |
| -------------------------------------------------------------------------------- | ------------------------ |
| staged app regular files                                                         | `7,223`                  |
| staged app bytes                                                                 | `158,550,806`            |
| staged dependency packages                                                       | `141`                    |
| staged `desktop-runtime` files / links                                           | `7,213` / `227`          |
| staged `desktop-runtime` entries / bytes                                         | `7,440` / `158,488,403`  |
| source Web ↔ staged Web                                                          | `4,674` entries, 0 delta |
| source Electron Runtime ↔ staged Runtime                                         | `2,764` entries, 0 delta |
| staged ↔ packaged `desktop-runtime`                                              | `7,440` entries, 0 delta |
| packaged `resources/app` regular files / bytes                                   | `10` / `62,403`          |
| packaged budget envelope (`resources/app` + sibling `resources/desktop-runtime`) | `7,223` / `158,550,806`  |
| maps / broken links / lockfiles                                                  | `0` / `0` / `0`          |

### Phase 4 → Phase 6 milestone drift

Phase 4 是最近一个保留完整 Electron directory-package 指标的已接受 milestone。以下比较只使用该历史证据与本轮现存
manifest/tree；Phase 4 没有记录 aggregate dependency-package count，因此该维度明确为 unavailable，不从当前 `141`
倒推出历史值或虚构 delta。

| Measurement                     | Phase 4 accepted milestone      | Phase 6 fresh output        | Recorded drift            |
| ------------------------------- | ------------------------------- | --------------------------- | ------------------------- |
| Electron Runtime files / links  | `2,603` / `161`                 | `2,603` / `161`             | `0` / `0`                 |
| `desktop-runtime` files / links | `7,404` / `225`                 | `7,213` / `227`             | `-191` / `+2`             |
| `desktop-runtime` entries       | `7,629`                         | `7,440`                     | `-189`                    |
| Web-side bytes                  | approximately `94.7 MiB`        | `127,920,298` (`122.0 MiB`) | approximately `+27.3 MiB` |
| Runtime bytes                   | approximately `29.0 MiB`        | `30,456,474` (`29.0 MiB`)   | no material drift         |
| aggregate dependency packages   | unavailable in Phase 4 evidence | `141`                       | unavailable               |

Runtime regular files、links 与约 `29.0 MiB` payload 保持稳定，因此 entry 漂移被机械限制在 Web/composition 层。Phase 4
测量的是根 migration supervisor 下的旧 Web staging topology；Phase 6 改为最终 manifest-owned Web artifact，加上固定
composition/launcher envelope，并由 Web manifest 精确拥有 completed Next standalone resources、两个 control entry 与
唯一 Next production exception。两代 Web ownership/measurement scope 不同，因而出现更少的 regular files、两个新增
symlink 和更大的 Web byte closure；这不是 Runtime/native payload 漂移。Phase 4 的 Web byte 值只有一位小数，故 byte
drift 也只按 approximate 值记录。

`pnpm electron:pack` 通过 Electron `43.4.1` native rebuild、staging budget、全部 staged smokes、
`electron-builder 26.15.3 --dir` 与 packaged budget。packaged layout 为：

- app：`dist-electron/linux-unpacked/resources/app`
- artifacts：`dist-electron/linux-unpacked/resources/desktop-runtime`

afterPack 没有把 Runtime 重新塞回 app `node_modules`；staged ↔ packaged 比对包含 regular-file bytes/hash/mode 与原始
symlink target。

## Process / lifecycle smoke

| Smoke                  | Phase 6 child cwd boundary                       | Fresh result                                                                                                      |
| ---------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| raw Next standalone    | raw standalone artifact layout                   | HTTP `200`；SSR HTML `75,880` bytes                                                                               |
| compatibility combined | staged `desktop-runtime` release-equivalent cwd  | ready；`host.describe` / `session.list`；Pi host + mux WS；Terminal PTY；untrusted Host `403`                     |
| API-only Runtime       | unrelated isolated state cwd                     | health/identity `200`；missing bearer `401`；malicious origin `403`；RPC；3 authenticated WS；shutdown ack/exit 0 |
| Web-only artifact      | unrelated isolated temporary cwd                 | `zh-CN` SSR `200`；Runtime unavailable API `503`；ready → shutdown ack → exit 0                                   |
| split Web + Runtime    | isolated Web cwd + isolated Runtime state cwd    | Web ready → Runtime start/ready → SSR/API probe → identity/RPC/3 WS/PTY → Runtime ack → Web ack                   |
| Electron native        | manifest-selected Electron Runtime artifact root | Electron `43.4.1` / ABI `148`；三个 addon 均从 staged Runtime 内加载                                              |

Web-only `503` 是刻意证明 Web child 不内嵌或偷偷启动 Runtime；split smoke 把 Web ready origin 作为 Runtime
`allowedOrigins`，随后才验证 identity、Pi RPC/WS、Terminal WS。Phase 6 的 combined smoke 使用 staged
`desktop-runtime`，而三个 separate-process smoke 刻意使用不相关的 cwd，以证明 manifest entry/resource 不依赖 repository
cwd；它们都使用隔离 state，control shutdown 后退出并清理临时目录。这是 arbitrary-cwd safety 加 combined
release-cwd 的证据，但没有字面执行“Web-only、API-only、split 三者各自都以 staged `desktop-runtime` 为 cwd”，本文件不把
该限制追溯改写成已经通过。

### Phase 7 relocation follow-up（不改写 Phase 6 冻结指标）

后续 Phase 7 mechanical relocation 把 package gate 加强为：API-only、Web-only 与 split smoke 都显式接收 staged
`desktop-runtime` 作为 `childWorkingDirectory`，combined smoke 继续使用同一 root。该 relocation 后的新 gate 已另从 fresh
输出通过：

- fresh root `pnpm build` 生成 Web build `yCmQBq_ki78pbju6IC-Wi`；
- app-local `pnpm --filter @workbench/desktop-electron run pack` exit `0`；
- Electron-native、compatibility combined、API-only、Web-only 与 split 五类 smoke 全部通过，其中三个 separate-process
  smoke 的 child cwd 均为 staged `desktop-runtime`；
- `electron-builder --dir`、`7,223`-file packaged budget 与随后 `pnpm electron:budget` 全部通过。

这是 Phase 7 relocation 的追加发行证据，只关闭上段记录的 literal release-cwd 限制；它不改变本文件冻结的 Phase 6 build
ID、`150/100/132` 测试计数、tree sizes 或 milestone drift，也不等同于 Phase 7 其余 lifecycle 工作完成。

## Verification gates

| Gate                               | Frozen Phase 6 result                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| complete repository check          | `pnpm check` pass；在最终 Phase 6 修正后、任何 Phase 7 relocation 改动前执行                 |
| Web                                | tests `150/150`；typecheck pass；fresh Next production build pass；不包含 Phase 7 后新增测试 |
| Runtime Node                       | tests `100/100`；typecheck pass                                                              |
| historical root Electron test glob | tests `132/132`；native/combined/API-only/Web-only/split/package/budget pass                 |
| Next exception policy              | focused `11/11`；source-shape + exception + budget aggregate `34/34`                         |
| boundary guards                    | workspace dependency、transport boundary、Runtime Host ownership 全部 pass                   |
| targeted lint / format             | 下列 exact exception/producer/budget/package 八个文件 pass                                   |
| source/staged/packaged closure     | exact manifests、0 forbidden、three equivalence comparisons 全部 pass                        |

以下命令与路径按 Phase 6 cutoff 原样记录；其中 `electron/**` 随后的 Phase 7 relocation 不改变这里的历史 owner/count：

```bash
pnpm check
pnpm check:workspace-dependencies
pnpm --filter @workbench/runtime-node typecheck
pnpm --filter @workbench/runtime-node test # 100/100
pnpm --filter @workbench/web typecheck
pnpm --filter @workbench/web test # 150/150 at the Phase 6 cutoff
node --test electron/*.test.cjs # 132/132
node --test scripts/web-artifact-next-runtime-exception.test.cjs # 11/11
node --test scripts/artifact-source-shape-policy.test.cjs scripts/web-artifact-next-runtime-exception.test.cjs electron/desktop-runtime-budget.test.cjs # 34/34
pnpm exec oxlint scripts/web-artifact-next-runtime-exception.cjs scripts/web-artifact-next-runtime-exception.test.cjs apps/web/scripts/build-web-artifact.ts apps/web/test/server/web-artifact-builder.test.ts electron/desktop-runtime-budget.cjs electron/desktop-runtime-budget.test.cjs electron/build-package.cjs electron/build-package.test.cjs
pnpm exec oxfmt --check scripts/web-artifact-next-runtime-exception.cjs scripts/web-artifact-next-runtime-exception.test.cjs apps/web/scripts/build-web-artifact.ts apps/web/test/server/web-artifact-builder.test.ts electron/desktop-runtime-budget.cjs electron/desktop-runtime-budget.test.cjs electron/build-package.cjs electron/build-package.test.cjs
pnpm electron:pack
node scripts/web-standalone-smoke.cjs
pnpm electron:budget
```

## Explicit non-claims 与下一阶段

1. 本轮没有运行 Browser、Playwright、GUI window smoke 或 installer；`--dir` 证明的是 Linux unpacked directory
   package，不是签名发行物。
2. 没有执行 clean checkout、frozen install、macOS、Windows、musl、签名或 notarization 验证。
3. exact Web Next production exception 与 Runtime Pi model-readable resources 是两个互不替代的 closure；前者是正式
   startup dependency，后者明确不是 startup admission。
4. 在本证据冻结的 Phase 6 cutoff，根 `electron/` 尚未物理迁入 `apps/desktop-electron`。随后 Phase 7 已完成 mechanical
   relocation，并以上述 fresh package follow-up 关闭新 release-cwd gate；这些结果不追溯计入 Phase 6 数值。显式 dev
   endpoint ownership、production Web→Runtime 启动顺序与 sibling crash/orphan cleanup 仍未完成，静态 desktop renderer 与
   Tauri 仍未开始。
