# Workbench 扩展组件开发指南

本文说明如何为 Pi Workbench 开发扩展组件，并介绍 Slot、Panel、Command、Composer Command、Renderer、Settings、Sidebar Section、Main View、Workspace Surface、Open Handler 十类扩展能力。

让 AI 协助实现扩展时，可以显式调用项目技能 `$extend-workbench-ui`。技能位于 [`.agents/skills/extend-workbench-ui/`](../.agents/skills/extend-workbench-ui/SKILL.md)，会按本文的边界、流程和验证要求执行。

本文对应当前代码：

- Next.js 16 单应用；
- Workbench Agent Runtime；
- 扩展随应用静态打包；
- 不支持从远程 URL 加载 JavaScript；
- 不支持由扩展动态注册 Next.js 路由。

这里的内置 `Extension` 是受信任、同进程、静态打包的 **Contribution Bundle**。它不是第三方
插件 ABI，也没有权限隔离或独立 Extension Host；未来的外部插件体系应使用单独的 public API
与隔离边界。

扩展定义和贡献契约的纯入口是 [`packages/extension-platform/sdk/src/authoring.ts`](../packages/extension-platform/sdk/src/authoring.ts)，使用 `@workbench/extension-sdk` 不会加载 React Host 或 Next.js 宿主实现。挂载后的客户端组件从 `@workbench/extension-host` 使用公开 Hook；Workbench 组合层以及平台明确允许的 Renderer/Error surface 使用具体 leaf Host 入口，不依赖聚合 `hosts/` barrel、Registry 或其他内部实现。

## 1. 先理解十种扩展能力

一个扩展由 `defineExtension()` 定义，并在 `setup(context)` 中注册一个或多个贡献：

```text
activeExtensions = 应用组合层提供的完整有序扩展列表
  -> ExtensionProvider
    -> extension.setup(context)
      -> Slot / Panel / Command / Composer Command / Renderer / Settings / Sidebar Section / Main View / Workspace Surface / Opener Registry
        -> 对应 Host 渲染或执行
```

十种贡献各自解决不同问题：

- **Slot**：把小型组件插入宿主已经声明的位置，例如 Composer 按钮或状态栏指标。
- **Panel**：提供宿主管理尺寸与开关状态的左侧或底部辅助区域。
- **Command**：提供可复用动作，同时进入命令面板和快捷键系统。
- **Composer Command**：把 `/` 面板选项注册为结构化 Token，并在提交时编译为一次 Agent 请求。
- **Renderer**：接管整条消息的 Blocks/分组策略，或按 tool name、data name 渲染单个 Workbench Block。
- **Settings**：向共享悬浮设置面板注册导航分区或功能自有设置项。
- **Sidebar Section**：注册由 Shell 统一导航和搜索 chrome 承载的完整侧边栏区域。
- **Main View**：用完整功能页面替换中央对话区域；宿主管理“功能页 / 对话”的切换。
- **Workspace Surface**：向右侧 Inspector 注册可持久化的检查能力；核心只管理标签和布局。
- **Open Handler**：按资源能力评分处理 `file`、`https`、`artifact` 等打开请求，避免 feature 之间直接引用。

选择建议：

- 一个图标、按钮、状态值：使用 Slot。
- 需要左侧或底部独立工作区：使用 Panel。
- 需要工具箱、管理中心等宽屏完整功能页，并在退出后返回对话：使用 Main View。
- 需要右侧带标签、resourceKey 去重和作用域恢复的检查界面：使用 Workspace Surface。
- 一个 feature 需要打开另一个 feature 所拥有的资源：使用 OpenerService，不要 import 对方内部实现。
- 同一动作需要被快捷键、命令面板或按钮复用：使用 Command。
- 需要在消息文字中插入可删除、可组合的 `/command` Token：使用 Composer Command。
- 需要决定 reasoning/tool 是否分组、消息样式，或展示模型工具调用和结构化数据：使用 Renderer。
- 功能需要出现在共享悬浮设置面板：使用 Settings；分区由壳扩展注册，具体设置项由所属功能注册。
- 功能需要拥有完整侧边栏目的地：使用 Sidebar Section，并在定义中声明关联的 Main View kinds。
- 需要一个新 URL：直接增加 Next.js 文件路由，不要放进扩展 API。

## 2. 扩展的最小结构

推荐每个扩展拥有独立目录：

```text
packages/workbench/shell/src/extensions/builtin/notes/
├── extension.ts
├── notes-panel.tsx
├── notes-trigger.tsx
├── toggle-notes-command.ts
└── index.ts
```

目录按能力所有者组织。Shell 通用能力放在 Shell，Pi Runtime 能力放在 Pi contributions；应用组合层
只负责提供完整、有序的静态扩展列表。

最小扩展只有一个 `extension.ts`：

```ts
import { defineExtension } from "@workbench/extension-sdk";

export const exampleExtension = defineExtension({
  id: "workbench.example",
  name: "Example",
  version: "1.0.0",

  setup(context) {
    // 在这里注册贡献。
  },
});
```

字段约束：

- `id`：扩展全局唯一，推荐使用 `workbench.<feature>` 命名。
- `name`：供日志和开发工具识别的人类可读名称。
- `version`：当前只作为元数据，推荐从 `1.0.0` 开始。
- `setup`：只做注册和必要的资源初始化，不在模块顶层产生副作用。

`setup()` 可以返回 `void`、一个 `Disposable`，或 `Disposable[]`。ExtensionProvider 卸载、热更新或替换扩展时，会按反向顺序清理资源。

`setup()` 当前必须是同步函数，不能声明为 `async`，也不能返回 Promise。异步工作应放到组件 `useEffect()`、Command 的 `run()`，或由 setup 启动并通过 Disposable 可靠取消。

通过 `context.slots/panels/commands/openers/composerCommands/renderers/settings/sidebarSections/mainViews/workspace` 创建的 Disposable 会被 Manager 追踪。仍建议显式返回它们；额外创建的事件监听、计时器或订阅则必须包装成 Disposable 并返回。

