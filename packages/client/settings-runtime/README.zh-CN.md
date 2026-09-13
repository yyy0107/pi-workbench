# @workbench/settings-runtime

提供按安装隔离的 React 设置接口和可释放的展示资源。通过包公开入口使用。每个 Provider 固定自己的设置服务与资源缓存，Strict Effects 重放保留资源，真正卸载时释放资源。设置页面由其 UI 能力包管理。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/dispose-resources.ts`.

实际调用示例：`src/index.tsx` → `lib/dispose-resources.ts`.

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/index.tsx` 引用 `lib/dispose-resources.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
