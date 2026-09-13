# Spec 004 实施验证

基线：`8ee7ee24`；分支：`codex/package-refactor`。状态：Implemented。用户本轮授权生成任务并实施，25 项任务全部完成；未提交、未推送。Specs 001–003 保留原记录。

## 交付与迁移证据

新增 15 个完整能力包，删除旧 ui-agent-controls，库包总数从 75 变为 89。每个新包有真实 TS/TSX src/lib、被消费的辅助、公开 src 入口、共置双语词典、根 tests、双语 README 和 workspace 配置。

- Client：ui-model-selection、ui-token-usage、ui-theme、ui-settings-general。
- Conversation：ui-attachment、ui-input-trigger、ui-user-questions、ui-todo、ui-message-queue、ui-message-actions、ui-user-message-index、ui-settings-archived-chats、ui-side-chat、ui-tool。
- Pi：pi-ui-settings-models。

[migration-inventory.json](migration-inventory.json) 登记 152 条完整文件来源/目标及 SHA-256、4 项局部提取、公开入口迁移、词典与样式审计和测试筛选。对应能力在开始迁移前分别登记映射，最终合并到该文件。SHA-256 不同允许导入、bundle、类型边界与格式化变化，不表示文件完全相同。源代码、测试和 CSS 来源仍可从基线 commit 获取。

模型/用量/主题/通用设置/Pi models 由 Luna 按完整能力迁移；附件/输入触发/提问/Todo/tool 由 Sol 迁移；主 Agent 完成其余五项及共享接线。子 Agent 复核迁移实现、生命周期和 fixtures，主 Agent 完成独立集成验证。

## 公共契约与状态归属

- Shell/Pi 扩展仍在原安装组和原位置，稳定 extension/slot/preferences ID 保留。ui-settings 以 createSettingsExtension 接收 general 设置注册贡献，原 section/item/mainView/command/sidebar 注册和返回释放顺序保持。主题、locale、Pi client 和 session 状态继续复用原共享 owner。
- 输入触发包拥有候选/参数/命令 helper 及结构类型。composer 保留 editor/document/history/submit，并显式消费触发 bundle；类型重导出不引入运行时循环或第二套编辑器状态。
- ui-tool 拥有唯一 disclosure Context、ToolCall/Reasoning/ToolGroup/timeline 和 disclosure policy；conversation 保留整条消息编排，旧 elements 工具转导出已删除。ui-todo 的纯模型从 src/model.ts 暴露，内部消费 lib/todo-model.ts。
- Side chat、queue、message actions、archive、index、interactive requests 完整迁移实现和 helper，消费者通过公开 exports 访问；生产依赖无环。
- React 组件的 props、事件、Portal、effect/observer/timer cleanup、持久化键和共享单例按迁移对照静态审查；未新增 Provider 或更改挂载层级。UI 运行效果未执行验证，不能将静态结果等同于视觉验收。

## i18n 与样式

原五个来源 catalog 与新十五个/剩余四个 owner 合并后，en-US、zh-CN 每种语言各 1,042 个叶键。Oxc AST 对比结果：missing/extra/changed/duplicates 均为空；包括原文及格式化函数表达式，保持参数和语义键。Shell 安装通用 capability bundles，Pi models 由 Pi contributions 安装；共享设置分组键留 ui-settings，无第二套 runtime 或巨型复制词典。

主题与索引 CSS 在 Shell 原导入位置替换 owner。附件及命令 icon CSS 从 composer-icons.css 提取，仍由原 icons 入口聚合，覆盖 Shell/conversation 的实际加载路径；独占规则现在在共享规则前展开，静态检查无相同元素/属性/同等优先级冲突，custom properties 在计算时解析。原规则文本、语义 token 与区域范围保持。conversation/chat-icons.css 仍服务多个保留组件，留在原 owner；没有新建空 tool CSS。

## 验证结果

| 检查                                                           | 本轮结果                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| pnpm install --frozen-lockfile --ignore-scripts                | PASS，94 workspace projects，锁文件一致                                    |
| pnpm check:workspace-dependencies（含 runtime host ownership） | PASS，无缺失依赖、生产环或非法内部导入                                     |
| pnpm check:package-structure                                   | PASS：89 libraries、535 library test files、0 tracked migration violations |
| scripts/extension-boundaries.test.ts 静态守卫                  | PASS：13 tests；扫描根已覆盖新能力包                                       |
| 明确筛选的 28 个纯逻辑测试文件                                 | PASS：87 tests，0 failures                                                 |
| 双语 catalog AST 比对                                          | PASS：每 locale 1,042 个键、值及 formatter 等价，无缺失/新增/重复          |
| pnpm lint                                                      | PASS，0 warnings，0 errors，格式检查通过                                   |
| pnpm typecheck                                                 | PASS，全部 apps 与有 typecheck 脚本的 packages                             |
| pnpm build                                                     | PASS，Runtime、Web、Desktop renderer 与 Electron Runtime 组合产物          |
| git diff --check                                               | PASS                                                                       |

纯逻辑执行范围逐文件列在 migration-inventory.json 的 tests.safeFiles。复现时只将此列表传给 `node --import tsx --test`，不要扩展成目录 glob；静态守卫可精确执行 `node --import tsx --test scripts/extension-boundaries.test.ts`。

构建有既有 Pi `::highlight(pi-prompt-placeholder)` CSS 伪元素解析 warning，Web 与 Desktop 构建各报告一次；位置为 packages/pi/pi-ui-settings/src/prompt-placeholder-highlight.module.css。该文件未修改，构建成功。未为此扩展修改范围。

## 测试保留与用户排除项

基线 root/apps/packages 共 636 个测试文件，按迁移映射核对后全部仍存在；其中库结构检查统计 535 个。既有 UI 测试仅修正来源导入及 fixture bundle，不删除断言、不新增用例、不执行测试。

迁移包中审计出的 20 个 UI 或混合加载链文件记录在 tests.excluded；所有其他 UI/DOM/fake DOM/渲染/Hook/视觉/交互/Browser/Electron 冒烟测试同样 excluded-by-user。未运行全量 pnpm test、混合 pnpm check、Browser、开发服务器或手工 UI 冒烟。排除项按用户约束保留，不计作通过。
