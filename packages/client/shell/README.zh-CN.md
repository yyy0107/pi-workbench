# @workbench/shell

[English](README.md)

`@workbench/shell` 是 Workbench 的应用装配包。它安装共享 Shell Context、设置与语言适配器、
扩展注册表、运行时和导航端口，以及 Web/Desktop 使用的能力 bundle。它保留应用生命周期和
组合边界；可复用 UI 能力由各自的所属包维护。

当前公开入口为：

- `@workbench/shell/application`：应用入口和安装属性。
- `@workbench/shell/browser-session-persistence`：浏览器会话持久化适配器。
- `@workbench/shell/extensions`：内置扩展分组与 Shell 所有的扩展导出。
- `@workbench/shell/i18n`：Shell Provider、运行时视图和共享 bundle 组合 API。
- `@workbench/shell/i18n/runtime`：无 React Provider 的运行时和翻译描述符类型。
- `@workbench/shell/styles.css`：Web/Desktop 统一样式入口。

包清单是这组入口的唯一依据。消费者必须使用这些显式入口，不能通过文件系统路径导入
Shell 内部模块。

能力归属如下：

- `@workbench/ui-layout` 负责 `WorkbenchShell`、框架、Header、Statusbar、全局层、侧栏外框
  与 resize、布局观测和布局所属的 hydration。Shell 负责安装和组合它。
- `@workbench/ui-sidebar` 负责会话和工作区列表、排序与拖放策略、`ConversationActionsMenu`、
  工作区侧栏扩展，以及 `workbench.sidebar.*` bundle。`workbench.shell.workspace` 也归该
  bundle 所有，因为 Header 和工作区扩展都会使用它。
- `@workbench/ui-panels` 负责面板布局、dock、尺寸和 `TerminalDrawer`。Panel 状态仍由 Shell
  Context 按每个 Workbench 安装实例创建。
- Extension Host 负责命令面板入口及其键盘和生命周期行为。
- Conversation、Composer、workspace、settings、terminal 和 Pi 能力继续由原有包维护，并提供
  各自的翻译 bundle 和扩展。

Shell 将各能力 bundle 聚合到唯一安装的 `@workbench/i18n` Provider 中。Shell 负责语言
hydration、revision 和 cookie 行为，各能力负责自己的双语词典。Shell 不创建第二个翻译
Context，也不复制能力包的 Hook。

`styles.css` 仍是 Web 和 Desktop 的唯一样式入口，按既有顺序导入 Shell 全局样式及各能力
所属样式。应用只提供宿主字体和 Tailwind 扫描根；区域 token 与样式由能力包负责。Portal
容器和安装级状态仍位于 Workbench Shell 根节点之内，确保菜单、对话框、拖放覆盖层等浮层
继承当前安装实例的主题和键盘所有权。

本包不负责产品路由、Pi 实现、平台传输或原生/Electron 逻辑。应用在安装时提供导航适配器、
运行时连接、设置服务、扩展注册表、初始语言和能力 bundle。

目录保持浅层：`src/` 存放 Shell 装配和契约，`lib/` 只存放有真实 Shell 消费者的辅助模块，
`tests/` 存放包测试。UI 测试按项目约束保留但不纳入本轮迁移验证；类型、结构、依赖、非 UI
逻辑和构建检查仍适用。

常用检查：

```bash
pnpm --filter @workbench/shell typecheck
pnpm check:package-structure
```

安装层在 RuntimeProvider 内装配会话标题/动作与唯一 ThreadScrollStateProvider，覆盖主会话和 SideChat。
