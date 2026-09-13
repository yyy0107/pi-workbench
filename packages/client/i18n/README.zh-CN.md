# @workbench/i18n

统一翻译运行时与受控 React Provider。语言标识复用 contracts/locale；运行时从空词典开始，通过显式、不可变的 bundle 安装能力词典。使用 bundle 的类型化描述符工厂与 Hook，每个能力保留自己的中英文词典。Provider 按安装隔离，不维护进程级字典注册表。设置加载、保存、页面语言与 cookie 由应用装配负责。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/catalog-tree.ts`.

实际调用示例：`src/runtime.ts` → `lib/catalog-tree.ts`.

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/runtime.ts` 引用 `lib/catalog-tree.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

能力包将词典集中于 `src/i18n/{index,en-US,zh-CN}.ts`，由不依赖 React 的 `./i18n` 公开入口暴露 bundle。组件直接调用共享 `useI18n(bundle)`，无需本地 Hook 包装；重载将 `t` 限定为该 bundle 的键，同时保留已安装词典的描述符解析、formatter 和 `setLocale`。无参 `useI18n()` 保持全局 Context API；`useTranslationBundle(bundle)` 继续提供原有较窄的翻译和格式化接口。
