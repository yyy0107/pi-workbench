# i18n 结构去重验收

基于提交 `8527302d`，将能力包的词典入口统一到目录，并移除重复的本地 Hook 包装。

## 实施结果

- 27 个 `src/i18n.ts` 移入各自的 `src/i18n/index.ts`；locale 文件仍与 bundle 共置。仅调整内部 locale import 的相对路径；逐文件静态对比 27/27 完全匹配原实现，双语词典文件无修改。
- 删除 22 个 `src/use-i18n.ts`：12 个简单 bundle 别名、10 个 global/scoped runtime 合并包装。迁移 131 个原 Hook 消费者，包括跨包和既有 UI 测试引用。
- 删除 7 个旧 `/translations` exports，所有消费者改用能力包 `./i18n` 的 bundle 与共享 `@workbench/i18n` Hook。
- 共享 `useI18n(bundle)` 用一个无条件 memo 合并已安装 Context 与 scoped runtime；局部 `t` 保持 catalog 类型限制，`text`、`isLocalizableText` 和 `setLocale` 沿用同一个安装实例。无参 API 与原有 `useTranslationBundle` 保留。
- 另外合并 Layout/Header/侧栏导航和 Host 命令面板中重复读取 global/scoped runtime 的调用。
- Shell hydration/locale persistence 和 Pi contribution 的组合 runtime 具有实际职责，保持实现与生命周期。bundle 入口继续只依赖无 React 的 runtime API，没有将 Hook 混入词典入口。
- 更新共享包双语 README、全局规范、双语 i18n 指南和原 `/translations` 文档。Spec 001/002 保持原验收记录。

## 验证

- `pnpm typecheck` 全仓通过，日志 `/tmp/i18n-final-types.log`。新增 compile-only 类型契约验证本包 t、必需插值、外部描述符和 setLocale；函数从不执行，不挂载 UI。
- `pnpm lint` 通过，日志 `/tmp/i18n-lint.log`。
- `pnpm check:workspace-dependencies` 与 `pnpm check:package-structure` 通过：72 库包、535 测试文件、0 违规。
- 49 项非 UI runtime/格式化/词典/结构/依赖/扩展边界检查通过，日志 `/tmp/i18n-tests.log`。
- `pnpm build` 成功完成 Runtime、Web、Desktop renderer 与 Electron Runtime 组合，日志 `/tmp/i18n-build.log`。此前 Pi settings `::highlight(...)` CSS warning 仍存在，不影响构建。
- `git diff --check` 通过。能力包中 `src/i18n.ts` 与 `src/use-i18n.ts` 均为零，旧 `/translations` 无活跃消费者。

非 UI 命令使用 Node TypeScript loader 显式选择以下文件：

- `packages/client/i18n/tests/runtime.test.ts`
- `packages/client/i18n/tests/format-duration.test.ts`
- `packages/client/shell/tests/i18n/runtime.test.ts`
- `packages/client/shell/tests/i18n/config.test.ts`
- `scripts/check-package-structure.test.mjs`
- `scripts/check-workspace-dependencies.test.mjs`
- `scripts/extension-boundaries.test.ts`

按用户约束，未新增或运行 UI/DOM/渲染测试，也未执行 Browser/Electron UI 自动化或手工交互冒烟。现有 UI 测试保留，只迁移引用；UI 测试状态为 excluded-by-user。
