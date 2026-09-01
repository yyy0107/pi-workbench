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
`closeOthers`、`closeAll` 和 `update`。草稿线程获得远端 ID 时，root binding 只调用一次
`promoteThreadScope(fromThreadKey, nextContext)`；目标 scope 从 `nextContext.threadId` 派生，核心在同一
状态提交中重算 contribution-owned resource key 并处理不允许重复的碰撞，保留 live draft instance 的
ID/脏状态/参数。若 contribution 暂未注册，则只迁移 scope 并保留 opaque key，不猜测业务去重规则。
布局写操作同样只经过 Controller，包括
`setWorkspaceOpen`、`setAuxiliaryOpen` 和尺寸更新。关闭工作区或辅助区只隐藏布局，不删除实例。

核心不会根据 `kind` 判断业务作用域，也不会导入任何具体 Surface/Service。扩展未注册时，持久化实例
仍会被恢复并显示为不可用标签；相同 kind 的扩展稍后激活后，标签可再次渲染。这避免 ExtensionProvider
激活时序或临时禁用扩展导致用户布局丢失。

布局元数据（包括辅助区显隐与宽度）保存在 `~/.pi/agent/workbench-settings.json` 的
`preferences.rightWorkspace`。只有在权威 settings 读取成功并确认该字段缺失后，旧浏览器键
`pi-workbench:right-workspace:v1` 才会作为迁移输入；归一化 settings 写入成功后才清理旧键。
settings 读取、写入或旧键删除失败都会保留迁移线索，留待新的 Provider installation 重试，未知远端
或未知版本的持久化结构不会被默认快照覆盖。同一浏览器 realm 只允许一个安装承担旧键迁移；现代
settings、Store 与 Controller 本身仍按 Provider installation 隔离。React 组件、Service、WebSocket、
Browser Session、文件缓冲区和其他不可序列化资源不进入核心 Store。

`@workbench/shell/right-workspace/react` 的通用 `RightWorkspaceProvider` 在一次挂载中固定捕获
persistence、validator、initial context、WorkspaceSurfaceRegistry 与 opener factory。它们属于不可变
installation 输入；若上层更换任一 owner，必须通过 keyed remount 建立新 installation，不能把该
Provider 当作响应式 prop adapter 使用。React Strict Effects replay 复用已提交 installation；真实卸载或
key replacement 才会 dispose。旧 Controller 与 feedback writer 随后稳定 fail-fast，React 环境只暴露
selector hooks，不公开 raw environment 或 Store owner。

`@workbench/shell/application` 直接组合通用 `RightWorkspaceProvider`；Web 的
`apps/web/src/workbench/providers/workbench-providers.tsx` 只向 `WorkbenchApplicationShell` 注入应用标识、
资源、运行时 Provider 与持久化能力。Shell claim/store 不导入具体 Agent Runtime。
Runtime Host 使用 registry 每次注册产生的 frozen definition identity 作为本地挂载身份；同一个 kind
被 dispose 后重新注册时会强制 remount 并清除旧 Error Boundary，即使 runtime component function 未变，
也不需要 module-global registry。

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
React component、store 或 surface kind。Pi 文件能力位于
`packages/agent-runtime/adapters/pi/contributions/src/services/workspace-file-service.ts`，
并以 Workspace scope + path 隔离缓冲与订阅；后续替换为 App Server-backed adapter 时不需要改
Explorer/File 的组件边界。

## 当前内置扩展

- `workbench.workspace-review`
- `workbench.workspace-explorer`
- `workbench.workspace-file`
- `workbench.workspace-browser`
- `workbench.workspace-artifact`
- `workbench.terminal`

它们由 `apps/web/src/workbench/runtime-contributions/installed-workbench-extensions.ts` 从 Shell 与 Pi
contribution 的公开 extension groups 静态组合。各自拥有 Surface、菜单入口、领域 Service、Runtime
Bridge 和 `extensions.*` i18n 文案；禁用任一扩展不影响核心聊天或其他 Surface 能力。
Surface 实现模块在实例首次激活时懒加载，切走后按 `keep-alive` 保留；注册元数据与轻量 Runtime
bridge 仍在启动时同步激活。
