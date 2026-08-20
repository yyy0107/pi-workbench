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
    └── Artifact Extension
              ↓
RightWorkspace Core
├── WorkspaceHeader / Tabs
├── SurfaceHost
├── FeedbackLayer
└── StatusLayer
```

终端仍是独立的 Bottom Panel/Drawer。RightWorkspace 工具栏中的终端按钮来自
`workspace.actions` Slot，空状态启动入口来自 `workspace.empty.actions` Slot，但终端会话不属于
Surface 生命周期。

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
  render: ExampleSurface,
  menuItem: ExampleMenuItem,
  runtime: ExampleRuntimeBridge,
});
```

- `render`：业务 Surface；核心只负责挂载、隐藏和错误隔离。
- `menuItem`：可选的功能自有添加入口，由核心加号菜单统一承载。
- `runtime`：可选的功能自有 Runtime 桥，用于把 Agent 工具事件转换为该能力的打开或刷新动作。
- `icon`：由核心标签 Host 渲染。
- `getResourceKey`：由能力定义资源去重语义。
- `getDefaultScope`：由能力选择 thread/worktree/project/application 作用域。

注册会自动归属当前扩展。setup 回滚、停用或 Provider 卸载时，定义随扩展 Disposable 一起撤销。

## 核心生命周期

所有标签写操作仍经过 `RightWorkspaceController`：`open`、`reveal`、`focus`、`close`、
`closeOthers`、`closeAll` 和 `update`。关闭工作区只把宽度收为零，不删除实例。

核心不会根据 `kind` 判断业务作用域，也不会导入任何具体 Surface/Service。扩展未注册时，持久化实例
仍会被恢复并显示为不可用标签；相同 kind 的扩展稍后激活后，标签可再次渲染。这避免 ExtensionProvider
激活时序或临时禁用扩展导致用户布局丢失。

布局元数据保存在 `pi-workbench:right-workspace:v1`。React 组件、Service、WebSocket、Browser
Session、文件缓冲区和其他不可序列化资源不进入核心 Store。

## 当前内置扩展

- `workbench.workspace-review`
- `workbench.workspace-explorer`
- `workbench.workspace-file`
- `workbench.workspace-browser`
- `workbench.workspace-artifact`

它们在 `extensions/enabled-extensions.ts` 静态启用。各自拥有 Surface、菜单入口、领域 Service、
Runtime Bridge 和 `extensions.*` i18n 文案；禁用任一扩展不影响核心聊天或其他 Surface 能力。
Terminal 扩展只贡献外部 Drawer 入口。
