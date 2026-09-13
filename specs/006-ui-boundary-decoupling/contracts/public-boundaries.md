# 公开边界合同

以下是实施目标，尚未落地。新增字段应由 SDK 公共入口导出；仓内消费者同批更新，不保留旧包转发。

## ToolPresentation

在现有 `ToolPresentationDefinition` 增加可选能力：

```ts
interface ToolPresentationSummaryProps {
  readonly node: MessageBlockNode;
  readonly block: ToolCallBlock;
  readonly label: ReactNode;
}
interface ToolPresentationResourceStat {
  readonly file: string;
  readonly added?: number;
  readonly removed?: number;
}
// 合入现有定义，保留现有 label/activeLabel/icon/resolve 等字段。
interface ToolPresentationAdditions {
  readonly summaryComponent?: ComponentType<ToolPresentationSummaryProps>;
  readonly getExpandable?: (block: ToolCallBlock, node?: MessageBlockNode) => boolean;
  readonly showCompletionIcon?: boolean;
  readonly group?: "exploration" | "terminal" | "changes";
  readonly getResourceStats?: (
    block: ToolCallBlock,
    node?: MessageBlockNode,
  ) => readonly ToolPresentationResourceStat[];
}
```

- `summaryComponent` 只负责 query/文件名/增删数字区域；label 已由 i18n 格式化。ToolCall 外壳、状态、disclosure 仍属 ui-tool。Pi summary 在自身包内读取 opener/workspace/toast，构造 workspace-file request。
- 展开默认 true，完成图标默认 `!presentation.compact`；Pi edit/write 使用旧 diff/failed/cancelled/requires-action 条件并关闭成功图标。回调失败回到默认行为。
- `group` 来自已 resolve 的 presentation；timelineEntries 只组合分类与原 parallelGroup key。未声明时不按名称猜分类。分组设置、连续组边界、sourceIndex、并行优先级和 disclosure ID 不变。
- `getResourceStats` 返回纯统计。沿用当前 timelineStats 的 file 聚合与 added/removed；Pi 保留 basename、行数、状态过滤语义，timeline 调用处仍只计 complete。不能顺手改成完整路径去重。回调抛错按空统计处理。
- tools exact renderer 展示 ReviewableDiff；无 diff/解析失败返回其已有 fallback。未注册时普通 query 使用工具名，通用 kind 为 used，details 仍为 ToolCallDetails。移除 toolChip 的具体参数字段推断和 toolKind 的名称/正则匹配。
- 单行 summary 的组件异常使用现有 Host 错误隔离机制包裹，回退普通 query；不要在同组件 try/catch 中直接调用 React 组件。renderer 匹配与错误边界顺序保持 predicate → exact → caller fallback。
- grouped 壳、parallel batch ID、disclosure scope 和 data RendererHost fallback=null 不变。latestActivity 使用已 resolve 的 active label，不保留 write 特判。
- Pi 使用现有 tools/toolPresentations 注册。普通 read 与 skill-reading resolve 合为同一个注册 owner，保留现有扩展 ID/安装顺序；bash/read/edit/write 与已安装搜索工具在所属贡献明确标签、摘要、分类。不要让新注册覆盖 skill-reading。SDK 不引入 runtime-service 对象，ToolCallBlock 不存 React 组件/回调。
- 原 ui-tool/tool-diff-model 公开入口删除，仓内消费者及纯逻辑测试随新 Pi owner 迁移；统计 API 可以保留名称但消费显式 presentation，不留协议兼容分支。

## 消息块与 token

- ManagedFileAttachmentPreview 接收可选 `readAttachment(request): Promise<result>`；request/result 复用 agent-runtime-contracts/composer-attachments 的 ReadManagedFileAttachmentRequest/Result。nodes 传入稳定 session action。
- WorkbenchConversationError 接收显式 isLast/isRunning/retry，nodes 负责定位 node 和 Session；保持缺失 node、错误 fallback 和 retry guard。
- ComposerMessageContent 接收已解析文档/命令 token 展示数据。nodes 读取注册表和 agent commands；块不得调用 Session、useComposerCommandRegistry 或 useWorkbenchAgentCommands。
- ComposerCommandToken、ComposerCommandIcon、ComposerTokenIcon 的共享呈现迁到 ui-input-trigger 的公开 tokens 入口；只迁 token，不迁编辑器菜单、Lexical 或提交状态。共享 token 的最小类型留该 owner，不反向导入 composer。
- 文档 AST 使用现有纯契约；若现有公开类型携带编辑器依赖，抽出最小只读展示类型至既有 contracts owner。完整解析器仍留 ui-composer/document，由 nodes 调用。

## Shell / layout

- Shell 投影 `ConversationHeaderModel { fullTitle, displayTitle, workspaceName?, workspacePath? }` 与 `conversationActions?: ReactNode`，WorkbenchShell 透传 Header。
- 会话标题截断/new-thread fallback/工作区选择归 Shell adaptor；layout 保留 activeMainView 标题与 breadcrumb UI，并按现有条件显示会话 actions。
- ThreadScrollStateProvider 在 Shell installation 的 RuntimeProvider 内、WorkbenchShell 外安装一次。应用级 createThreadScrollPersistence factory 保留；删除 layout 专属透传字段。主会话和 SideChat 都必须处于相同缓存 Provider 下。
- actions 的 thread.menu slot context、pin/rename/archive 与 archive 后导航保持；Portal 仍使用原 Shell 容器。不得把 Provider 挪进单 Session。

## 可机器核对的禁止边

| consumer                     | 禁止的终态                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ui-tool                      | edit/write/bash/read/search 名称分支或正则协议识别、toolDiffModel、ReviewableDiff、workspace-file payload、为工具特例读取 opener/workspace/toast |
| ui-message-blocks            | agent-runtime-client、ui-composer 生产依赖；Session/命令注册表/agent commands hooks                                                              |
| ui-layout                    | ui-conversation、ui-conversation-list、ui-conversation-messages 生产依赖与 scroll Provider 安装                                                  |
| ui                           | ui-selectors dev 反向依赖；SearchableSelector 断言留在基础包                                                                                     |
| ui-conversation-messages CSS | Markdown/code-header/message-actions/composer-dock 的独占规则                                                                                    |

不是所有 runtime 依赖都要删除：nodes 是允许的业务适配层，layout 的其它通用状态消费需逐项判断。检查导入与 manifest 两层，不能通过 wrapper/deep import 隐藏依赖。
