# 工作区文件

拥有文件服务/缓冲、ExplorerTree、文件链接/菜单、本地应用选择与偏好以及文件分类。文件图标及浏览器保存/下载基础能力来自 `@workbench/ui-file-presentation`。根入口提供服务，`/tree`、`/links`、`/classification`、`/open-apps`、`/open-preferences`、`/app-icon`、`/markdown-links`、`/i18n` 提供明确的能力入口。

Product 安装词典并注入 Markdown 文件适配器。FileLink 通过已注册打开器操作，不导入文件查看器。保留浏览器打开前保存、未保存缓冲、路径/行列位置解析和本地应用偏好语义；文档预览资源租约归 file-view。运行 `pnpm --filter @workbench/workspace-files test` 和 `typecheck`。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/asset-module-url.ts`, `lib/file-classification.ts`, `lib/file-link-content.ts`, `lib/tree/file-name-parts.ts`.

实际调用示例：`src/file-link-menu.tsx` → `lib/file-link-content.ts`.
