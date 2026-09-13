# @workbench/ui-agent-controls

拥有通用模型选择和上下文/Token 用量界面。src 放组件、状态所有权、扩展装配及词典，lib 放组件实际使用的模型映射、推理标签、动画与吞吐辅助；保留 TS/TSX，两处源码均最多一级目录。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/model-selector.tsx` 引用 `lib/model-selector-state.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

`./selector` 公开通用模型选择视图，`./model-selector` 保留业务连接器；`./models` 在原状态辅助之外公开模型类型、分组与筛选。视图消费 ui-selectors 以及本包 lib/model-selector-models.ts，既有测试随实现迁移。