`defineExtension()` 是保留字面量类型的 identity helper，真正的运行时校验和激活由 ExtensionManager 完成。扩展对象应定义在模块顶层并保持引用稳定；不要在 React render 中临时创建新的扩展对象或 `extensions` 数组，否则相同 id 也会因对象引用变化而先停用再激活。

## 3. 完整教程：Notes 扩展

下面实现一个 Notes 扩展，它包含：

- Composer 中的入口按钮；
- 左侧 Notes Panel；
- `Mod+Shift+N` 命令；
- 静态启用配置。

### 第一步：创建 Panel 组件

创建 `packages/workbench/shell/src/extensions/builtin/notes/notes-panel.tsx`：

```tsx
"use client";

import { useState } from "react";

import type { PanelComponentProps } from "@workbench/extension-sdk";

export function NotesPanel({ panelId, close }: PanelComponentProps) {
  const [value, setValue] = useState("");
  const inputId = `${panelId}-input`;

  return (
    <section data-panel-id={panelId} className="flex h-full min-h-0 flex-col gap-3 p-3">
      <label htmlFor={inputId} className="text-sm font-medium">
        Thread notes
      </label>
      <textarea
        id={inputId}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder="Write a note for this session…"
        className="min-h-0 flex-1 resize-none rounded-lg border p-3 text-sm outline-none"
      />
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={close}>
        Done
      </button>
    </section>
  );
}
```

要点：

- 使用 Hook、事件或浏览器 API 的组件必须带 `"use client"`。
- `panelId` 是注册时的 Panel id。
- `close()` 关闭当前 Panel。
- Workbench 已提供外层 Panel 标题和关闭按钮，扩展组件只负责内容区域。
- Panel 关闭后组件会卸载；需要持久化时，应把状态放到扩展自己的 Store 或持久化适配器中。

### 第二步：创建 Slot 入口

创建 `packages/workbench/shell/src/extensions/builtin/notes/notes-trigger.tsx`：

```tsx
"use client";

import { StickyNoteIcon } from "lucide-react";

import { usePanelService } from "@workbench/extension-host";
import type { ComposerSlotContext } from "@workbench/extension-sdk";

export function NotesTrigger({ isRunning }: ComposerSlotContext) {
  const panels = usePanelService();

  return (
    <button
      type="button"
      disabled={isRunning}
      aria-label="Toggle notes panel"
      className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs"
      onClick={() => panels.toggle("notes")}
    >
      <StickyNoteIcon className="size-3.5" />
      Notes
    </button>
  );
}
```

这里使用 `ComposerSlotContext`，所以组件可以读取：

- `isRunning`：当前 Thread 是否正在生成；
- `isEmpty`：Composer 是否为空。

组件通过 `usePanelService()` 操作已注册的 Panel。可用方法包括：

- `open(panelId)`；
- `close(panelId)`；
- `toggle(panelId)`；
- `activate(panelId)`；
- `move(panelId, location)`；
- `collapse(location)` / `expand(location)`；
- `setSize(location, size)`；
- `isOpen(panelId)` / `isCollapsed(location)`。

不要直接修改 `panel-store`，除非你在开发 Workbench 宿主本身。

### 第三步：创建 Command

创建 `packages/workbench/shell/src/extensions/builtin/notes/toggle-notes-command.ts`：

```ts
import { StickyNoteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@workbench/extension-sdk";

export const toggleNotesCommand = {
  id: "notes.toggle",
  title: defineMessage("extensions.notes.toggleTitle"),
  description: defineMessage("extensions.notes.toggleDescription"),
  category: defineMessage("extensions.shared.panelsCategory"),
  icon: StickyNoteIcon,
  shortcut: ["Mod", "Shift", "N"],
  run(context) {
    context.panels.toggle("notes");
  },
} satisfies CommandDefinition;
```

命令的 `run()` 可以是同步或异步函数。执行上下文目前开放：

- `context.panels.open/close/toggle()`；
- `context.navigation.newThread()`；
- `context.navigation.openThread(threadId)`。

快捷键说明：

- `Mod` 在 macOS 上是 Command，在其他平台上是 Ctrl；
- 也支持 `Ctrl`、`Meta`、`Alt`、`Shift` 等修饰键；
- 快捷键必须包含且只应包含一个普通按键；
- 系统不会阻止两个 Command 使用同一快捷键，应由扩展作者避免冲突；
- 快捷键匹配要求修饰键完全一致，额外按下修饰键不会匹配；
- 默认命令面板快捷键是 `Mod+K`。

### 第四步：注册三类贡献

创建 `packages/workbench/shell/src/extensions/builtin/notes/extension.ts`：

```ts
import { StickyNoteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@workbench/extension-sdk";

import { NotesPanel } from "./notes-panel";
import { NotesTrigger } from "./notes-trigger";
import { toggleNotesCommand } from "./toggle-notes-command";

export const notesExtension = defineExtension({
  id: "workbench.notes",
  name: "Notes",
  version: "1.0.0",

  setup(context) {
    const trigger = context.slots.register("composer.actions.left", {
      id: "workbench.notes.composer",
      order: 40,
      component: NotesTrigger,
    });

    const panel = context.panels.register({
      id: "notes",
      title: defineMessage("extensions.notes.title"),
      icon: StickyNoteIcon,
      component: NotesPanel,
      defaultLocation: "left",
      defaultSize: 360,
      minSize: 280,
      maxSize: 640,
    });

    const command = context.commands.register(toggleNotesCommand);

    return [trigger, panel, command];
  },
});
```

再创建 `packages/workbench/shell/src/extensions/builtin/notes/index.ts`：

```ts
export { notesExtension } from "./extension";
```

`defaultLocation` 只能是：

- `left`；
- `bottom`。

`defaultSize`、`minSize` 和 `maxSize` 在当前 Workbench 中使用像素。

Panel Registry 只保存定义。打开状态、位置和尺寸由 Panel Store 管理，因此不要把 `isOpen` 放进 `PanelDefinition`。

### 第五步：静态启用扩展

