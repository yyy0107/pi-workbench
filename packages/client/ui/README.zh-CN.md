# @workbench/ui

基础控件、语义 token、Portal 归属、剪贴板、尺寸调整、键盘归属和折叠滚动能力。公开入口在 package.json 中明确列出。业务文件操作归 workspace-files；UI 文案使用显式安装的 uiTranslationBundle。Shell 按原有层叠顺序聚合组件样式与全局 token。所有弹层使用所在安装的 Portal，继续复用密度、圆角与颜色配置。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/clipboard.ts`, `lib/components/model-selector-models.ts`, `lib/disclosure/disclosure-scroll-policy.ts`, `lib/keyboard-shortcut-owner.ts`, `lib/resize/observe-resize-handle.ts`, `lib/resize/proportional-panel-size.ts`, `lib/resize/resize-spring.ts`, `lib/utils.ts`.

实际调用示例：`src/components/avatar.tsx` → `lib/utils.ts`.

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/clipboard.ts` 引用 `lib/clipboard.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
