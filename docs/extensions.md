# Workbench 扩展组件开发指南

本文说明如何为 Pi Workbench 第一版开发扩展组件，并给出 Slot、Panel、Command、Renderer 四类扩展的完整示例。

让 AI 协助实现扩展时，可以显式调用项目技能 `$extend-workbench-ui`。技能位于 [`.agents/skills/extend-workbench-ui/`](../.agents/skills/extend-workbench-ui/SKILL.md)，会按本文的边界、流程和验证要求执行。

本文对应当前代码：

- Next.js 16 单应用；
- assistant-ui 0.15.x；
- 扩展随应用静态打包；
- 不支持从远程 URL 加载 JavaScript；
- 不支持由扩展动态注册 Next.js 路由。

扩展平台的公开入口是 [`platform/extensions/index.ts`](../platform/extensions/index.ts)。扩展应优先从 `@/platform/extensions` 导入类型、Hook 和注册 API，不要依赖 `registries/`、`hosts/` 等内部实现。

## 1. 先理解四种扩展能力

一个扩展由 `defineExtension()` 定义，并在 `setup(context)` 中注册一个或多个贡献：

```text
enabledExtensions
  -> ExtensionProvider
    -> extension.setup(context)
      -> Slot / Panel / Command / Renderer Registry
        -> 对应 Host 渲染或执行
```

四种贡献各自解决不同问题：

- **Slot**：把小型组件插入宿主已经声明的位置，例如 Composer 按钮或状态栏指标。
- **Panel**：提供独立工作区，例如 Skills、Terminal、文件预览器。
- **Command**：提供可复用动作，同时进入命令面板和快捷键系统。
- **Renderer**：按 tool name 或 data name 渲染 assistant-ui 消息 Part。

选择建议：

- 一个图标、按钮、状态值：使用 Slot。
- 需要滚动、表单或较大空间：使用 Panel。
- 同一动作需要被快捷键、命令面板或按钮复用：使用 Command。
- 需要展示模型工具调用或结构化数据：使用 Renderer。
- 需要一个新 URL：直接增加 Next.js 文件路由，不要放进扩展 API。

## 2. 扩展的最小结构

推荐每个扩展拥有独立目录：

```text
extensions/builtin/notes/
├── extension.ts
├── notes-panel.tsx
├── notes-trigger.tsx
├── toggle-notes-command.ts
└── index.ts
```

最小扩展只有一个 `extension.ts`：

```ts
import { defineExtension } from "@/platform/extensions";

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

通过 `context.slots/panels/commands/renderers.register()` 创建的 Disposable 会被 Manager 追踪。仍建议显式返回它们；额外创建的事件监听、计时器或订阅则必须包装成 Disposable 并返回。

`defineExtension()` 是保留字面量类型的 identity helper，真正的运行时校验和激活由 ExtensionManager 完成。扩展对象应定义在模块顶层并保持引用稳定；不要在 React render 中临时创建新的扩展对象或 `extensions` 数组，否则相同 id 也会因对象引用变化而先停用再激活。

## 3. 完整教程：Notes 扩展

下面实现一个 Notes 扩展，它包含：

- Composer 中的入口按钮；
- 右侧 Notes Panel；
- `Mod+Shift+N` 命令；
- 静态启用配置。

### 第一步：创建 Panel 组件

创建 `extensions/builtin/notes/notes-panel.tsx`：

```tsx
"use client";

import { useState } from "react";

import type { PanelComponentProps } from "@/platform/extensions";

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

创建 `extensions/builtin/notes/notes-trigger.tsx`：

