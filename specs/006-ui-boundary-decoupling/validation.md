# Spec 006 实施验证

状态：实施完成，36/36 任务完成。未新增或执行 UI 测试；未提交/推送。

## T001–T004 前置证据

- 544 项来源 hash 已核对，无源码漂移；当前未提交 Spec004/005/client 工作树保留。
- setup prerequisite 通过；无 checklists、无 extensions.yml hooks。Git ignore 已覆盖 node_modules、宿主构建、环境文件与 TS 缓存；不发布包，不需要 npmignore。
- 验证白名单：仅经内容及传递导入审查的纯解析/投影/策略测试，逐文件使用现有 loader；每次执行在下文列明。所有 UI/DOM/fake DOM/Hook 渲染用例及 Browser/Electron 冒烟排除；不执行 pnpm test/check 或宽泛包级 test。
- 公共契约以 contracts/public-boundaries.md 为准；getResourceStats 保留 basename/增删行聚合，read 的普通与 skill 呈现保持唯一注册。
- 共享 SDK/Host/manifest/lock/注册由主 Agent单独维护；Sol 负责 ui-tool/Pi 迁移，Luna 负责 theme/selector 独立文件。各故事验收时同时查 import 与 manifest，见合同禁止边表。
- 每任务源码完成后记录实际类型/静态/允许纯逻辑结果才勾选；UI 静态审查不是 UI 行为测试通过。

## 执行证据

## T005–T011：工具边界

- SDK 的 summary/getExpandable/showCompletionIcon/group/getResourceStats 可选合同通过 SDK/Host 类型检查；复用既有公开 Host error-boundary leaf，无新增 registry 或最终 aggregate export。
- Sol 完成 Pi 模型/summary/renderer/presentation、通用时间线与测试迁移；主 Agent处理 manifest/lock、terminal 元数据与接入。read/skill 保持唯一注册，edit/write/grep/find/ls 随原 skillReadingExtension 安装，不增加安装条目。
- ui-tool/tool-diff-model 入口和实现删除；ui-tool 不再导入 code-highlighting/workspace-files/workspace-runtime，ReasoningPanel 使用等价 slice 截取而非 diff 包的 take。
- 26 项纯逻辑通过：`packages/client/ui-tool/tests/builtin-message-presentation-tool-timeline-model.test.ts` 与 `packages/pi/pi-ui-toolbox/tests/file-mutation-tool-model.test.ts`（agent 使用现有 loader 精确执行并审查依赖）。原 timeline 用例随显式呈现合同调整，diff 测试迁移保留，增加资源统计异常等纯逻辑覆盖。
- 只读复核发现并修复普通 read 丢失 basename、空 bash 命令丢失工具名 fallback 两项问题；随后 Pi/terminal 类型检查通过。保留精确并行 batch 优先级、索引/disclosure、complete-only 统计与失败隔离。

## T012–T018：消息与装配

- shared token 实现唯一归 ui-input-trigger/tokens，编辑器菜单留 Composer；旧 token 导出/文件删除，消费者和既有 UI fixture 更新，不运行 UI 测试。
- blocks 的文档、command kind、legacy command text 来自 nodes projection；readAttachment 使用 contracts request/result；error props 显式传入 isLast/isRunning/retry。blocks 的 Session/registry/editor 生产依赖清零。
- 静态核对附件 image-only、id/reset、失效请求 current 标记、失败 fallback、retry guard/finally；原节点缺失 fallback 与 Session action 引用保持。
- Shell ConversationWorkbenchShell 负责标题/工作区/actions，layout 无会话包依赖；唯一 scroll Provider 位于 RuntimeProvider 内覆盖主会话与 SideChat。application factory、persistence identity/dispose 与 scratch lease 未修改。
- ui-input-trigger/ui-composer/ui-message-blocks/ui-conversation-nodes/ui-layout/shell 相关类型检查通过；全仓类型检查再次通过。

## T019–T024：Composer 与侧栏

- Composer 提取四个 Lexical plugins、suggestion helper/生成、mentions AbortController 搜索、参数 session map、附件恢复和提交 hook；全部由原组件无条件调用，唯一 editor/session 引用保持。原 WorkbenchComposer 剩 832 行，行数不是完成依据。
- 静态对照原 closure：IME/Enter 优先级、onChange/ref、search abort+debounce、参数切会话清理、提交 guard、附件恢复时 session/editor/attachment identity 两次检查、上传/释放均保留。
- sidebar 明确契约取代 controller ReturnType，runtime/capabilities 不再整体暴露；单一 store 与 drag session 保持，所有消费者必须给 selector，actions 使用稳定 pick，事务原 pin→save 与失败阶段保留。
- 精确执行 sidebar-move.test.ts、thread-list-groups.test.ts、thread-sort.test.ts：14/14 PASS；三文件只消费纯模型/分组/排序与类型导入。ui-conversation-list/ui-composer 类型检查通过。

