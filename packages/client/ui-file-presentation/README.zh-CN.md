# 文件呈现

拥有可复用的文件图标以及浏览器保存/下载基础能力。图标入口通过显式安装的 `FilePresentationProvider` 获取 Material 图标资源基地址，不依赖 Shell context。下载入口不依赖 React，并保持选择器取消、Blob URL 清理及回退下载行为。

公开入口：`@workbench/ui-file-presentation/icons` 和 `@workbench/ui-file-presentation/download`。

运行 `pnpm --filter @workbench/ui-file-presentation typecheck` 及纯 Material 图标测试。本次重构只审查 UI 测试，不运行 UI 测试。
