# Spec 005 实施验证

状态：Implemented。分支：codex/package-refactor。基线为 Spec004 已实施的未提交工作树，不能仅从 HEAD 8ee7ee24 还原。本轮生成并完成 17 项任务，未提交、未推送。Spec001–004 记录保持。

## 交付

原 composer 整包改名 ui-composer；原 conversation 收窄为 ui-conversation。新增 ui-conversation-list、ui-conversation-messages、ui-conversation-nodes、ui-message-blocks 四包，库包从 89 增为 93。ui-sidebar 收窄为基础组件、区域样式与泛型拖放。

ui-conversation-list 完整接管工作区会话分组/controller/order/menu/move/扩展，Shell 直接安装；基础 ui-sidebar 无业务回引。ui-conversation-nodes 拥有唯一 message/structure/steered-turn Context 与消息级 renderer；messages 拥有顺序、日期、viewport/scroll；blocks 拥有真实内容渲染与 file-data helper。ui-composer 保留原 editor/history/submission 状态闭包。

[migration-inventory.json](migration-inventory.json) 记录 127 条完整文件目标、1 个废弃 elements barrel、局部提取、源/目标 SHA-256、词典归属及测试筛选。[source-inventory.json](source-inventory.json) 保留开始前 140 个来源文件的快照。SHA 差异允许预期的导入、公开入口、词典边界、helper 提取和格式化，不表示每个迁移文件逐字一致。

## 静态行为审计

Luna 迁移 blocks 并对照 Spec004 工作树审计；Sol 迁移 nodes/messages 并独立核对 Context、selector、Provider、effect 和 fixtures；主 Agent迁移 sidebar、改名并完成共享集成。

- message Context、thread-scroll-state、layout、viewport helper 与基线实现一致。
- NodeSeat 的 nodeKey 订阅、最后节点 selector、role 分派、error fallback、Provider 值/层级及 data 属性保持；role 仅从重复计算变为一次计算。
- 消息列表 selector/equality 的 id/kind/role/createdAt/steering/steerInterrupted 字段保持。日期、配对、steered 范围、working status 和稳定 key 原样保留。
- composer-message-text 的 Context wrapper 留 nodes，Content 搬 blocks，通过公开入口调用；不复制 Context/SessionProvider。
- blocks 的 props、effects、附件读取、错误动作和图片资源清理沿用现有 runtime hooks；未为拆包重写成第二套状态。file-data 中三项 helper 与原实现一致。
- 泛型 sidebar reorder 辅助在 ui-sidebar/lib，被 src 入口实际消费；工作区/线程业务 move/order 归新 list。原拖放 session、Portal、pointer capture 和 cleanup 保持。
- 扩展 ID 和注册次序不变。边界静态守卫扩大到新包；允许现有公开 hosts/slot-host，与原 renderer-host 同为显式公共入口，未允许 Host 私有实现。
- 未执行 UI 运行验收；上述是源码与契约审计，不能当作视觉/交互测试通过。

## i18n 和 CSS

三个来源 catalog（conversation、composer、sidebar）重组后，两种 locale 分别有 271 个叶键。Oxc AST 对比 en-US/zh-CN 的 key/value/formatter：missing/extra/changed/duplicates 均为空。

13 个侧栏共享文案留 ui-sidebar，其余 sidebar 业务词典随 list。块级共享文案在 blocks 唯一拥有，nodes 通过 blocks translator 读取；顶层 session/title 文案留 ui-conversation。messages 无独占文案，直接 useI18n() 格式化日期，没有空 bundle。各目标 bundle 由 Shell 唯一安装，既有 fixtures 已核对并同步导入。

共享 conversation.css/chat-icons.css 整体归 messages 的区域样式入口；image.css 随 blocks。Shell → ui-conversation/styles.css → messages/styles.css 聚合，原 chat-icons → composer/icons → image CSS 顺序保持，规则文本、选择器、token 和 Portal 范围未改。sidebar 原样式仍归基础 ui-sidebar，新列表复用相同类名，无重复新增样式。

## 检查结果

| 检查                                            | 结果                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| pnpm install --frozen-lockfile --ignore-scripts | PASS，98 workspace projects，锁文件一致                                    |
| pnpm check:workspace-dependencies               | PASS，包含 runtime host ownership；生产无环，公开入口依赖有效              |
| pnpm check:package-structure                    | PASS，93 libraries、535 library test files、0 tracked migration violations |
| scripts/extension-boundaries.test.ts            | PASS，13 tests                                                             |
| 14 个精确筛选的纯逻辑文件                       | PASS，63 tests，0 failures                                                 |
| 双语 catalog AST 比对                           | PASS，每 locale 271 键，文案与 formatter 等价、无重复                      |
| pnpm lint                                       | PASS，无 lint warning/error，格式检查通过                                  |
| pnpm typecheck                                  | PASS，全部 apps 与有 typecheck 脚本的 packages                             |
| pnpm build                                      | PASS，Runtime、Web、Desktop renderer 与 Electron Runtime 组合              |
| git diff --check                                | PASS                                                                       |

构建仍报告既有 Pi ::highlight(pi-prompt-placeholder) CSS 伪元素解析 warning，Web/Desktop 各一次，位于未修改的 packages/pi/pi-ui-settings/src/prompt-placeholder-highlight.module.css；未阻止构建。

允许的纯逻辑文件见 migration-inventory.json 的 tests.safeFiles；仅把该明确列表传给 node --import tsx --test。静态边界精确运行 node --import tsx --test scripts/extension-boundaries.test.ts。

## 测试保留与排除

全仓原有 636 个测试文件全部保留；库结构扫描统计其中 535 个。原 conversation 的 14 个测试分别归 ui-conversation 2、nodes 5、messages 4、blocks 3；移动测试未删断言，只修正路径。侧栏 fixture 同时安装 list/shared-sidebar bundle，blocks fixture 安装全部实际需要的 bundles。

所有 UI/DOM/fake DOM/render/Hook/视觉/交互/Browser/Electron 冒烟 excluded-by-user，既有文件保留，未新增或执行。没有运行根/包全量 test、混合 pnpm check、开发服务器、Browser 或手工 UI 冒烟。排除项不记作通过。

## 用户后续调整：会话 UI 统一归 client

已将 packages/conversation 下全部 16 个包迁至 packages/client，并删除旧父目录。包名与公开接口保持；原有记录中的 conversation 路径为历史来源，最终位置见 client-placement.json。共 358 个迁移文件、636 个全仓测试文件全部保留。

已更新 workspace importer/链接、边界扫描根、活跃文档和 Tailwind 来源。Web/Desktop 已有 client 扫描范围，删除重复的 conversation 扫描项。独立复验：结构/生产依赖通过（93 libraries、535 library tests、0 violations），13 个静态边界测试通过，lint/typecheck/frozen-lockfile/build 全部通过，git diff --check 通过。构建保留同一既有 Pi highlight CSS warning；没有运行 UI 测试、Browser 或冒烟。未提交、未推送。