## T025–T032：CSS、外观与测试归属

- styles ownership：nodes 拥有 message-actions/hit area/user-message enter；ui-conversation 拥有 dock 动画；Markdown/code-highlighting 拥有各自控件样式；blocks 拥有 bubble 字体、图像和共享 token 样式入口。消息列表只装配 nodes 样式和列表容器 token，旧 chat-icons.css 删除。
- chat icon 类迁为既有 icon/button token 的显式 size 类；共享 command token 图标规则归 ui-input-trigger。浅/深主题、颜色、密度、圆角均从原 token 派生；reduced motion/hit area/Portal/DOM marker 静态核对保持，无新增固定颜色/全局尺寸体系。
- 计划中的 style-scope 脚本实际需要 renderer WebSocket；无参数调用在入口退出，未连接或测试 UI。纠正 quickstart/tasks 为纯静态 owner/入口/token 审查，未将该命令记为 PASS。
- theme 首次子 Agent方案只有空 wrapper，已退回并由主 Agent完成真实页面迁移。实际 Theme/Font/Interface/Background JSX 分离，AppearanceSettingsItem 为 26 行 dispatcher；page model 保持原 state/label 装配，controls 保持原 Range RAF 与 Color timer 各自逻辑。
- Sol 只读对照：82 处原 i18n 引用及 preference 使用/更新目标齐全，settings ID/外层 DOM/分区映射保持，控件正文除 export 和既有 bundle rename 外等价。
- 三项 SearchableSelector 原断言搬到 ui-selectors/tests/searchable-selector.test.tsx，基础 Tabs/Settings/StatusBadge/Surface 断言留 ui；ui→ui-selectors dev 边删除，包安装不再报告该 workspace cycle。所有相关 UI 文件只静态/类型核对，未执行。
- 精确执行 Composer composer-submit.test.ts + theme color-picker.test.ts + appearance-settings-pages.test.ts：11/11 PASS（仅提交策略、纯颜色/页面 helper；无渲染）。

## T033–T035：统一验证

| 检查                              | 结果                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm check:workspace-dependencies | PASS，生产依赖与宿主边界                                                                                                              |
| pnpm check:package-structure      | PASS，93 libraries、536 library test files、0 tracked migration violations                                                            |
| pnpm typecheck                    | PASS，4 个应用 + 93 个库包，既有 UI 测试只做类型检查                                                                                  |
| pnpm lint                         | PASS，无 lint 警告，格式通过；曾出现的未用 imports/常量与格式问题已修复                                                               |
| 精确纯逻辑用例                    | 51 PASS，0 FAIL（26 工具 + 14 侧栏 + 11 提交/外观）                                                                                   |
| 禁止依赖/旧路径检索               | PASS：blocks 无 Session/composer，layout 无 conversation，ui-tool 无协议分支/diff/opener，旧 token/diff/context/chat-icons 来源零残留 |

README 与公开扩展文档已更新；使用实际 README.zh-CN.md 等现有语言文件名。库测试文件从 535 到 536 是将混合 selector 文件拆开造成的净增一文件，原 UI 断言保留。新增/迁移源码参见 ownership-map.md，基线变化 hash 见 implementation-map.json。

## T036：构建与限制

最终 pnpm build PASS（退出码 0），包含复核后的两项摘要修正；Runtime、Web、Electron renderer/main/runtime artifacts 均完成。最终 pnpm lint、git diff --check 通过；Pi/terminal/theme 相关类型复验通过。
构建保留 Spec004/005 已记录的 Pi ::highlight(pi-prompt-placeholder) CSS 伪元素解析 warning（Web/Desktop 各一次），位于未修改的 pi-ui-settings 文件，未阻断产物。
未运行 UI/DOM/fake DOM/Hook 渲染/视觉/交互测试或 Browser/Electron 冒烟，不能据此声称视觉/交互行为已通过实际渲染验证。未提交、未推送、未部署。

最终 hooks 检查：无 .specify/extensions.yml，after_implement 跳过。工作树未提交、未推送；Spec004/005 既有结果保留。