在所属 package 的公开 extension group 中加入扩展；Shell 的入口是
[`packages/workbench/shell/src/extensions/builtin-extensions.ts`](../packages/workbench/shell/src/extensions/builtin-extensions.ts)，
最终顺序由
[`apps/web/src/workbench/runtime-contributions/installed-workbench-extensions.ts`](../apps/web/src/workbench/runtime-contributions/installed-workbench-extensions.ts)
组合：

```ts
import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { notesExtension } from "./builtin/notes";
// 其他内置扩展 import...

export const builtinExtensions = [
  // 其他内置扩展...
  notesExtension,
] satisfies readonly WorkbenchExtension[];
```

完成后，由应用组合层把各 owner 的静态 extension group 合成为稳定的完整列表，再交给
ExtensionProvider 激活。不要增加目录扫描、运行时文件发现或远程 `import()`。

数组顺序就是激活顺序，也会影响相同 Slot `order` 时的先后、冲突快捷键的匹配顺序，以及 Command Palette 中同组命令的显示顺序。保持数组为模块级稳定常量。若需要让其他模块直接导入该扩展，可再从 owner package 的 `src/extensions/index.ts` 选择性导出。

### 第六步：验证

```bash
pnpm exec oxfmt --check packages/workbench/shell/src/extensions/builtin/notes
pnpm exec oxlint packages/workbench/shell/src/extensions/builtin/notes
pnpm exec tsc --noEmit
pnpm build
pnpm dev
```

浏览器中确认：

1. Composer 出现 Notes 按钮；
2. 点击后右侧 Panel 打开；
3. `Mod+K` 中能搜索到 Toggle Notes；
4. `Mod+Shift+N` 能切换 Panel；
5. Panel 在窄屏下仍能关闭；
6. 控制台没有重复 id 或未知 Slot 错误。

## 4. Slot 开发参考

### 当前可用 Slot

无 Context 参数的 Slot：

- `header.left`、`header.center`、`header.right`；
- `shell.background`、`shell.overlay`；
- `sidebar.brand`、`sidebar.header`、`sidebar.navigation`、`sidebar.workspace.actions`、`sidebar.top`、`sidebar.bottom`、`sidebar.footer`；
- `statusbar.left`、`statusbar.right`。

Inspector Workspace 工具栏 Slot：

- `workspace.actions`：参数为 `{ activeSurfaceId?: string, isOpen: boolean }`；适合不属于 Surface 生命周期的紧凑外部动作。
- `workspace.empty.actions`：参数为 `{ isOpen: boolean }`；用于空 Workspace 的可启动能力列表，贡献应渲染完整宽度的可访问操作项。

Thread Slot：

- `thread.left`、`thread.header`、`thread.before`、`thread.after`、`thread.right`；
- 参数为 `{ threadId?: string }`。

`thread.left` 与 `thread.right` 以全高形式挂载在对话中央列两侧，贡献组件需要自行定义宽度。文件、审查、浏览器、产物和终端等检查型界面通过 Workspace Surface Contribution 注册。

顶部会话操作菜单 Slot：

- `thread.menu`；
- 参数为 `{ threadId: string; closeMenu(): void }`；
- 贡献应渲染菜单项语义，并在开始或完成操作后调用 `closeMenu()`。分隔线由贡献自身携带，避免没有贡献时留下空白菜单装饰。

Message Slot：

- `message.before`、`message.after`、`message.actions`；
- 参数为 `{ messageId, role, isLast }`。

Composer Slot：

- `composer.before`、`composer.actions.left`、`composer.actions.right`、`composer.after`；
- 参数为 `{ isRunning, isEmpty }`。
- `composer.header.left`、`composer.header.right` 位于复合 Composer 的顶部上下文栏两侧；
- 参数同样为 `{ isRunning, isEmpty }`，适合项目、工作区、分支和紧凑状态信息。
- `composer.overlay` 与 Composer 卡片共享布局区域，适合需要暂时接管输入区的交互组件；
- 参数为 `{ isRunning, isEmpty, setOverlayVisible(visible) }`。贡献可见时应在 layout effect 中报告
  `true`，并在 cleanup 中报告 `false`，使宿主将底层 Composer 设为 inert。

完整类型定义见 [`packages/extension-platform/sdk/src/api/slot.ts`](../packages/extension-platform/sdk/src/api/slot.ts)。

`sidebar.brand` 位于侧栏顶部，用于可替换的产品标识；默认 `workbench-brand` 扩展在这里贡献 “Pi-Workbench”。`sidebar.navigation` 位于核心分段切换器下方，适合 Agent、资产等可选主导航；`sidebar.top` 位于“工作区”内容顶部并同时挂载于桌面与移动侧栏，适合“新建会话”等主要操作；`sidebar.workspace.actions` 位于同一工作区操作行右侧，适合添加、筛选等紧凑操作；`sidebar.footer` 位于侧栏固定底部，适合工作区分段的设置或状态入口。核心 Thread List 不由扩展替换。

`shell.background` 挂载在 Workbench 内容下方，适合全局底色、纹理、渐变或主题控制器。贡献必须保持非交互，不得在背景层放置按钮或链接；若要同步组件表面，应通过共享主题变量实现。

`shell.overlay` 在 Workbench 全局层只挂载一次，适合由多个响应式入口共同控制的 Dialog 或其他 portal 悬浮表面。贡献组件自行拥有打开、关闭与焦点行为；宿主只负责全局挂载和错误隔离。

当前移动端会话抽屉复用核心侧栏内容，但不挂载 `sidebar.*` Slot；Sidebar Slot 贡献目前只显示在桌面侧栏。需要移动端入口时，可像 Terminal 扩展一样额外注册 `header.right` 触发器。

`workspace.actions` 贡献应渲染紧凑按钮并提供 `aria-label`。已有 Workspace Surface 的入口优先由 definition 自有的 `menuItem` 注册到统一加号菜单。

`workspace.empty.actions` 贡献应渲染适合启动列表的完整操作项；它只用于 Surface 生命周期之外的补充入口。

### 排序与唯一性

同一个 Slot 可以注册多个组件：

```ts
context.slots.register("header.right", {
  id: "workbench.example.header",
  order: 20,
  component: ExampleBadge,
});
```