```tsx
"use client";

import { StickyNoteIcon } from "lucide-react";

import { type ComposerSlotContext, usePanelService } from "@/platform/extensions";

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

创建 `extensions/builtin/notes/toggle-notes-command.ts`：

```ts
import { StickyNoteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@/platform/extensions";

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

创建 `extensions/builtin/notes/extension.ts`：

```ts
import { StickyNoteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

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
      defaultLocation: "right",
      defaultSize: 360,
      minSize: 280,
      maxSize: 640,
    });

    const command = context.commands.register(toggleNotesCommand);

    return [trigger, panel, command];
  },
});
```

再创建 `extensions/builtin/notes/index.ts`：

```ts
export { notesExtension } from "./extension";
```

`defaultLocation` 只能是：

- `left`；
- `right`；
- `bottom`。

`defaultSize`、`minSize` 和 `maxSize` 在当前 Workbench 中使用像素。

Panel Registry 只保存定义。打开状态、位置和尺寸由 Panel Store 管理，因此不要把 `isOpen` 放进 `PanelDefinition`。

### 第五步：静态启用扩展

修改 [`extensions/enabled-extensions.ts`](../extensions/enabled-extensions.ts)：

```ts
import type { WorkbenchExtension } from "@/platform/extensions";

import { notesExtension } from "./builtin/notes";
// 其他内置扩展 import...

export const enabledExtensions = [
  // 其他内置扩展...
  notesExtension,
] satisfies readonly WorkbenchExtension[];
```

完成后，ExtensionProvider 会在客户端激活它。不要增加目录扫描、运行时文件发现或远程 `import()`。

数组顺序就是激活顺序，也会影响相同 Slot `order` 时的先后、冲突快捷键的匹配顺序，以及 Command Palette 中同组命令的显示顺序。保持数组为模块级稳定常量。若需要让其他模块直接导入该扩展，可再从 `extensions/index.ts` 选择性导出。

### 第六步：验证

```bash
pnpm exec oxfmt --check extensions/builtin/notes
pnpm exec oxlint extensions/builtin/notes
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
- `sidebar.brand`、`sidebar.header`、`sidebar.navigation`、`sidebar.workspace.actions`、`sidebar.top`、`sidebar.bottom`、`sidebar.footer`；
- `statusbar.left`、`statusbar.right`。

右侧 Panel 标签行 Slot：

- `panel.right.add-menu`：加号弹出菜单中的选项，参数为 `{ activePanelId, closeMenu() }`；
- `panel.right.actions`：标签行最右侧的图标操作区，参数为 `{ activePanelId }`。

Thread Slot：

- `thread.left`、`thread.header`、`thread.before`、`thread.after`、`thread.right`；
- 参数为 `{ threadId?: string }`。

`thread.left` 与 `thread.right` 以全高形式挂载在对话中央列两侧，贡献组件需要自行定义宽度。需要宿主管理尺寸、标签页或开关状态的较大工作区应注册为 Panel。

Message Slot：

- `message.before`、`message.after`、`message.actions`；
- 参数为 `{ messageId, role, isLast }`。

Composer Slot：

- `composer.before`、`composer.actions.left`、`composer.actions.right`、`composer.after`；
- 参数为 `{ isRunning, isEmpty }`。
- `composer.drawer.left`、`composer.drawer.right` 位于加号展开的单行抽屉两侧；
- 参数为 `{ isRunning, isEmpty, closeDrawer() }`，适合工作区摘要、能力计数和紧凑入口。

完整类型定义见 [`platform/extensions/api/slot.ts`](../platform/extensions/api/slot.ts)。

`sidebar.brand` 位于侧栏顶部，用于可替换的产品标识；默认 `workbench-brand` 扩展在这里贡献 “Pi-Workbench”。`sidebar.navigation` 位于核心“新建会话”按钮之后，适合 Agent、工具箱、资产等可选主导航；`sidebar.workspace.actions` 位于“工作区”标题右侧，适合添加、搜索或筛选等紧凑操作；`sidebar.footer` 位于侧栏固定底部，适合设置或状态入口。核心“新建会话”和 Thread List 不由扩展替换。

当前移动端会话抽屉复用核心侧栏内容，但不挂载 `sidebar.*` Slot；Sidebar Slot 贡献目前只显示在桌面侧栏。需要移动端入口时，可像 Terminal 扩展一样额外注册 `header.right` 触发器。

`panel.right.add-menu` 的贡献应渲染单个 `role="menuitem"` 控件，通过 `usePanelService()` 打开自己的 Panel，随后调用 `closeMenu()`。`panel.right.actions` 适合刷新、全屏、布局切换等紧凑图标按钮，每个按钮必须提供 `aria-label`。加号、标签关闭和整栏收起按钮由 Workbench 宿主管理，不应在贡献中重复实现。

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
- Slot 组件位于 AssistantRuntimeProvider 内，可以使用 `useAui()` 和 `useAuiState()`。

### 如何增加一个新的宿主 Slot

普通扩展只能使用已有 Slot。如果确实要扩展宿主契约，需要同时修改两处：

1. 在 `WORKBENCH_SLOTS` 与 `SlotPropsMap` 中增加名称和参数类型；
2. 在 `workbench/` 对应位置挂载 `SlotHost` 并传入 Context。

示意：

```ts
// platform/extensions/api/slot.ts
export interface SlotPropsMap {
  // ...
  "thread.toolbar": { threadId?: string };
}
```

```tsx
// workbench/chat/...
<SlotHost name="thread.toolbar" context={{ threadId }} />
```

新增 Slot 是宿主 API 变更，应评估命名、布局、响应式和后续兼容性，不应由单个业务扩展随意添加。

## 5. Panel 开发参考

Panel 定义：

```ts
context.panels.register({
  id: "preview",
  title: defineMessage("extensions.preview.title"),
  icon: EyeIcon,
  component: PreviewPanel,
  defaultLocation: "right",
  defaultSize: 420,
  minSize: 280,
  maxSize: 720,
});
```

如果 Panel 需要出现在标签行的加号菜单中，由同一个扩展注册菜单项：

```tsx
"use client";

import { type RightPanelAddMenuSlotContext, usePanelService } from "@/platform/extensions";

export function BrowserAddMenuItem({ closeMenu }: RightPanelAddMenuSlotContext) {
  const panels = usePanelService();

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        panels.open("browser");
        closeMenu();
      }}
    >
      打开浏览器
    </button>
  );
}
```

```ts
context.slots.register("panel.right.add-menu", {
  id: "workbench.browser.right-panel-add-menu",
  order: 30,
  component: BrowserAddMenuItem,
});
```

需要由扩展动态控制标签标题和图标时，注册一个标签组件。它可以使用 React hooks 读取扩展自己的状态，例如浏览器当前页面标题和 favicon：

```tsx
"use client";

