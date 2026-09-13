# 数据与状态所有权

本期没有新增持久化实体、RPC、数据库字段或协议版本。

| 模型                       | 字段 / 关系                                                                                                          | owner 与约束                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ResolvedToolPresentation   | 现有 label/activeLabel/icon/summary，加 summaryComponent、getExpandable、showCompletionIcon、group、getResourceStats | SDK 声明，Pi 实例；通用 UI 消费；派生值不写 Session                                             |
| ToolResourceStat           | file、可选 added/removed                                                                                             | 适配器返回现有统计语义，通用层按 file 聚合；不得夹带 diff payload/service                       |
| MessageBlockView input     | 现有 block 内容、isLast、isRunning、可选 retry、attachment reader                                                    | nodes 投影；blocks 不查 Session；reader 使用 contracts request/result                           |
| ReadonlyComposerView input | 已解析文档与 token 展示信息                                                                                          | nodes 读取 registry/agent commands 并解析；blocks 只渲染；解析器仍由既有 composer/document 提供 |
| ConversationHeaderModel    | fullTitle、displayTitle、workspaceName?、workspacePath?；独立 actions 节点                                           | Shell 读取当前会话；layout 保留 main view chrome/breadcrumb 装配                                |
| SidebarViewModel / Actions | 当前视图所需 thread/workspace/selection/drag 数据与语义操作                                                          | 显式类型取代 ReturnType(controller)；唯一现有 store，不暴露整个 runtime/capabilities            |
| Composer interaction       | editor ref、建议、附件、命令参数、提交 guard                                                                         | 原组件实例内协调；模块化不增加 editor/store 或改变 session identity                             |
| Appearance control state   | draft、committed、interacting、timer/RAF                                                                             | 控件 owner；共享 settings store、ID 和写入策略不变                                              |

## 状态转换与不变量

- Tool running → complete/error/incomplete/requires-action：沿用现有 toolTimelineCallState；Pi 决定 diff 可展开条件，generic 保留错误和原始 details 的可读性。
- 附件 id/image 条件改变 → reset → 异步 read → 当前请求仍有效才展示；失败仍显示卡片 fallback。不得在失效/卸载后写入状态。
- retry：无回调/非末条/running/retrying 时依原规则阻止；重试 finally 复位；不在 block 新建会话命令。
- scroll persistence：每 installation 一份 identity，Strict Effects 延迟销毁和主/侧会话缓存共享保持。
- sidebar move：保留既有 pin 与 save 顺序及部分失败语义；状态接口收窄不改变事务。
- Composer：IME 与键盘优先级、失效搜索响应、切会话清理、焦点/ref、提交中防重、附件释放沿用原生命周期。
- Theme：Range 帧更新/交互结束提交、Color 延迟提交与取消各自保持；切页面/卸载不遗留写入。