规则：

- `order` 从小到大渲染，默认是 `0`；
- `order` 相同时保持注册顺序；
- contribution id 在同一个 Slot 内必须唯一；
- 注册的是 `ComponentType<Props>`，不是预先创建的 ReactNode；
- Slot 组件位于 Workbench `RuntimeProvider` 内；需要当前会话身份时使用
  `useCurrentSession()`，只有明确位于 `SessionProvider` 内的 Slot 才使用 `useSessionState()`。

### 如何增加一个新的宿主 Slot

普通扩展只能使用已有 Slot。如果确实要扩展宿主契约，需要同时修改两处：

1. 在 `WORKBENCH_SLOTS` 与 `SlotPropsMap` 中增加名称和参数类型；
2. 在 `packages/workbench/shell/src/` 对应 Host 位置挂载 `SlotHost` 并传入 Context。

示意：

```ts
// packages/extension-platform/sdk/src/api/slot.ts
export interface SlotPropsMap {
  // ...
  "thread.toolbar": { threadId?: string };
}
```

```tsx
// packages/workbench/shell/src/chat/...
<SlotHost name="thread.toolbar" context={{ threadId }} />
```

新增 Slot 是宿主 API 变更，应评估命名、布局、响应式和后续兼容性，不应由单个业务扩展随意添加。

## 5. Sidebar Section 开发参考

Sidebar Section 注册一个完整侧栏目的地；Shell 统一提供导航、选择态与可选搜索框，功能扩展拥有
标题、图标、正文组件和关联的 Main View：

```ts
context.sidebarSections.register({
  id: "toolbox",
  title: defineMessage("extensions.toolbox.title"),
  icon: ToolboxIcon,
  component: ToolboxSidebar,
  order: 20,
  mainViewKinds: ["toolbox"],
  search: {
    label: defineMessage("extensions.toolbox.search"),
    placeholder: defineMessage("extensions.toolbox.searchPlaceholder"),
  },
});
```

正文组件接收 `{ mobile, searchQuery, onNavigate }`。它负责过滤和业务导航；移动端完成导航后调用
`onNavigate?.()` 关闭抽屉。标题、图标、搜索文案及翻译都属于贡献自身，Shell 不硬编码功能名称
或 Main View kind。注册返回的 Disposable 在扩展停用时自动释放，导航顺序按 `order` 再按注册
顺序排列。

## 6. Main View 开发参考

Main View 用于工具箱、管理中心等需要中央宽屏空间的完整功能页。扩展同步注册 renderer，再通过 `useMainViewService()` 打开或关闭：

```tsx
import { defineMessage } from "@/i18n";
import { useMainViewService } from "@workbench/extension-host";
import { defineExtension, type MainViewProps } from "@workbench/extension-sdk";

interface ExampleMainViewParams extends Record<string, unknown> {
  section: "overview" | "catalog";
}

function ExampleMainView({ view, close }: MainViewProps<ExampleMainViewParams>) {
  return (
    <section className="h-full">
      <button type="button" onClick={close}>
        Return to conversation
      </button>
      <p>{view.params.section}</p>
    </section>
  );
}

const contribution = context.mainViews.register({
  kind: "example",
  component: ExampleMainView,
});

function ExampleTrigger() {
  const mainViews = useMainViewService();
  return (
    <button
      type="button"
      onClick={() =>
        mainViews.open({
          kind: "example",
          title: defineMessage("extensions.toolbox.packages.title"),
          params: { section: "catalog" },
        })
      }
    >
      Open example
    </button>
  );
}
```

- `kind` 是全局唯一、不可本地化的稳定 ID；`open()` 会拒绝未注册的 kind。
- `title` 是顶部栏显示的可本地化标题；内置扩展应传入 `defineMessage(...)` 描述符。
- `params` 是功能自有的瞬时导航状态；Service 会浅复制并冻结它。
- `revision` 每次 `open()` 都会变化，因此同一 kind 可以响应新的分类或选中项。
- `close()` 恢复默认对话；核心侧栏切回“工作区”、会话 URL 变化或定义被撤销时也会关闭当前 Main View。
- `breadcrumbs` 中的每个父级条目都必须通过 `params` 跳转到同一 Main View 的其他状态，或通过 `closeView: true` 返回 Shell 层级；两者不能同时设置，当前页也不能设置跳转目标。
- Main View 拥有页面内部布局和文案，但不应复制 Workbench Shell、侧栏或右侧 Inspector。
- Main View 不提供 URL、持久化标签、resourceKey 或 keep-alive；这些需求分别使用 Next.js 路由或 Workspace Surface。

## 7. Workspace Surface 开发参考

右侧 Inspector 核心不内置业务 kind。扩展通过 `context.workspace.register()` 同步注册完整能力：

```ts
const contribution = context.workspace.register({
  kind: "example",
  icon: ExampleIcon,
  cachePolicy: "keep-alive",
  getResourceKey: (params, workspace) => `example:${workspace.projectId}:${params.id}`,
  getDefaultScope: (_params, workspace) => ({
    type: workspace.projectId ? "project" : "application",
    key: workspace.projectId ?? workspace.applicationId,
  }),
  render: ExampleSurface,
  menuItem: ExampleMenuItem,
  runtime: ExampleRuntimeBridge,
});
```

- `kind`：全局唯一的稳定能力 ID，核心将它视为不透明字符串；
- `icon`：由核心标签 Host 渲染；
- `getResourceKey`：定义同一资源的去重规则；
- `getDefaultScope`：决定实例跟随 thread、worktree、project 还是 application；
- `render`：扩展拥有的 Surface 组件；需要代码分包时使用 `createLazyWorkspaceSurface()`，核心提供统一 Suspense fallback 和可重新执行 loader 的错误重试；
- `menuItem`：可选，挂载到核心加号菜单；
- `runtime`：可选，在 AssistantRuntimeProvider 内挂载一次，用于监听 Agent 状态并打开或刷新该能力。

