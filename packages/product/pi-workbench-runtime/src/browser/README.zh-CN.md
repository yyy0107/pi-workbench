# Workbench 产品 Browser 接入

浏览器工具、脚本执行、会话选择和 Pi 宿主适配归 Node 产品。通用浏览器引擎与宿主合同仍归 `@workbench/browser-server` 和 `@workbench/browser-contracts/host`。

本目录中 `index.ts` 负责核心工具与取消状态，`tools.ts` 负责具名浏览器工具，`script.ts` 与 `script-worker.ts` 负责脚本执行；`standalone-host.ts` 复用现有 Workbench 宿主或已有独立会话浏览器回退。
产品的 `resources/extensions/browser/index.ts` 负责工具和生命周期注册，`resources/skills/browser-use` 是 Skill 唯一源码。

公开入口：`@workbench/pi-workbench-runtime/extensions/browser`、`/tools/browser`、`/browser-resources`。

产品 `scripts/build-browser-package.mjs` 生成 `internal-packages/browser` 兼容部署产物，包括 `index.js`、`resources.js`、`skills/browser-use`、元数据与 browser-server 第三方声明。
为保留用户资源过滤，安装标识 `@workbench/pi-runtime-browser` 与 `packages/.builtin/browser` 路径保持不变；仓库内不再有独立 Browser 工作区包。
Browser 只通过生成的 Pi 包加载一次，不再加入内联扩展列表。

产物保留已有独立 Pi 会话兼容性，依赖公开 Pi SDK。Workbench 中继续复用共享 BrowserManager、标签、权限与对话隔离。
