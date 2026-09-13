# 工作区文件查看器

注册 `workbench.workspace-file`、`file` Surface、打开器和 overlay 桥接；拥有文本/代码/Diff/Markdown/媒体/文档渲染、渐进式文档、编辑与预览资源租约。根入口导出扩展定义，`/opener`、`/openers`、`/surface`、`/i18n` 提供对应契约。

文件服务、链接和应用偏好来自 workspace-files。保留 `extensions.workspaceFile.*` 描述符键、两个标签的替换规则、未保存缓冲保护、资源去重及注册释放语义。预览资产基地址由应用提供。运行 `pnpm --filter @workbench/workspace-file-view test` 和 `typecheck`。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/file-breadcrumb-model.ts`, `lib/file-buffer-draft.ts`, `lib/file-view-mode.ts`, `lib/progressive-text-document.ts`, `lib/virtualized-code-window.ts`.

实际调用示例：`src/file-breadcrumb-tree.tsx` → `lib/file-breadcrumb-model.ts`.
