# @workbench/pi-runtime-browser

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

供 Workbench 与独立 Pi CLI 使用、可独立分发的 Browser Pi Package。

执行环境：Node.js / 服务端。

## 职责

- 通过共享 BrowserHost 合同和 Workbench 浏览器引擎提供浏览器工具。
- 使用注入的 Workbench Host，或为独立 Pi 会话惰性创建隔离浏览器。
- 将 browser-use 技能与扩展一起分发，使该包能够独立安装。

## 如何导入

```ts
import browserExtension, { createBrowserExtension } from "@workbench/pi-runtime-browser";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                  | 入口源码                               |
| ----------------------------------------- | -------------------------------------- |
| `@workbench/pi-runtime-browser`           | [src/index.ts](./src/index.ts)         |
| `@workbench/pi-runtime-browser/resources` | [src/resources.ts](./src/resources.ts) |

## 源码导航

| 位置                                                       | 说明                |
| ---------------------------------------------------------- | ------------------- |
| [src/index.ts](src/index.ts)                               | 扩展与 Host 接入    |
| [src/tools.ts](src/tools.ts)                               | 具名浏览器工具目录  |
| [src/standalone-host.ts](src/standalone-host.ts)           | 独立会话生命周期    |
| [src/resources.ts](src/resources.ts)                       | 开发/产物资源地址   |
| [lib/script-worker.ts](lib/script-worker.ts)               | 独立脚本执行 Worker |
| [skills/browser-use/SKILL.md](skills/browser-use/SKILL.md) | 配套技能            |

## 边界与接入约定

Workbench 默认包注册归 pi-workbench-runtime，浏览器引擎行为归 browser-server；SDK 服务层不拥有此扩展及配套技能。

相关所有者：

- [@workbench/browser-server](../../server/browser-server/README.zh-CN.md)
- [@workbench/browser-contracts](../../contracts/browser-contracts/README.zh-CN.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-runtime-browser typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。

## 安装与使用

在具备工作区依赖的源码目录下，可将此包作为本地 Pi Package 安装：

```bash
pi install /absolute/path/to/workbench-ui/packages/pi-runtime/pi-runtime-browser
```

本地包按路径登记，目录需保持可访问；在空闲会话执行 `/reload` 或创建新会话以加载更新。源码 manifest 加载 `src/index.ts`。Workbench 已通过 Node 产品包将它部署到 Pi 用户目录的 `packages/.builtin/browser`，不需要重复手动安装。

在本包目录执行以下命令生成可分发归档：

```bash
pnpm pack --pack-destination /absolute/path/to/artifacts
```

`prepack` 构建 `dist/`；归档携带编译后的扩展、浏览器引擎、manifest、配套技能与 README。解压后使用 `pi install /absolute/path/to/extracted/package` 安装；Pi 提供 SDK、pi-ai 和 TypeBox。

运行 Pi/Workbench Runtime 的机器需要 Chrome 或 Chromium（当前引擎最低要求为 123）。本包不附带浏览器可执行文件；可通过 `WORKBENCH_BROWSER_EXECUTABLE` 指定路径。Workbench 使用浏览器设置中选择的应用内浏览器或已有 Chrome 连接；独立 Pi 按会话惰性创建隔离的无头浏览器，不共享用户日常 Profile。独立会话的浏览器随会话关闭、重载或替换清理，Workbench 共享浏览器仍由原 Host 管理。

让 Pi 使用 Browser，或调用 `/skill:browser-use`。优先使用具名 `browser_*` 工具；`workbench_browser` 保留兼容 action 入口。操作先获取当前标签和快照引用，页面导航后重新观察。返回的标签 `id` 对应 `sessionId`；省略时选取会话默认标签，不代表用户当前聚焦标签。

普通导航、快照、点击、填写和截图沿用浏览器引擎的权限规则；下载、上传、历史读取等需要相应权限。JavaScript/CDP 和本地脚本能力要求启用完整 CDP 访问；权限拒绝、取消或没有对话 UI 都不会自动授权。页面 `dialog.respond` 只响应网页对话框，不授予其他权限。

截图是模型图像内容；模型能否理解图像与终端能否内联显示图像是两个条件。鼠标位置使用视口 CSS 像素，不能直接照搬位图像素坐标。本地网站使用 HTTP 开发/静态服务器，直接 `file:` 导航不受支持。

具名工具目录、输入语义、Profile 连接、脚本执行和权限生命周期的详细说明见[英文操作参考](README.md#browser-operation-guide)；准确参数以工具 schema 为准。
