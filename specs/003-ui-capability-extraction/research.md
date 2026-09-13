# Research: UI 能力归属

研究基于 `8d4b6568` 的真实 imports、exports、manifest、源码/helper、CSS 和测试入口。Luna 审计选择/设置控件，Sol 审计 resize/disclosure/sidebar/Portal/keyboard；主 Agent 复核循环与测试分类。没有网络研究需求，没有未决澄清。

## R1 — 三项新能力

**Decision**：建立 ui-selectors、ui-resize、ui-disclosure。

**Rationale**：富选择器跨 workspace/browser/automation/toolbox 使用；resize 在 layout/inspector 使用并有三组真实 helper；disclosure 被 conversation/code-highlighting/agent-controls 共用且拥有同一 scroll-lock 协议。它们不是简单的单控件别名。

**Alternatives**：全部放 ui 的子目录不能收窄包依赖与公开所有权；按文件各建一包会制造空 helper/碎片入口；归入任一业务包会让其他消费者反向依赖业务。

## R2 — 优先复用已有 ui-* owner

**Decision**：ModelSelector 归 ui-agent-controls；ColorPicker 归 ui-settings；Sidebar primitives/拖放/行样式归 ui-sidebar。

**Rationale**：模型业务连接器已有且是视图主要消费者；颜色控件唯一生产消费者是外观设置；侧栏行与 pointer reorder 已服务线程/工作区列表。现有 owner 已有实际 src/lib 与测试体系。

**Alternatives**：ui-model-selector/ui-color-picker/ui-sidebar-primitives 另建包会重复既有所有权。本轮使用窄 subpath 区分 view、primitives、reorder，不创建第二个业务 Context。

## R3 — 保留基础层

**Decision**：Button/Input/Textarea、Select、DropdownMenu/Popover/Dialog/Tooltip/ContextMenu、Command、Surface/Tabs、settings-layout/control、TimePicker、ProjectTrustDialog、Toast、running indicator、Portal、tokens/menu styles、keyboard/clipboard/通用 hooks 留在 ui。

**Rationale**：设置布局和信任对话框跨业务复用、主要由 props 提供文案；迁入 ui-settings 会让 conversation 等消费者形成高层依赖乃至循环。TimePicker 目前唯一生产消费者是 automation，但无独立测试/helper 能力组，暂不拆微型包。Toast 与基础反馈设施保留。Portal 是低层弹层共享 Context，移动会扩大基础依赖且没有独立 lib。keyboard 仅一小段 owner 算法，当前 src 只是转发，单独建包不满足真实 src/lib 要求。

**Alternatives**：拒绝把 keyboard 放 ui-sidebar，因为 Extension Host 使用 keyboard，而 ui-sidebar 已依赖 Extension Host。拒绝为 Portal/time/keyboard 制造无实际需求的 helper。

## R4 — 迁移必须闭合内部调用

**Decision**：resize handle 与 hooks 同迁；ModelSelector 紧随 selectors 改用新 owner；基础 ui 不保留反向转发。

**Rationale**：留下任一内部组件使用已迁出的功能，都会迫使 ui 回引高层 package。selectors 继续通过现有 public menu styles/Portal/tooltip/utils 接口复用基础能力。

## R5 — 文案和样式合同

**Decision**：只迁移 `ui.colorPicker.*` 子树到 settings bundle，保留完整键和值；其他新包只传递既有 labels，不新增空词典。sidebar/colors CSS 从原 components.css 拆出后在 Shell 原位置按 sidebar→icons→color 顺序聚合。

**Rationale**：保持本轮刚完成的 i18n 去重，避免重新创建 use-i18n 包装或双 bundle 键碰撞。token 作用域和 portal sibling 样式不能因归属变化改变。

## R6 — 验证分类

**Decision**：纯数值/文本/集合算法和静态边界可运行；DOM/React/render/fake browser/Observer UI 用例排除。

**Rationale**：扩展名 .test.ts 并不保证非 UI。实际读取发现 resize hook 用例调用 renderToStaticMarkup、observer 用例操作 ARIA 与假节点。现有20个 ui 测试文件均有去向，移动既有文件不等于运行测试。