import type { PanelTabComponentProps } from "@/platform/extensions";

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
  defaultLocation: "right",
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

已打开且当前位置为 `right` 的 Panel 会成为全高右侧栏中的标签。静态标签使用 Panel 的 `title/icon`；需要动态标题或图标时使用 `tabComponent`。标签顺序按打开顺序排列。关闭按钮只关闭对应 Panel；收起右侧栏会保留所有已打开标签及当前激活项，重新展开后原样恢复。加号菜单选项来自 `panel.right.add-menu`，右侧图标操作来自 `panel.right.actions`。

React 组件内使用 `usePanelService()`；Command 内使用 `context.panels`。两者用途不同：前者暴露完整 PanelService，后者只暴露命令执行所需的 `open/close/toggle`。

## 6. Command 开发参考

注册后，Command 会自动：

- 出现在 `Mod+K` 命令面板；
- 按 `category` 分组；
- 响应声明的全局快捷键；
- 通过统一的 CommandService 执行；
- 把异常交给 Extension 错误处理器。

组件需要主动执行命令时：

```tsx
"use client";

import { useCommandService } from "@/platform/extensions";

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

优先让 Slot 按钮和快捷键调用同一个 Command，避免分别实现两套业务逻辑。若按钮只做简单的 Panel toggle，也可以像当前 Skills 扩展一样直接使用 `usePanelService()`。

## 7. Renderer 开发参考

Renderer 只负责展示消息 Part，不负责：

- 把工具定义暴露给模型；
- 执行后端工具；
- 让 Runtime 自动产生某个 data Part。

这些工作属于 assistant-ui Tool、Runtime 或后端协议。只有当消息中实际出现匹配的 `toolName` 或 `data.name` 时，Renderer 才会生效。

### Tool Renderer

```tsx
"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

interface WeatherArgs {
  city?: string;
}

interface WeatherResult {
  temperatureC: number;
  summary: string;
}

export const WeatherRenderer: ToolCallMessagePartComponent<WeatherArgs, WeatherResult> = ({
  args,
  argsText,
  result,
  status,
  isError,
}) => {
  if (status.type === "running") {
    return (
      <div className="rounded-lg border p-3 text-sm">
        Reading weather arguments: {argsText || "…"}
      </div>
    );
  }

  if (isError) {
    return <div className="text-destructive">Weather lookup failed.</div>;
  }

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p>{args.city ?? "Unknown city"}</p>
      {result ? (
        <p>
          {result.temperatureC}°C · {result.summary}
        </p>
      ) : (
        <p>No result returned.</p>
      )}
    </div>
  );
};
```

注册：

```ts
const weatherRenderer = context.renderers.tools.register("get_weather", WeatherRenderer);
```

注意：工具参数在 streaming 阶段只是部分解析结果，字段可能缺失。必须允许可选字段，并根据 `status`、`argsText` 或 `useToolArgsStatus()` 渲染中间状态。

Tool renderer props 还提供 `addResult()`、`resume()` 和 `respondToApproval()`，分别用于前端结果、人机交互恢复和工具审批。只有对应 Runtime 状态允许时才能调用。

### Data Renderer

```tsx
"use client";

import type { DataMessagePartComponent } from "@assistant-ui/react";

interface CitationData {
  label: string;
  url: string;
}

