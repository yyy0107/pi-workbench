# @workbench/workspace-explorer

拥有 workspace-explorer 能力实现及共置双语词典；消费者只使用公开入口，产品保持原有 bundle 与扩展安装顺序。稳定 ID、命令、持久化格式和安装级生命周期保持兼容。测试位于 tests/。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/explorer-runtime-policy.ts`.

实际调用示例：`src/explorer-runtime-bridge.tsx` → `lib/explorer-runtime-policy.ts`.

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/explorer-runtime-bridge.tsx` 引用 `lib/explorer-runtime-policy.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