扩展同时拥有对应的领域 Service 和 `extensions.*` 文案。不要把功能分支、图标映射、Service 或工具名判断写回 `packages/workbench/shell/src/right-workspace/`。扩展停用时定义会被撤销，但核心保留已持久化的标签实例；重新启用同一 kind 后可以恢复渲染。

`open()`、`reveal()` 和 `update()` 中的 `title`、`statusMessage` 接受 `LocalizableText`。内置产品文案必须传入 `defineMessage(...)` 描述符，由 Host 在渲染时按当前 locale 解析；文件名、URL、用户或资源提供的标题保持 literal string。`defineMessage()` 是应用 catalog 唯一的公开描述符构造器，会同时校验包含 namespace 的组合键与参数；raw object literal 不能满足 SDK 的 opaque descriptor 类型。运行时仍使用 plain JSON `{ key }` / `{ key, values }` 形状，因此两种形态都可序列化，旧快照中的字符串会继续兼容恢复。异步失败应通过 `useExtensionErrorReporter()` 保存原始诊断，并只把稳定、面向用户的消息描述符写入 `statusMessage`，不得直接显示 `Error.message`。

当前通用参考实现位于 `packages/workbench/shell/src/extensions/builtin/`；Pi/Runtime 专属参考实现位于
`packages/agent-runtime/runtimes/pi/contributions/src/extensions/`。

### 跨 Contribution 打开资源：Opener

资源消费者只提交协议化标识；资源所有者在 `setup()` 中注册 handler：

```ts
const opener = context.openers.register({
  id: "workspace.file",
  canOpen: ({ resource }) => (resource.scheme === "file" ? 100 : 0),
  open: ({ resource, context, scope, policy }, { surfaces }) =>
    surfaces.reveal({
      kind: "file",
      title: resource.label ?? resource.path,
      params: { absolutePath: resource.path },
      context,
      ...(scope ? { scope } : {}),
      policy,
    }),
});
```

消费组件通过 `useOpenerService()` 打开，不知道最终 surface kind 或 React component：

```ts
await openers.open({
  resource: { scheme: "file", path, label: fileName },
  context: workspaceContext,
  scope: currentSurface.scope,
});
```

`canOpen()` 返回零表示不支持；最高正分 handler 获得请求，同分保持注册顺序。事件处理器必须处理
`open()` 的 Promise rejection。跨多个 feature 的能力接口应提升到 owner package 的公共 service 或 runtime，不能
放进某个 feature 的 `internal` 后再让其他 contribution 深层导入。

## 8. Panel 开发参考

Panel 定义：

```ts
context.panels.register({
  id: "preview",
  title: defineMessage("extensions.preview.title"),
  icon: EyeIcon,
  component: PreviewPanel,
  defaultLocation: "left",
  defaultSize: 420,
  minSize: 280,
  maxSize: 720,
});
```

需要由扩展动态控制标签标题和图标时，注册一个标签组件。它可以使用 React hooks 读取扩展自己的状态，例如浏览器当前页面标题和 favicon：

```tsx
"use client";

import type { PanelTabComponentProps } from "@workbench/extension-sdk";

export function BrowserTab({ isActive }: PanelTabComponentProps) {
  const { faviconUrl, pageTitle } = useBrowserStore();

  return (
    <>
      <img src={faviconUrl} alt="" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">
        {pageTitle || (isActive ? "浏览器" : "新标签页")}
      </span>
    </>
  );
}
```

```ts
context.panels.register({
  id: "browser",
  tabComponent: BrowserTab,
  tabClassNames: {
    root: ({ isActive }) =>
      isActive ? "max-w-64 rounded-lg bg-sky-500/10" : "max-w-48 rounded-lg",
    trigger: "px-2",
    closeButton: "hover:bg-sky-500/15",
  },
  component: BrowserPanel,
  defaultLocation: "left",
});
```

规则：

- Panel id 全局唯一；
- `title` 与 `tabComponent` 至少提供一个；
- 有 `tabComponent` 时，它控制可见的标题和图标，静态 `title/icon` 只作为回退；
- `tabClassNames.root/trigger/closeButton` 会在宿主默认样式之后通过 `cn()` 合并，因此扩展可以覆盖标签外框、选择按钮和关闭按钮样式；
- `tabClassNames` 的值可以是字符串，也可以是接收 `{ panelId, isActive }` 的纯函数；函数不能调用 React hooks；
- 标签根节点提供 `data-panel-id` 和 `data-state="active|inactive"`，可用于更复杂的变体选择器；
- 标签组件可以使用 React hooks，但 `setup()` 不可以；动态状态应放在扩展自己的共享 store/context 中；
- 标签外围按钮、激活和点击行为属于宿主，标签组件内部不要再渲染按钮或链接；
- 单个标签的关闭按钮属于宿主；关闭当前标签后会激活最近打开的剩余标签；
- `minSize` 不能大于 `maxSize`；
- 同一位置当前只显示一个 active Panel；
- Panel 内容由 Error Boundary 隔离；
- 尺寸服务会根据 active Panel 的 `minSize/maxSize` 做限制；
- 尺寸当前按 location 保存，而不是按 Panel 保存，刷新后也不会持久化；
- 组件只渲染内容，不要重复实现宿主标题栏；
- 完整工作区优先使用 Panel，不要把大型 UI 塞入 Slot。

当前 Shell 只使用 Panel 系统承载左侧与底部通用辅助区域。全高右侧检查区由 `RightWorkspace` 核心管理标签、resourceKey 去重、cachePolicy、作用域恢复和持久化，具体能力由 Workspace Surface 扩展注册；详见 [`docs/right-workspace.md`](./right-workspace.md)。

React 组件内使用 `usePanelService()`；Command 内使用 `context.panels`。两者用途不同：前者暴露完整 PanelService，后者只暴露命令执行所需的 `open/close/toggle/move`。

## 9. Command 开发参考

### Composer Command：结构化输入命令

`context.composerCommands` 与命令面板使用的 `context.commands` 是两套有意分开的协议。前者注册
Composer Entity 及提交期编译策略；后者执行全局 UI 动作。不要根据 Pi 命令名称猜测
`behavior`，只有显式注册了 companion definition 的命令才会进入结构化编译。

