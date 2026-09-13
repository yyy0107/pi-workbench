# @workbench/composer

负责输入编辑器、命令文档、Token 与参数、历史、附件及提交；消息渲染归 Conversation。会话偏好复用 settings-runtime 的同一安装级资源。src 为真实能力实现、公开入口、词典和样式，lib 为内部辅助模块，tests 为测试。CSS 入口保持原 Shell 级联顺序。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/agent-command.ts`, `lib/composer-command-argument-hint.ts`, `lib/composer-command-group-order.ts`, `lib/composer-command-icon-color.ts`, `lib/composer-image-paste.ts`, `lib/composer-input-history.ts`, `lib/composer-markdown-detection.ts`, `lib/composer-panel-styles.ts`, `lib/composer-text-paste.ts`, `lib/legacy-pi-compat.ts`.

实际调用示例：`src/composer-document.ts` → `lib/legacy-pi-compat.ts`.

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/agent-command.ts` 引用 `lib/agent-command.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
