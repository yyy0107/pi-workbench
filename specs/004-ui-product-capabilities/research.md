# Research

## D1：从业务大包继续拆

Decision：选取15个真实owner，来源见capability-inventory。Rationale：上一轮只抽基础交互，业务设置与conversation仍混合多项产品职责；本轮按可独立注册/消费的能力成组迁移。Alternative：继续只拆Button等原语，无法满足用户这次的粒度要求。

## D2：设置容器与设置项分开

Decision：ui-settings保留容器/request/sidebar，ui-theme接外观，ui-settings-general接语言/通用会话设置。Rationale：容器被其它能力消费，不应再随general一起形成新的大包；现有settings-sidebar搜索分组算法可提入真实lib。Alternative：把整个剩余settings搬到general只改名，未减少混合职责。

## D3：模型选择与Token分别完整迁移

Decision：ui-model-selection接模型与reasoning标签，ui-token-usage接用量，删除ui-agent-controls。Rationale：reasoning-effort-label实际引用model-selector-state与模型翻译键，须随模型同迁；两类能力都有真实helper。Alternative：模型视图独立但继续回引旧agent-controls词典会保留不必要耦合。

## D4：Pi配置保持Pi领域

Decision：pi-ui-settings-models，不用通用ui-settings-models名。Rationale：实际依赖pi-client/protocol/provider配置；沿用全仓pi-ui-*规则。其余agent配置保持原包，不复制服务端认证实现。

## D5：完整工具展示闭包

Decision：不只移动ToolCall/ToolGroup；timeline、ReasoningPanel、Context、diff/timeline helper同迁ui-tool，disclosure默认策略提到新owner。Rationale：真实依赖链可通过公开纯policy及ui-todo/model切断；conversation保留总装配。Alternative：直接搬文件后回引conversation/policy会成环；因有耦合就完全不拆又不足以满足本期目标。

## D6：输入与附件不复制编辑器状态

Decision：payload继续现有contracts，composer传props/token操作回调；document/history/submit留composer。Rationale：保持唯一编辑器和发送状态。Alternative：把整个composer移到lib或新包只包一层转发不成立。

## D7：参考未提供实现的项目不虚构

Decision：native picker、toolbox细分及未确认goal/workflow/subagent专用UI不作为本期创建目标。Rationale：目录文本没有内部实现，不能据名称推断功能；已有实际替代owner逐项记录reference-map。用户明确的源码语言/lib约定和无UI测试约束继续保持。

研究由Luna审计settings/model/directory、Sol审计conversation/composer，主Agent复核policy/词典/装配并确定最终取舍。研究只读，未执行UI或产品测试。
