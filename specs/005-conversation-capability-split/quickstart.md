# 实施验证指南

本轮已实施，检查结果见 validation.md；以下为复现指南，Spec 004 已通过的检查不替代本轮验证。

1. 依据 source-inventory.json 核对当前工作树哈希，生成逐文件/部分函数/API/词典/CSS/测试最终映射；基线包含未提交 Spec004，禁止丢弃或 reset。
2. 按 plan 的 W0–W6 顺序迁移，包名和目录同时改名。pnpm install --ignore-scripts 更新锁，随后 frozen-lockfile 检查一致性。
3. pnpm check:workspace-dependencies 与 pnpm check:package-structure；新包 src/lib 均有真实代码、公开 src 目标、合法浅层，预计 93 库包。
4. 审计完整加载链后精确运行非 UI helper 测试：thread-sort/generic reorder、message rows、completed-turn、message-action visibility/error、citation policy、file data helper。禁止以名称或 .ts 后缀判断安全。
5. pnpm lint、pnpm typecheck、pnpm build、git diff --check。只构建，不启动 Browser/dev/server 或 Electron。
6. 比对 props/事件/selector equality/key/Context/SessionProvider/Portal/cleanup；双语 key/value/formatter 和 bundle ID 唯一性；CSS 规则与主题 token/级联。
7. 逐文件保留全部测试；UI/DOM/fake DOM/render/Hook/视觉/交互/Browser/Electron smoke 标记 excluded-by-user，修导入/fixture但不执行。不运行全量 test 或混合 pnpm check。
8. 全部允许检查通过后写 validation.md、勾 tasks、状态改 implemented。不自动提交/推送。