```ts
const review = context.composerCommands.register({
  id: "review",
  label: defineMessage("extensions.review.composerLabel"),
  description: defineMessage("extensions.review.composerDescription"),
  icon: ScanSearchIcon,
  composer: {
    behavior: "modifier",
    effect: "request-config",
    exclusive: false,
    group: "task-kind",
    scope: "message",
    argsSchema: {
      type: "object",
      properties: {
        focus: { type: "string" },
      },
    },
    apply(request) {
      request.metadata.review = true;
    },
  },
});
```

`behavior` 支持：

- `modifier`：修改本次请求；同一 id 幂等，`group` 相同的命令以后者为准。
- `context`：向 `request.context` 累加上下文。
- `transform`：按文档顺序转换 `request.text`。
- `immediate`：选中时调用 `apply()`，不保留到提交文档。

`effect` 描述进入 Agent Input Compiler 后的语义：`session-action`、`request-config`、
`instruction`、`context-provider`、`prompt-transform` 或 `agent-turn`。它与编辑器层的
`behavior` 分开，避免把“如何编辑 draft”和“是否启动 Agent turn”混成一个枚举。`exclusive: true`
表示该 Token 必须单独提交；lifecycle action 和拥有独立 turn 的命令应使用它。

`scope` 默认为 `message`。`segment` 会保留在节点中供扩展解释，但平台不会自行猜测文本范围。
`argsSchema` 是 JSON-Schema-compatible 数据，不是跨边界执行的 validator callback。

需要给带参命令指定主要的自由文本字段时，可以声明 `argsBinding`：

```ts
composer: {
  behavior: "transform",
  effect: "session-action",
  exclusive: true,
  scope: "message",
  argsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      customInstructions: { type: "string" },
    },
  },
  argsBinding: {
    kind: "message-text",
    field: "customInstructions",
    consumeText: true,
  },
  apply() {},
}
```

第一版只支持 `message-text`，并要求 `exclusive: true`、message scope 和 `argsSchema`。选择命令后，
Composer 会在输入框上方打开由 `argsSchema.properties` 生成的结构化参数面板；`argsBinding.field`
使用多行自由文本控件。关闭面板只会收起它，点击蓝色命令 Token 可以重新编辑；删除 Token 才会清理
对应参数。参数不会占用普通输入区，Token 后继续输入的内容始终是普通消息文字。提交时面板值直接写入
`command.args`，空参数也会以显式 `{}` 编译，避免把普通消息误判为旧版参数。

`argsBinding.consumeText` 只保留给旧客户端的 message-text fallback；新 Composer 不再把原始文本范围
当作参数。历史 canonical document 中已有的 `command-argument` 节点仍可显示和执行。

Pi 包源码保持只读。`command.list` 负责发现动态 Pi command，并可为 Workbench 已适配的内置命令
返回声明式 `argsSchema/argsBinding`；同一 `id` 的 companion definition 只补充 Workbench 编译
语义，不会替代 Pi 原命令 handler。没有 companion definition 的 Pi Token 也保持结构化实体，
可以和其他 Token、普通文本混排。

提交时 Workbench 先在客户端按文档顺序应用 companion definition，再把 canonical document 交给
session 服务。服务端 preflight resolve 所有 Pi `invocationName` 后才允许副作用发生。Skill 读取为
trusted instruction，Prompt Template 确定性转换 user text，二者只参与一次主模型调用；extension
command 明确作为独占 `agent-turn` 走 Pi 的公开 handler 入口，不再执行后再追加第二个主请求；
`compact/reload` 是独占 `session-action`。当成功的 session action 后仍有普通消息文字时，Workbench
按状态机先完成 action，再启动唯一一次主 Agent turn；action 失败时保留错误响应且不执行后续文字。
单值 group 以后者为准，多值 context 累加。

服务端先形成结构化 `ResolvedAgentRequest`，command trace 只用于历史和诊断，不直接注入模型。
真正给 Pi 的字符串只在最终 adapter 边界生成，并明确分隔 trusted instruction、untrusted context
和 user request。没有正文、instruction、context 或图片的纯 action 输入不会启动空的主 Agent turn。

ComposerDocument 是持久化的 canonical UI 表示；`sourceText` 只作为编辑器 serialization 和旧历史
fallback。历史恢复时它仍是一条标准 user message，因此使用与普通用户消息相同的气泡；真正发给
Pi 的 adapter prompt 不会再显示成第二条用户消息。

注册后，Command 会自动：

- 出现在 `Mod+K` 命令面板；
- 按 `category` 分组；
- 响应声明的全局快捷键；
- 通过统一的 CommandService 执行；
- 把异常交给 Extension 错误处理器。

组件需要主动执行命令时：

```tsx
"use client";

import { useCommandService } from "@workbench/extension-host";

export function RunNotesCommandButton() {
  const commands = useCommandService();

  return (
    <button
      type="button"
      onClick={() => {
        void commands.execute("notes.toggle").catch((error) => {
          console.error(error);
        });
      }}
    >
      Toggle notes
    </button>
  );
}
```

优先让 Slot 按钮和快捷键调用同一个 Command，避免分别实现两套业务逻辑。若按钮只做简单的 Panel toggle，也可以直接使用 `usePanelService()`。

## 10. Settings 开发参考

共享悬浮设置面板由 `workbench.settings` 扩展提供。它通过 `shell.overlay` 全局挂载，不属于左、右或底部 Panel。设置分区与设置项是独立贡献：壳扩展注册分区，功能扩展把自己的设置项注册到目标分区，因此语言、主题或模型功能可以随扩展一起启用和卸载。

```ts
const section = context.settings.registerSection({
  id: "general",
  title: defineMessage("extensions.settings.general.title"),
  group: {
    id: "basics",
    title: defineMessage("extensions.settings.groups.basics"),
  },
  order: 0,
});

const item = context.settings.registerItem({
  sectionId: "general",
  id: "language",
  component: LocaleSettingsItem,
  order: 10,
});
```

