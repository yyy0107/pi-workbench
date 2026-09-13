# 迁移映射与验收

路径相对仓库根。目标文件名是实施设计，source-inventory.json 记录现存来源。每项均要求同批更新 exports、consumer、样式、词典、测试路径与 README；不创建空 lib 或空语言 bundle。

| 流程          | 当前来源                                                                                  | 目标 / 消费者                                                                                                                                                                                                               | 退出条件                                                                                |
| ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| W1 工具协议   | ui-tool/lib/tool-diff-model.ts；lib/tool-timeline-model.ts；src/message-tool-timeline.tsx | pi-ui-toolbox/lib/file-mutation-tool-model.ts；src/file-mutation-tool-summary.tsx、file-mutation-tool-renderer.tsx、工具 presentation；SDK renderer.ts；现有 Pi contributions 安装                                          | 通用时间线无工具协议分支；已安装 Pi 维持摘要/diff/分组/统计；异常通用 fallback          |
| W2 消息块适配 | ui-message-blocks/src/message-blocks.tsx、composer-message-content.tsx                    | ui-conversation-nodes/src 的 block adaptor；blocks 显式 props                                                                                                                                                               | blocks 不依赖 Session、Host 命令 registry 或 ui-composer                                |
| W2a token     | ui-composer/src/composer-controls.tsx 中 token；composer-token-icon.tsx、tokens.ts        | ui-input-trigger/src/composer-command-token.tsx、composer-token-icon.tsx 与 tokens 入口；composer/blocks 共同消费                                                                                                           | 单一 token 实现，无 editor 依赖回流；ComposerMenu 留原包                                |
| W3 装配       | ui-layout/src/workbench-header.tsx、workbench-shell.tsx                                   | shell/src/conversation-header.tsx 与 application.tsx；layout 只消费 model/actions                                                                                                                                           | layout 无三类会话包依赖；scroll 安装一次覆盖主/侧会话                                   |
| W4 Composer   | ui-composer/src/workbench-composer.tsx                                                    | 同 src 的 composer-editor-plugins.tsx、use-composer-suggestions.ts、use-composer-mentions.ts、use-composer-command-parameters.ts、use-composer-attachments.ts、use-composer-submission.ts；lib/composer-suggestion-model.ts | 原 view/submit helper 继续复用；唯一 editor/Session 状态，异步/IME/ref/防重语义逐项核对 |
| W5 sidebar    | ui-conversation-list/src/workspace-sidebar-context.tsx                                    | 同 src 的 sidebar-contracts.ts、sidebar-context.tsx、use-workspace-sidebar-controller.ts、sidebar-move-menu-items.tsx；lib/sidebar-projection.ts                                                                            | 显式窄类型与行/group selectors；不暴露整个 runtime；唯一 store/move 事务                |
| W6 theme      | ui-theme/src/appearance-settings-item.tsx                                                 | 同 src 的 appearance-theme-page.tsx、appearance-font-page.tsx、appearance-background-page.tsx、appearance-controls.tsx                                                                                                      | dispatcher 保留 settings ID；控件提交与取消语义不变；仅相同逻辑才共享 hook              |
| W7 CSS        | ui-conversation-messages/src/chat-icons.css、conversation.css                             | 实际 DOM owner，详见下表                                                                                                                                                                                                    | 独立组件自身资源入口完整，样式顺序/主题/密度/圆角/Portal 保持                           |
| W8 测试归属   | ui/tests/ui/shared-foundations.test.tsx                                                   | ui-selectors/tests/searchable-selector.test.tsx                                                                                                                                                                             | 仅迁既有三项 selector 断言；其余基础断言留 ui；删 ui dev 反向依赖，不执行 UI 测试       |

以上短包名均位于 packages/client，Pi 包位于 packages/pi，SDK 位于 packages/extension-platform。

## CSS owner

| 当前规则                                | 最终 owner                                                                         | 注意事项                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| message-actions 按钮框/点击范围与伪元素 | ui-conversation-nodes，实际 DOM 为 src/message-actions.tsx                         | 不是 ui-message-actions 产品扩展；保留 hit area 与按钮 token |
| composer-dock 动画与 reduced-motion     | ui-conversation                                                                    | dock DOM 在 workbench-conversation.tsx；不是 editor 内部样式 |
| code header 图标/按钮                   | code-highlighting/src/code-block.css                                               | 与真实 codex-code-header 共置，不能由消息列表控制            |
| markdown preview 图标                   | markdown/src/styles.css 及局部 owner 样式                                          | 独立预览也能获得样式                                         |
| aui-chat-icon-size-* 多包消费           | 各 owner 从现有 icon/button token 派生局部类；确实通用的 primitive variant 才归 ui | 不新增 message-styles 包，不用 root 后代选择器统一压制       |
| user-message bubble、消息字体           | bubble owner ui-message-blocks；Markdown 字体归 markdown；列表仅保留容器继承       | 保持现有主题和字体继承，不扩大选择器作用域                   |

先列全部 selector 消费者，再迁声明/入口并删旧声明；保留必要公开 DOM marker（例如块折叠测量使用的 code-header marker），不顺手改测量行为。重复 reduced-motion 规则按各自 owner 明确作用域。

## 依赖安排

W1/W2/W3 依赖共享合同冻结；W4 依赖 W2a，W5/W6 可独立；W7 在对应 DOM owner 稳定后收口；W8 独立但 manifest/lock 由主 Agent统一处理。实施任务须将这些工作流进一步拆成具有单一 owner、消费者、验证和完成条件的任务，不能直接把表格整行全部标完成。

## 实施后的具体落点

- Header 投影由 shell/src/conversation-header.tsx 的 ConversationWorkbenchShell 装配，layout 保留通用 header DOM。
- Sidebar 拆为 sidebar-contracts.ts、sidebar-context.tsx、workspace-sidebar-item.tsx、use-workspace-sidebar-controller.ts、sidebar-move-menu-items.tsx、lib/sidebar-projection.ts；删除旧 workspace-sidebar-context.tsx，单一 store 不变。
- Theme 增加真实 appearance-interface-page.tsx；appearance-font-page.tsx 仍是主题页内字体/代码设置区，保持原 section 映射。appearance-page-model.ts 负责状态/标签装配，appearance-setting-controls.tsx 负责实际共享控件，父入口不保留页面 JSX。
- User-message-content DOM 属 nodes，入场动画随 message-actions.css 迁入 nodes；bubble 字体归 blocks，dock 动画归 ui-conversation。原 chat icon 类改为现有 icon token 的显式尺寸类，共享 token 图标规则归 ui-input-trigger/styles.css。
