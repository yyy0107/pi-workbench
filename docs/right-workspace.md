# RightWorkspace 扩展架构

`RightWorkspace` 是聊天旁的 Inspector Workspace 宿主。核心只管理可调整宽度的布局、Surface
实例、标签、激活历史、作用域恢复、状态层、结构化反馈和可序列化持久化，不内置 Review、文件、
浏览器或产物业务。

```text
ExtensionManager
└── WorkspaceSurfaceRegistry
    ├── Review Extension
    ├── Explorer Extension
    ├── File Extension
    ├── Browser Extension
    ├── Artifact Extension
    └── Terminal Extension
              ↓
RightWorkspace Core
├── WorkspaceHeader / Tabs
├── SurfaceHost
├── FeedbackLayer
└── StatusLayer
```

这里的 `Extension` 是受信任、同进程、静态打包的 contribution bundle，不是具有独立 Host 或
权限隔离的第三方插件。Terminal 与 Explorer、File、Review、Browser、Artifact 一样注册为
Workspace Surface；底部 Panel 系统仍是通用宿主，但不再拥有 Terminal 业务语义。

## Surface Contribution

扩展通过 `ExtensionContext.workspace.register()` 注册能力：

```ts
context.workspace.register({
  kind: "example",
  icon: ExampleIcon,
  cachePolicy: "keep-alive",
  getResourceKey: (params, context) => `example:${context.projectId}:${params.id}`,
  getDefaultScope: (_params, context) => ({
    type: "project",
    key: context.projectId ?? context.applicationId,
  }),
  header: ExampleSurfaceHeader,
  render: ExampleSurface,
  menuItem: ExampleMenuItem,
  runtime: ExampleRuntimeBridge,
});
```

- `render`：业务 Surface；核心只负责挂载、隐藏和错误隔离。
- `header`：可选的主 Surface 顶部 chrome；由核心横跨主区和辅助区统一挂载，适合面包屑与资源操作。
- `render` 可使用 `createLazyWorkspaceSurface()` 包装动态 import；核心 `SurfaceHost` 提供统一
  Suspense loading fallback，重试时会重新执行失败的 loader。
- `menuItem`：可选的功能自有添加入口，由核心加号菜单统一承载。
- `runtime`：可选的功能自有 Runtime 桥，用于把 Agent 工具事件转换为该能力的打开或刷新动作。
- `icon`：由核心标签 Host 渲染。
- `getResourceKey`：由能力定义资源去重语义。
- `getDefaultScope`：由能力选择 thread/worktree/project/application 作用域。

注册会自动归属当前扩展。setup 回滚、停用或 Provider 卸载时，定义随扩展 Disposable 一起撤销。

## 核心生命周期

所有标签写操作仍经过 `RightWorkspaceController`：`open`、`reveal`、`focus`、`close`、
`closeOthers`、`closeAll` 和 `update`。布局写操作同样只经过 Controller，包括
`setWorkspaceOpen`、`setAuxiliaryOpen` 和尺寸更新。关闭工作区或辅助区只隐藏布局，不删除实例。

核心不会根据 `kind` 判断业务作用域，也不会导入任何具体 Surface/Service。扩展未注册时，持久化实例
仍会被恢复并显示为不可用标签；相同 kind 的扩展稍后激活后，标签可再次渲染。这避免 ExtensionProvider
激活时序或临时禁用扩展导致用户布局丢失。

布局元数据（包括辅助区显隐与宽度）保存在 `~/.pi/agent/workbench-settings.json` 的
`preferences.rightWorkspace`。旧浏览器键 `pi-workbench:right-workspace:v1` 会在首次 hydrate 时导入并删除。React 组件、Service、WebSocket、Browser
Session、文件缓冲区和其他不可序列化资源不进入核心 Store。

Surface 的 `title` 与 `statusMessage` 以 `LocalizableText` 持久化：内置界面文案保存
`defineMessage(...)` 描述符并由 Host 在渲染时解析，文件名、URL、用户/资源标题以及旧快照继续保存为
literal string。异步 Surface 错误通过 Extension error reporter 记录原始诊断；持久化状态只保存稳定、
面向用户的双语消息描述符，不直接保存或显示原始 `Error.message`。

## 资源打开边界

跨能力打开资源通过 `OpenerRegistry + OpenerService`，而不是直接 import 另一个 contribution：

```text
Explorer
  └── open({ scheme: "file", path })
        ↓
    OpenerService
        ↓ highest canOpen score
    File open handler
        ↓
    RightWorkspaceController.reveal({ kind: "file", ... })
```

File contribution 在同步 `setup()` 中通过 `context.openers.register(...)` 注册 handler。执行时
Service 注入通用 Surface operations，因此 setup 不需要 React Hook；Explorer 不知道 File 的
React component、store 或 surface kind。共享文件能力位于 `services/workspace-file-service.ts`，
并以 Workspace scope + path 隔离缓冲与订阅；后续替换为 App Server-backed adapter 时不需要改
Explorer/File 的组件边界。

## 当前内置扩展

- `workbench.workspace-review`
- `workbench.workspace-explorer`
- `workbench.workspace-file`
- `workbench.workspace-browser`
- `workbench.workspace-artifact`
- `workbench.terminal`

它们在 `extensions/enabled-extensions.ts` 静态启用。各自拥有 Surface、菜单入口、领域 Service、
Runtime Bridge 和 `extensions.*` i18n 文案；禁用任一扩展不影响核心聊天或其他 Surface 能力。
Surface 实现模块在实例首次激活时懒加载，切走后按 `keep-alive` 保留；注册元数据与轻量 Runtime
bridge 仍在启动时同步激活。
