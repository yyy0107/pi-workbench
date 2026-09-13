# 包命名统一验收

本轮基于 `e2605719`，用户确认范围为“统一全仓目录名与 package name”。完整映射见 [package-naming-map.json](package-naming-map.json)，规则见 [package-naming.md](package-naming.md)。

## 结果

- 保留 72 个库包及能力边界；53 个目录迁移，15 个 package name 更新。
- 所有库包叶目录均与 `@workbench/` 后缀逐字一致，0 命名违规。
- 原有 535 个测试文件保留；清单还核对了 tests/ 下 545 个受控文件（含 fixtures、辅助文件等），无遗漏。
- 源码 imports/exports、manifest 依赖、pnpm filters、workspace links、CSS 来源、构建资源、静态边界、当前文档与技能引用同步。
- 新增 package-name 结构规则及正反例；保留原有循环/公开入口/Runtime 所有权限制。Pi 五个已改名 Runtime 包的精确 composition allowlist 同步，不把其他 Pi 能力错误归入这份历史 allowlist。
- 稳定扩展、协议、持久化、工具及词典身份保持。例如 bundle ID `workbench.agent-runtime-pi-contributions` 是兼容身份，不是旧 import。
- Spec 001/002 及三份历史重构计划作为历史证据保持原样。

## 验证

- `pnpm install --lockfile-only`、`pnpm install --frozen-lockfile` 通过。
- `pnpm lint` 通过。
- `pnpm check:workspace-dependencies`、`pnpm check:package-structure` 通过：72 库包、535 测试文件、0 违规。
- `pnpm typecheck` 全仓通过；最终复核日志 `/tmp/naming-final-types.log`。
- 明确筛选的 219 项非 UI 逻辑/词典/源码边界检查通过，日志 `/tmp/naming-tests.log`。采用 `node --no-warnings=ExperimentalWarning --import ./scripts/register-typescript-test-loader.mjs --test <下列文件>`。
- Terminal 原生依赖归属、pnpm realpath、manifest/文件越界的 5 项非 UI 检查通过，日志 `/tmp/naming-native-tests.log`。入口为 `apps/desktop-electron/test/native-runtime.test.cjs`，通过 `--test-name-pattern` 只选择这五项路径用例，不运行 native smoke 或 Electron UI。
- `pnpm build` 完成 Runtime Node、Web、Desktop renderer 和 Electron Runtime 组合，日志 `/tmp/naming-build.log`。Pi settings 的既有 `::highlight(...)` CSS warning 仍存在，不阻断构建。
- `git diff --check` 通过，Spec 001/002 diff 为空。

初次检查发现的相对 import 归一化歧义、拼接路径遗漏、重复目录后缀、旧空目录扫描和 Pi 内置资源源路径均已修复并重验。Shell 已不存在 nested builtin feature tree，其装配文件仍纳入业务扩展公开接口检查，能力间引用继续由包依赖/内部源码守卫验证。

**UI 测试状态：excluded-by-user。** 未新增或运行 UI 渲染、DOM、交互、Browser/Electron 自动化及手工冒烟；已有 UI 测试只更新源码路径与包引用。子 Agent Sol 负责只读审计，主 Agent 统一映射和集成。

## 219 项检查的文件清单

- `packages/client/host-contracts/tests/desktop-renderer-artifact-manifest.test.ts`
- `packages/client/host-contracts/tests/host-control.test.ts`
- `packages/client/host-contracts/tests/runtime-artifact-manifest.test.ts`
- `packages/client/host-contracts/tests/runtime-connected-web-control.test.ts`
- `packages/client/host-contracts/tests/runtime-connection.test.ts`
- `packages/client/host-contracts/tests/runtime-host-control-golden.test.ts`
- `packages/client/host-contracts/tests/runtime-host-control.test.ts`
- `packages/client/host-contracts/tests/web-artifact-manifest.test.ts`
- `packages/client/host-contracts/tests/web-host-control.test.ts`
- `packages/client/desktop-contracts/tests/runtime-bootstrap.test.ts`
- `packages/client/desktop-contracts/tests/settings.test.ts`
- `packages/client/desktop-contracts/tests/system-fonts.test.ts`
- `packages/client/desktop-contracts/tests/title-bar.test.ts`
- `packages/client/host-client/tests/runtime-fetch.test.ts`
- `packages/client/host-client/tests/runtime-websocket.test.ts`
- `packages/client/services-client/tests/automation-client-transport.test.ts`
- `packages/client/services-client/tests/host-client-transport.test.ts`
- `packages/client/services-client/tests/settings.test.ts`
- `packages/client/services-client/tests/workspace-file-content-transport.test.ts`
- `packages/client/services-client/tests/workspace-git-transport.test.ts`
- `packages/client/ui-sidebar/tests/sidebar-move.test.ts`
- `packages/client/ui-sidebar/tests/sidebar-reorder.test.ts`
- `packages/client/ui-sidebar/tests/thread-list-groups.test.ts`
- `packages/client/ui-sidebar/tests/thread-list-index.test.ts`
- `packages/client/ui-sidebar/tests/thread-order-store.test.ts`
- `packages/client/ui-sidebar/tests/thread-sort.test.ts`
- `packages/client/ui-panels/tests/package-boundary.test.ts`
- `packages/client/shell/tests/dependency-boundaries.test.ts`
- `packages/client/shell/tests/dom-id-literals.test.ts`
- `packages/client/shell/tests/extension-platform-boundary.test.ts`
- `packages/client/shell/tests/styles-boundary.test.ts`
- `packages/client/shell/tests/ui-foundation-boundary.test.ts`
- `packages/client/shell/tests/workspace-directory-store.test.ts`
- `packages/client/shell/tests/resize/proportional-panel-size.test.ts`
- `packages/client/shell/tests/unit/desktop-style-csp.test.ts`
- `packages/client/shell/tests/i18n/runtime.test.ts`
- `packages/client/shell/tests/i18n/config.test.ts`
- `packages/client/pi-product/tests/installed-workbench-settings.test.ts`
- `packages/client/pi-product/tests/running-indicator-catalog.test.ts`
- `packages/agent-runtime/agent-runtime-client/tests/dependency-boundary.test.ts`
- `scripts/check-package-structure.test.mjs`
- `scripts/check-runtime-host-ownership.test.mjs`
- `scripts/check-workspace-dependencies.test.mjs`
- `scripts/extension-boundaries.test.ts`
- `scripts/refactor-architecture-boundaries.test.mjs`
- `scripts/workspace-source.test.mjs`
- `scripts/workbench-paths.test.cjs`
- `scripts/public-workspace-boundary.test.ts`
- `scripts/public-settings-boundary.test.ts`
- `scripts/public-runtime-routes-boundary.test.ts`
