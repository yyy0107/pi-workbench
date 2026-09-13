# 实施验收指南

本期已实施；实际检查结果见 validation.md，不以 Spec003 的历史验收替代。

1. speckit-tasks先展开W0：对核心sourceFiles逐项补公共出口/消费者、词典键和插值、CSS位置、既有测试来源目标。检查最近AGENTS、脚本hooks及工作树。
2. 按W1→W2→W3→W4完整迁移。每个新包含真实src/lib、tests、双语README、manifest/tsconfig；每波更新依赖和pnpm锁文件，禁止旧生产转发。
3. 执行 `pnpm check:workspace-dependencies` 与 `pnpm check:package-structure`，确认无生产环、深层导入或目录违规。对迁出与保留测试逐文件计数，不能减少测试文件掩盖迁移问题。
4. 精确筛选非UI逻辑测试。候选：模型筛选/颜色正规化、command参数解析、ask-user model/form-state、todo-model、queue preview、tool-diff/timeline模型、scratch lease/navigation。实施时逐文件审计完整加载链；不要只按文件名决定。
5. 运行受影响包类型检查，最终 `pnpm lint`、`pnpm typecheck`、`pnpm build` 和 `git diff --check`。检查构建脚本无UI测试钩子；保留已有warning记录。
6. 静态核对ID/Portal/Context/effect cleanup、双语键唯一归属与CSS顺序。通过后新增validation.md并勾选tasks，才能标记implemented。

不运行根/包全量test、混合pnpm check、Browser/Electron自动化、UI渲染/DOM/fake DOM/视觉/交互测试或手工冒烟；保留并标记excluded-by-user。提交/推送按用户后续明确指令。
