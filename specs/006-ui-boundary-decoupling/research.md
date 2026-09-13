# 研究结论

研究基于当前源码与现有 SDK/Host 接口，不根据参考目录机械拆包。Luna 研究 Shell/主题/测试归属，Sol 研究工具呈现与消息块；主 Agent复核并收敛下列决定。

## 工具呈现

**Decision**：复用 ToolPresentationDefinition 和 exact tool renderer；原始参数、diff、workspace-file request、工具分类、query 摘要归 Pi contribution。通用 ui-tool 只消费呈现元数据与协议无关状态。

**Rationale**：只搬 ReviewableDiff 不足够；toolChip、toolKind、timelineEntries、timelineStats 和 latestActivity 仍识别名称/参数。附件式 resource 回调也无法表达 summary、展开与完成图标差异。

**Alternatives**：不保留 edit/write 硬编码终态，不新建 registry，不把 opener 服务塞进 ToolCallBlock。Sol 的 resource keys 方案经复核改为资源统计记录：当前 timelineStats 还公开 added/removed，并按 basename 聚合，不能无意改成完整路径去重。合同保留现有语义，将统计规则交给适配器。

既有 read presentation 由 skillReadingExtension 注册；必须组合普通 read 呈现和 skill resolve，不增加第二个 read 注册。已安装工具的分类在所属 contribution 明确声明；未注册工具按通用 used 展示，不使用工具名正则猜测。

## 消息块

**Decision**：Session/action 与命令 registry 的读取移到 nodes adapter；块接收显式 props，保留局部展开/重试中/图片读取等展示状态。编辑器和只读消息共享的 token 组件迁入现有 ui-input-trigger。

**Rationale**：只移动目录不消除 blocks → Session/Composer/Host。完整 document parser 涉及扩展和指令，不宜整包塞入 contracts；暂保留 ui-composer/document，由上层适配使用。

**Alternatives**：不复制 token，不新增 block Session Context，不让每个块自行注册命令或查全局 runtime。

## Layout 与 Shell

**Decision**：Shell 注入会话 header model 和 actions；ThreadScrollStateProvider 在 RuntimeProvider 内、WorkbenchShell 外安装一次。

**Rationale**：仅移动菜单仍残留 ui-conversation/title 依赖，需一起移动标题截断和会话数据投影。scroll 缓存必须覆盖主会话与 SideChat。

**Alternatives**：不把 scroll Provider 移入单个 SessionProvider，不新建任意 wrapper 插件框架；SideChat scratch lease 与 workspace-bound session 不变。

## Composer、sidebar、theme

**Decision**：保留能力包，分别拆编辑器插件/异步协调、侧栏投影/事务接口、外观页面/控件。

**Rationale**：当前大文件混合职责，但已有 lib helper 被实际消费；继续开包会扩大公开面。sidebar 的宽 Context 暴露整个 runtime，与文件大小无关，应改显式接口和 selector。

**Alternatives**：不为每个 hook 开包，不复制 store，不把 Range 的 RAF/结束提交与 Color 的延迟提交强行合并。

## CSS 与测试

**Decision**：样式跟真实 DOM owner；message-actions 属 ui-conversation-nodes，composer dock 属 ui-conversation，Markdown/code header 属各自包。selector 既有断言移回 ui-selectors。

**Rationale**：消息流入口承载其它组件专属规则导致独立装配缺样式；ui 对 ui-selectors 的 dev 依赖是测试归属问题，不应误报成生产循环。

**Alternatives**：不新建 ui-message-styles 包，不提升全部选择器到 :root，不执行搬迁后的 UI 测试。
