# Quickstart: 实施验证指南

本文件记录 Spec 003 的执行与验收范围。用户已授权实施，任务见 tasks.md；本轮检查证据见 validation.md。

## 前置

确认实际工作树与 `8d4b6568` 基线、当前 AGENTS/constitution、命名规范和 i18n 指南。先检查每个 package script、Node loader 及 build 前后置，确保不触发 UI 测试。只用 pnpm。

## 每波次

1. 按 inventory 移动能力并同步公开 imports/manifests，基础 ui 不留新 owner 转发；共享文件由主 Agent 合并。
2. 新 workspace manifests 接通后用 `pnpm install --ignore-scripts` 同步锁文件与 workspace 链接（不运行依赖生命周期脚本）。
3. 运行 `pnpm check:workspace-dependencies`、`pnpm check:package-structure`。预期最终75库包、测试无遗漏、0违规；包数仅核对，不是拆包目标。
4. 按受影响包及其直接消费者执行 `pnpm --filter <包名> typecheck`；最终执行全仓 `pnpm typecheck`。
5. 静态核对原 public props/types、迁移后唯一实现、i18n key/插值、CSS 内容/顺序/sideEffects 和 Portal/Observer/listener/RAF 清理。

## 精确非 UI 入口

执行前再次读完整文件及加载链；只选择以下预期纯逻辑用例，最终文件名按 tasks/inventory：

```bash
node --no-warnings=ExperimentalWarning --import ./scripts/register-typescript-test-loader.mjs --test \
  packages/client/ui-resize/tests/resize-spring.test.ts \
  packages/client/ui-disclosure/tests/disclosure-scroll-policy.test.ts \
  packages/client/ui-agent-controls/tests/model-selector-models.test.ts \
  packages/client/ui-settings/tests/color-picker.test.ts \
  packages/client/shell/tests/resize/proportional-panel-size.test.ts
```

ColorPicker 测试调整为直接 import 同包纯 lib 的 normalizeHexColor，保持原输入/输出断言。不把 UI 状态/Observer 场景移成“逻辑测试”来执行。

静态结构、依赖和扩展边界可以精确选择已有对应脚本。三个新包和 Sidebar 等新源码根须进入相关 guard 的真实扫描范围，不接受缺目录静默形成空检查。

## UI 排除

不得执行组件渲染、交互、DOM/快照、Browser/Electron 自动化和手工 UI 冒烟。尤其以下文件虽然部分为 .ts，仍排除：

- ui-resize/tests/use-collapsible-resize.test.ts：调用 React renderToStaticMarkup。
- ui-resize/tests/observe-resize-handle.test.ts：fake DOM、ARIA 与 ResizeObserver。
- ui-disclosure/tests/use-disclosure-scroll-lock.test.tsx。
- selectors/workspace/model/sidebar 组件测试及 ui/tests/ui/shared-foundations.test.tsx。

其余 UI 文件同样保留不运行。不要运行混合 `pnpm check`、根/包全量 test、Electron pack/smoke 或启动 Browser。没有运行 UI 测试不作为缺陷或完成阻塞，也不能写“UI 测试通过”。

## 最终检查

```bash
pnpm lint
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm typecheck
pnpm build
git diff --check
```

build 当前为 Runtime/Web/Desktop/Electron artifact 组合；实施前仍需审计 hooks。记录原有 warning 与新增 failure，构建成功不意味着 UI 实测。对比全部来源/测试、旧入口的活跃 consumers 和 i18n/CSS 合同，保存本轮独立 validation.md，再更新 tasks 完成状态。Spec 001/002 及既有历史验收文件不改写。
