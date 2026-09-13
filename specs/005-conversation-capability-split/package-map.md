# 来源与目标

以下路径均相对 packages；source-inventory.json 冻结当前全部来源文件。实施前需把局部函数、词典键、CSS选择器和测试依赖展开成最终迁移清单。

| 目标                            | 现有来源与处理                                                                                                                                                                                                                    | 实际 lib 辅助                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| client/ui-composer              | conversation/composer 全包改名，保留 ./document、./directives、./tokens、./panels 等有效出口，仅替换包前缀                                                                                                                        | 原 input-history、markdown-detection、legacy-pi-compat、panel-styles 等                                                                            |
| client/ui-message-blocks        | conversation/conversation/src/renderers 全部；composer-command-response、user-message-text-bubble；composer-message-text 的 Content 部分；elements/error-state、streaming-text、terminal-block、conversation-separator            | 从 renderers/file 提取原 getFileDataKind/getBase64Size/formatFileSize 等至 file-data helper，由 File 消费；原 media-type/source helper 同归 blocks |
| client/ui-conversation-nodes    | 原 workbench-message、message-parts、message-actions、conversation-message-context、steered-turn、completed-turn-content/header、message-presentation/*；list 内 ConversationNodeSeat；composer-message-text 的 Context wrapper   | completed-turn-model、message-action-visibility、workbench-message-error、message-presentation/message-citations 与 policy                         |
| client/ui-conversation-messages | 原 conversation-list（移出 NodeSeat）、conversation-layout、thread-scroll-state、viewport、rows、elements/message-pair 与 typing-indicator                                                                                        | workbench-message-rows、workbench-conversation-viewport；localDayKey/selectRow/sameRow 从原 list 提取为实际 selector/helper                        |
| client/ui-conversation-list     | client/ui-sidebar 的 thread-list/item/groups/index、workspace-thread-list、workspace-sidebar-section/context、thread-order-store、sidebar-move、conversation-actions-menu、new-thread-button、running-thread-indicator、extension | thread-sort，保持原 order storage 与 workspace/thread move 模型                                                                                    |
| client/ui-conversation          | 原 workbench-conversation、workbench-thread、workbench-empty、conversation-title 与最终聚合入口；安装原 SessionProvider/路由同步                                                                                                  | workbench-thread-timing，title 算法按实际原实现保留                                                                                                |

ui-sidebar 保留 sidebar-primitives、sidebar-items、use-sidebar-pointer-reorder、primitives 以及泛型 sidebar-reorder。泛型 reorder 算法从 src/sidebar-reorder.ts 提取到 lib/sidebar-reorder.ts，src 公开契约消费该真实 helper。业务 sidebar-move 消费 ui-sidebar 公共 reorder，不复制算法。保持 pointer capture、拖动 Portal、自动滚动和清理所有权不变。

## CSS 与词典

conversation.css/chat-icons.css 不是全量随一个叶包搬走：静态枚举选择器使用者，独占规则移对应 owner，跨节点/块/消息流共享 token 留在 ui-conversation-messages 的区域样式公开入口，由 Shell 与会话装配显式加载，不形成 TS 反向依赖。image.css 随 blocks，侧栏共享规则留 ui-sidebar，新 list 独占规则按原位置聚合。

旧 conversation 与 sidebar 字典按实际 useI18n/descriptor 消费切分，稳定 key 和 formatter 不改，共享 key 唯一归属。新 bundle 只在 Shell/Pi 相应产品装配安装一次，测试 fixtures 同步。禁止叶包使用顶层 ui-conversation 的总字典。

## Tests 与消费者

所有现有测试保留；pure helpers 随 owner、跨 owner 的混合测试留装配层且修正公开导入。UI tests 统一 excluded-by-user，不能删断言降低检查成本。
Shell 安装/类型/浏览器持久化、ui-layout、ui-side-chat、ui-message-actions、ui-user-message-index、ui-todo、ui-message-queue、Pi diagnostics/toolbox 及根 scripts 的旧 composer/conversation/ui-sidebar 入口必须按实际 imports 分类替换。不是全部替换成 ui-conversation；./context → nodes，./list/rows/viewport/scroll-state → messages，块/terminal → blocks，侧栏业务 → list，编辑器 → ui-composer。

最终目录归属：原 conversation 领域的全部 16 个 UI 包已统一迁入 packages/client，详见 client-placement.json。表中现有来源仍保留原路径以便追溯。