- section id 全局唯一；item id 在同一 section 内唯一；
- `title` 与 `description` 支持 `defineMessage(...)`，语言切换时由 Host 重新解析；
- section 可通过带稳定 `id` 和本地化 `title` 的 `group` 归入同一个导航分组；
- section 与 item 都按 `order` 升序排列，相同 order 保持注册顺序；
- item 可以先于 section 注册，目标 section 出现后会自动渲染，避免静态扩展顺序形成隐式依赖；
- `SettingsItemComponentProps` 提供稳定的 `sectionId` 和 `itemId`；设置值的状态与持久化仍由所属功能负责；
- Host 拥有导航、分区标题、滚动、分隔线和错误边界，设置项只渲染自己的行或业务表面。

React 组件可通过 `useSettingsRegistry()` 读取稳定快照并订阅注册变化。普通业务扩展应在 `setup()` 中注册贡献，不要在 React render 期间调用 registry。

## 11. Renderer 开发参考

Renderer 只负责展示 Workbench Conversation Node/Message Block，不负责：

- 把工具定义暴露给模型；
- 执行后端工具；
- 让 Runtime 自动产生某个 Data Block。

这些工作属于 Agent Runtime 或后端协议。Tool/Data Renderer 只有在消息中实际出现匹配的 `toolName` 或 `data.name` 时才会生效。

### Message Renderer：整体呈现与分组

Message Renderer 接收完整的 `UserMessageNode` 或 `AssistantMessageNode`，并接管其中的
`blocks`。它可以决定：

- reasoning、tool、data 是否分组以及如何嵌套；
- reasoning block、tool group、正文流式状态和 fallback 的视觉样式；
- 在叶子 `tool-call` / `data` Block 上是否继续交给 `RendererHost` 做精确名称匹配。

```tsx
"use client";

import type { MessageRendererProps } from "@workbench/extension-sdk";
import { RendererHost } from "@workbench/extension-host/hosts/renderer-host";

export function CompactMessageRenderer({ node }: MessageRendererProps) {
  return node.blocks.map((block) => {
    const fallback =
      block.kind === "text" || block.kind === "reasoning" ? <p>{block.text}</p> : null;
    return <RendererHost key={block.key} node={node} block={block} fallback={fallback} />;
  });
}
```

在扩展中注册：

```ts
const messageRenderer = context.renderers.message.register({
  id: "workbench.compact-message",
  component: CompactMessageRenderer,
});
```

同一时间只能启用一个 Message Renderer；重复注册会在 setup 阶段失败并回滚该扩展。
卸载它后，Workbench 会恢复最小安全 fallback。Block/Tool/Data Renderer 是可叠加的叶子贡献，
通常由提供对应能力的扩展注册，例如 Terminal 扩展同时注册 Workspace Surface、Command 和 `bash`
Tool Renderer。这样卸载能力扩展时，其入口和工具呈现会一起消失。

### Block Renderer：按消息 Block 谓词扩展

当能力无法用 `toolName` 或 `data.name` 表达，但又不应接管整条消息时，使用
`context.renderers.blocks` 注册叶子 renderer。Host 会在精确 Tool/Data 匹配前按注册顺序执行谓词，
并把调用方原有展示作为 `fallback` 传给命中的组件：

```tsx
return <RendererHost node={node} block={block} fallback={fallback} />;
```

扩展注册贡献：

```ts
const structuredTextRenderer = context.renderers.blocks.register({
  id: "workbench.structured-text.renderer",
  canRender: (block) => block.kind === "text" && isStructuredText(block.text),
  component: StructuredTextRenderer,
});
```

`canRender` 在 React render 期间运行，必须是纯函数并容忍 streaming 中的不完整 Block。多个贡献
同时命中时，注册顺序靠前者优先；贡献 id 必须唯一。停用扩展会注销贡献，Host 随即恢复调用方
提供的 fallback。

### Tool Renderer

```tsx
"use client";

import type { ToolRendererComponent } from "@workbench/extension-sdk";

export const WeatherRenderer: ToolRendererComponent = ({ block, fallback }) => {
  const args =
    block.arguments && typeof block.arguments === "object" && !Array.isArray(block.arguments)
      ? block.arguments
      : {};

  if (block.status === "running") {
    return (
      <div className="rounded-lg border p-3 text-sm">
        Reading weather arguments: {block.argumentsText || "…"}
      </div>
    );
  }

  if (block.status !== "complete") return fallback;

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p>{typeof args.city === "string" ? args.city : "Unknown city"}</p>
      <pre>{JSON.stringify(block.result, null, 2)}</pre>
    </div>
  );
};
```

注册：

```ts
const weatherRenderer = context.renderers.tools.register("get_weather", WeatherRenderer);
```

注意：`block.arguments` 在 streaming 阶段只是尽力解析的部分结果，甚至可能为 `undefined`；
`block.argumentsText` 保留原始增量文本。Renderer 必须处理 `running`、`complete`、`incomplete`、
`requires-action` 和 `error`。执行、审批或恢复动作应调用所属 Runtime capability，不属于 Renderer
展示契约。

### Data Renderer

```tsx
"use client";

import type { DataRendererComponent } from "@workbench/extension-sdk";

export const CitationRenderer: DataRendererComponent = ({ block, fallback }) => {
  const data =
    block.data && typeof block.data === "object" && !Array.isArray(block.data)
      ? block.data
      : undefined;
  return typeof data?.label === "string" ? <span>{data.label}</span> : fallback;
};
```

注册：

```ts
const citationRenderer = context.renderers.data.register("citation", CitationRenderer);
```

### Renderer 匹配与优先顺序

Message Renderer 全局唯一；Block Renderer 按贡献 id 唯一并按注册顺序匹配；Tool 和 Data Renderer
各自按名称唯一。这些 Registry 都没有 `order` 或 `priority` 字段。

`RendererHost` 的解析顺序固定为：

1. 第一个命中的 Block Renderer；
2. `toolName` 或 `data.name` 精确匹配的 Renderer；
3. 当前 Message Renderer（或 Workbench 安全 fallback）传入的 `fallback`。