export const CitationRenderer: DataMessagePartComponent<CitationData> = ({ data }) => (
  <a href={data.url} target="_blank" rel="noopener noreferrer">
    {data.label}
  </a>
);
```

注册：

```ts
const citationRenderer = context.renderers.data.register("citation", CitationRenderer);
```

### Renderer 匹配与优先顺序

Tool 和 Data Renderer 各自按名称唯一注册，没有 `order` 或 `priority` 字段。

`RendererHost` 的解析顺序固定为：

1. 扩展 Registry 中精确名称匹配的 Renderer；
2. Part 自带的 `toolUI` 或 `dataRendererUI`；
3. Workbench 的 Tool/Data Fallback；
4. `RendererHost` 的 children。

同一个 tool name 或 data name 重复注册会在开发阶段报错。名称来自模型或协议，必须使用精确匹配，不要依赖对象原型键或模糊匹配。
匹配区分大小写：`get_weather` 与 `Get_Weather` 是两个不同名称。

## 8. 生命周期与错误隔离

扩展由 [`ExtensionProvider`](../platform/extensions/extension-provider.tsx) 激活：

- `setup()` 成功后扩展进入 active 状态；
- setup 中途失败时，已经注册的贡献会回滚；
- Provider 卸载或扩展被替换时，Disposable 会清理；
- Slot、Panel、Renderer 组件分别由 Error Boundary 隔离；
- Command 的异步异常由 CommandPaletteHost 捕获并上报。

React Error Boundary 不会捕获事件处理器和任意异步回调中的异常。组件直接调用 `useCommandService().execute()` 或自己的异步逻辑时，仍需显式处理 rejected Promise。

如果扩展自己添加浏览器监听器，应返回清理对象：

```ts
import { createDisposable, defineExtension } from "@/platform/extensions";

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

## 9. 状态应该放在哪里

使用 assistant-ui Runtime 保存：

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

不要再创建一份 `messages` 或 `isRunning` 并与 assistant-ui 双向同步。扩展组件已经位于 AssistantRuntimeProvider 内，应直接使用：

```tsx
const messages = useAuiState((state) => state.thread.messages);
const isRunning = useAuiState((state) => state.thread.isRunning);
```

## 10. ID 与注册规则

推荐命名：

```text
extension id:          workbench.notes
slot contribution id: workbench.notes.composer
panel id:              notes
command id:            notes.toggle
tool renderer name:    get_weather
data renderer name:    citation
```

唯一性范围：

- Extension id：整个 ExtensionManager；
- Slot contribution id：同一个 Slot 内；
- Panel id：整个 PanelRegistry；
- Command id：整个 CommandRegistry；
- Tool renderer name：Tool RendererRegistry；
- Data renderer name：Data RendererRegistry。

Slot、Panel、Command 定义在注册时会被复制并浅冻结。注册后不要修改原对象来尝试更新 UI；需要替换贡献时，应 dispose 后重新注册。

## 11. 不要做的事情

- 不要从远程 URL `import()` 任意 JavaScript 插件。
- 不要在扩展中注册 Next.js 路由。
- 不要从业务扩展 import Registry 或 Host 的内部实现。
- 不要在 React render 期间调用 `register()`。
- 不要在 `setup()` 中调用 React Hook；`setup()` 不是组件。
- 不要把 ReactNode 作为 Slot 注册值；应注册组件类型。
- 不要让两个扩展争用同一个 Panel、Command 或 Renderer id。
- 不要假设 streaming Tool args 已经完整。
- 不要把大型工作区塞进 Header 或 Composer Slot。
- 不要复制 assistant-ui 的消息和 Composer 状态。
- 不要在前端扩展中放 API Key 或其他秘密。

## 12. 可参考的现有扩展

- 最小 Slot：[`connection-status`](../extensions/builtin/connection-status/extension.ts)
- assistant-ui ModelContext：[`model-selector`](../extensions/builtin/model-selector/extension.ts)
- Slot + Panel：[`skills`](../extensions/builtin/skills/extension.ts)
- Panel + Command + 移动端 Slot：[`terminal`](../extensions/builtin/terminal/extension.ts)
- Runtime 状态派生：[`token-usage`](../extensions/builtin/token-usage/extension.ts)

如果新需求无法自然归入 Slot、Panel、Command 或 Renderer，先判断它是不是：

1. Next.js 路由职责；
2. assistant-ui Runtime/Tool 职责；
3. 后端或持久化职责；
4. 真正需要新增的 Workbench 宿主能力。

只有第 4 类才应该扩展平台 API。