同一个 tool name 或 data name 重复注册会在开发阶段报错。名称来自模型或协议，必须使用精确匹配，不要依赖对象原型键或模糊匹配。
匹配区分大小写：`get_weather` 与 `Get_Weather` 是两个不同名称。

## 12. 生命周期与错误隔离

扩展由 [`ExtensionProvider`](../packages/extension-platform/host/src/extension-provider.tsx) 激活：

- `setup()` 成功后扩展进入 active 状态；
- setup 中途失败时，已经注册的贡献会回滚；
- Provider 卸载或扩展被替换时，Disposable 会清理；
- Slot、Panel、Main View、Renderer 组件分别由 Error Boundary 隔离；
- Command 的异步异常由 CommandPaletteHost 捕获并上报。

React Error Boundary 不会捕获事件处理器和任意异步回调中的异常。组件直接调用 `useCommandService().execute()` 或自己的异步逻辑时，仍需显式处理 rejected Promise。

如果扩展自己添加浏览器监听器，应返回清理对象：

```ts
import { createDisposable, defineExtension } from "@workbench/extension-sdk";

export const resizeObserverExtension = defineExtension({
  id: "workbench.resize-observer",
  name: "Resize Observer",
  version: "1.0.0",

  setup() {
    const handleResize = () => {
      // 更新扩展自己的状态。
    };

    window.addEventListener("resize", handleResize);
    return createDisposable(() => {
      window.removeEventListener("resize", handleResize);
    });
  },
});
```

但要注意：`setup()` 在 Provider 的 client effect 中运行。尽管此时可以访问 `window`，更推荐把 React 相关副作用放入扩展组件自己的 `useEffect()`，让生命周期更直观。

## 13. 状态应该放在哪里

使用 Workbench Agent Runtime 保存：

- messages；
- thread、composer；
- streaming/running 状态；
- attachments；
- edit、reload、branch 等聊天行为。

扩展自己的 Store 保存：

- 表单草稿；
- 扩展设置；
- 本地缓存；
- 只属于扩展的 UI 状态。

Workbench Store 保存：

- Panel 打开状态、位置、尺寸；
- 宿主级 UI 偏好。

不要再创建一份 `messages` 或 `isRunning` 与 Agent Runtime 双向同步。消息 Renderer 直接使用
Host 传入的 `node`；位于 `SessionProvider` 内的会话组件使用 headless hooks：

```tsx
const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
const isRunning = useSessionState((snapshot) => snapshot.isRunning);
const node = useConversationNode(nodeKeys.at(-1) ?? "");
```

## 14. ID 与注册规则

推荐命名：

```text
extension id:          workbench.notes
slot contribution id: workbench.notes.composer
panel id:              notes
command id:            notes.toggle
open handler id:       workspace.file
message renderer id:   workbench.compact-message
block renderer id:     workbench.structured-text.renderer
tool renderer name:    get_weather
data renderer name:    citation
```

唯一性范围：

- Extension id：整个 ExtensionManager；
- Slot contribution id：同一个 Slot 内；
- Panel id：整个 PanelRegistry；
- Command id：整个 CommandRegistry；
- Open handler id：整个 OpenerRegistry；
- Message renderer：整个 Message RendererRegistry 同时只能有一个；
- Block renderer id：整个 MessageBlockRendererRegistry；
- Tool renderer name：Tool RendererRegistry；
- Data renderer name：Data RendererRegistry。
- Settings section id：整个 SettingsRegistry；
- Settings item id：同一个 settings section 内。

Slot、Panel、Command 定义在注册时会被复制并浅冻结。注册后不要修改原对象来尝试更新 UI；需要替换贡献时，应 dispose 后重新注册。

## 15. 不要做的事情

- 不要从远程 URL `import()` 任意 JavaScript 插件。
- 不要在扩展中注册 Next.js 路由。
- 不要从业务扩展 import Registry 或 Host 的内部实现。
- 不要从一个 `<owner-package>/src/extensions/builtin/<feature>` 深层 import 另一个 feature；通过公开 Registry、Service 或 Renderer 协作。
- 不要在 React render 期间调用 `register()`。
- 不要在 `setup()` 中调用 React Hook；`setup()` 不是组件。
- 不要把 ReactNode 作为 Slot 注册值；应注册组件类型。
- 不要让两个扩展争用同一个 Panel、Command 或 Renderer id。
- 不要假设 streaming Tool args 已经完整。
- 不要把大型工作区塞进 Header 或 Composer Slot。
- 不要复制 Workbench Agent Runtime 的消息和 Composer 状态。
- 不要在前端扩展中放 API Key 或其他秘密。

## 16. 可参考的现有扩展

- 最小 Slot：[`connection-status`](../packages/agent-runtime/runtimes/pi/contributions/src/extensions/connection-status/extension.ts)
- Model 选择与当前 Session bridge：[`model-selector`](../packages/agent-runtime/runtimes/pi/contributions/src/extensions/model-selector/extension.ts)
- Settings + Pi RPC：[`skills`](../packages/agent-runtime/runtimes/pi/contributions/src/extensions/skills/extension.ts)
- Workspace Surface + Open Handler：[`workspace-file`](../packages/agent-runtime/runtimes/pi/contributions/src/extensions/workspace-file/extension.ts)
- Workspace Surface + Command + Tool Renderer：[`terminal`](../packages/agent-runtime/runtimes/pi/contributions/src/extensions/terminal/extension.ts)
- Sidebar/Header Slot + floating Settings：[`settings`](../packages/workbench/shell/src/extensions/builtin/settings/extension.ts)
- Message 分组、reasoning 与 Tool/Data fallback：[`message-presentation`](../packages/workbench/shell/src/extensions/builtin/message-presentation/extension.ts)
- Runtime 状态派生：[`token-usage`](../packages/agent-runtime/runtimes/pi/contributions/src/extensions/token-usage/extension.ts)

如果新需求无法自然归入 Slot、Panel、Command、Renderer 或 Settings，先判断它是不是：

1. Next.js 路由职责；
2. Workbench Agent Runtime/Tool 职责；
3. 后端或持久化职责；
4. 真正需要新增的 Workbench 宿主能力。

只有第 4 类才应该扩展平台 API。
