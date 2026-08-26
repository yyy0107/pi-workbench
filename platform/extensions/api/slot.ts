import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

/**
 * Workbench Host 当前声明的全部插槽名称。
 *
 * 名称是稳定、不可本地化的布局协议。业务扩展只能注册这里已有的 Slot；新增名称必须同时修改
 * `SlotPropsMap` 并在 `workbench/` 中挂载对应 `SlotHost`。数组顺序不决定渲染顺序，单个 Slot
 * 内的贡献顺序由 `SlotContribution.order` 和注册先后决定。
 */
export const WORKBENCH_SLOTS = [
  "header.left", // 顶部栏左侧：Logo、返回按钮、侧边栏开关等
  "header.center", // 顶部栏中间：当前会话标题、工作区标题等
  "header.right", // 顶部栏右侧：全局操作、设置、用户菜单等
  "shell.background", // 全局背景层：主题背景、纹理、渐变等非交互视觉内容
  "shell.overlay", // 全局悬浮层：对话框、浮动面板等跨布局表面

  "sidebar.brand", // 侧边栏品牌区域：Logo、产品名称等
  "sidebar.header", // 侧边栏头部：标题、折叠按钮等
  "sidebar.navigation", // 侧边栏分段切换器下方：可选主导航、页面入口等
  "sidebar.toolbox", // 工具箱分段主体：能力入口、分类列表与管理操作
  "sidebar.workspace.actions", // 工作区操作行右侧：新建工作区、筛选等紧凑操作
  "sidebar.top", // 工作区内容顶部：会话列表之前的主要操作
  "sidebar.bottom", // 侧边栏主体底部扩展区域
  "sidebar.footer", // 侧边栏页脚：设置、账户、版本信息等

  "panel.right.add-menu", // 右侧面板添加菜单：新增面板/工具入口
  "panel.right.actions", // 右侧面板操作区：关闭、固定、切换等

  "workspace.actions", // Inspector Workspace 工具栏：终端等外部资源入口
  "workspace.empty.actions", // Inspector Workspace 空状态：终端等可启动能力入口

  "thread.left", // 会话区域左侧：会话级导航、上下文工具等
  "thread.header", // 会话区域头部：会话信息、模型状态、会话操作等
  "thread.before", // 消息列表之前：提示、上下文信息、全局状态等
  "thread.after", // 消息列表之后：会话级附加内容
  "thread.right", // 会话区域右侧：会话级信息、辅助工具等

  "message.before", // 单条消息内容之前：状态、来源、角色信息等
  "message.after", // 单条消息内容之后：补充信息、引用、反馈等
  "message.actions", // 单条消息操作区：复制、重试、编辑、点赞等

  "composer.overlay", // 输入框覆盖层：需要暂时接管 Composer 的交互式请求等
  "composer.before", // 输入框之前：上下文提示、附件预览、状态提示等
  "composer.actions.left", // 输入框左侧操作：附件、@、/ 命令、工具等
  "composer.actions.right", // 输入框右侧操作：模型选择、语音、发送等
  "composer.drawer.left", // Composer 左侧抽屉：附件、工具、Skill 等扩展面板
  "composer.drawer.right", // Composer 右侧抽屉：模型、参数、上下文等扩展面板
  "composer.after", // 输入框之后：免责声明、快捷提示、Token 信息等

  "statusbar.left", // 底部状态栏左侧：连接状态、Agent 状态、分支等
  "statusbar.right", // 底部状态栏右侧：Token、上下文、模型、延迟等
] as const;

/** `WORKBENCH_SLOTS` 推导出的 Slot 名称联合类型。 */
export type WorkbenchSlot = (typeof WORKBENCH_SLOTS)[number];

/**
 * `message.*` Slot 在单条消息范围内收到的上下文。
 *
 * 这些值直接来自 assistant-ui 当前 Message scope；扩展不应复制到独立 Store。
 */
export interface MessageSlotContext {
  /** 当前消息的稳定 Runtime id。 */
  messageId: string;
  /** 当前消息角色。消息正文和模型输出本身不应被扩展翻译。 */
  role: "user" | "assistant" | "system";
  /** 当前消息是否为当前可见 Thread 分支中的最后一条消息。 */
  isLast: boolean;
}

/** `composer.*` Slot 可读取的当前输入与生成状态。 */
export interface ComposerSlotContext {
  /** 当前 Thread 是否正在生成；可用于禁用会与运行冲突的操作。 */
  isRunning: boolean;
  /** 当前 Composer 是否没有文本、附件或其他可发送内容。 */
  isEmpty: boolean;
}

/** `composer.overlay` Slot 用于接管 Composer 时收到的上下文。 */
export interface ComposerOverlaySlotContext extends ComposerSlotContext {
  /**
   * 报告当前贡献是否正在覆盖 Composer。
   *
   * 贡献应在 layout effect 中报告 `true`，并在 cleanup 中报告 `false`。宿主会在至少一个贡献
   * 可见时将底层 Composer 设为 inert，避免指针或键盘焦点穿透覆盖层。
   */
  setOverlayVisible(visible: boolean): void;
}

/**
 * Composer 抽屉 Slot 的上下文。
 *
 * 抽屉贡献完成选择或导航后应调用 `closeDrawer()`，不要直接依赖抽屉内部 Store。
 */
export interface ComposerDrawerSlotContext extends ComposerSlotContext {
  /** 关闭当前 Composer 扩展抽屉。 */
  closeDrawer(): void;
}

/** 工具箱主体贡献收到的宿主搜索状态。 */
export interface SidebarToolboxSlotContext {
  /** 顶部搜索框的当前原始输入；筛选语义由工具箱扩展负责。 */
  searchQuery: string;
}

/**
 * 右侧 Panel 标签行“添加”菜单中的贡献上下文。
 *
 * 贡献应渲染一个 `role="menuitem"` 控件，打开或激活自己的 Panel 后调用 `closeMenu()`。
 */
export interface RightPanelAddMenuSlotContext {
  /** 当前右侧位置激活的 Panel id；用于展示选中/当前状态。 */
  activePanelId: string;
  /** 关闭 Workbench 拥有的添加菜单 popover。 */
  closeMenu(): void;
}

/** 右侧 Panel 标签行尾部操作区的上下文。 */
export interface RightPanelActionsSlotContext {
  /** 当前右侧位置激活的 Panel id；贡献可据此决定是否显示或启用操作。 */
  activePanelId: string;
}

/** Inspector Workspace 工具栏贡献收到的只读布局上下文。 */
export interface WorkspaceActionsSlotContext {
  /** 当前激活的 Surface id；空工作区时不存在。 */
  activeSurfaceId?: string;
  /** Inspector Workspace 当前是否展开。 */
  isOpen: boolean;
}

/** Inspector Workspace 空状态启动列表贡献收到的只读布局上下文。 */
export interface WorkspaceEmptyActionsSlotContext {
  /** Inspector Workspace 当前是否展开。 */
  isOpen: boolean;
}

/**
 * Slot 名称到组件 props 的唯一类型映射。
 *
 * `SlotHost` 根据名称将对应 context 传给贡献组件。无上下文 Slot 使用
 * `Record<never, never>`，而不是允许任意 props。扩展应从该映射导出的具体 context 类型读取
 * 宿主状态，不要假设未声明字段存在。
 */
export interface SlotPropsMap {
  "header.left": Record<never, never>; // 顶栏左侧区域
  "header.center": Record<never, never>; // 顶栏居中区域
  "header.right": Record<never, never>; // 顶栏右侧区域
  "shell.background": Record<never, never>; // Workbench 最底层的全局背景
  "shell.overlay": Record<never, never>; // 全局悬浮层
  "sidebar.brand": Record<never, never>; // 侧边栏顶部品牌标识
  "sidebar.header": Record<never, never>; // 侧边栏品牌下方的头部控件
  "sidebar.navigation": Record<never, never>; // 核心分段切换器下方的可选主导航
  "sidebar.toolbox": SidebarToolboxSlotContext; // 工具箱分段的完整主体
  "sidebar.workspace.actions": Record<never, never>; // 工作区主要操作行右侧的紧凑操作区
  "sidebar.top": Record<never, never>; // 工作区会话列表上方的主要操作，桌面和移动端均挂载
  "sidebar.bottom": Record<never, never>; // 会话列表下方的上下文区域
  "sidebar.footer": Record<never, never>; // 侧边栏固定底部工具区
  "panel.right.add-menu": RightPanelAddMenuSlotContext; // 右侧 Panel 加号弹出菜单
  "panel.right.actions": RightPanelActionsSlotContext; // 右侧 Panel 标签行尾部图标区
  "workspace.actions": WorkspaceActionsSlotContext; // Inspector Workspace 工具栏
  "workspace.empty.actions": WorkspaceEmptyActionsSlotContext; // Inspector Workspace 空状态启动入口
  "thread.left": { threadId?: string }; // 当前会话中央列左侧
  "thread.header": { threadId?: string }; // 当前会话顶部区域
  "thread.before": { threadId?: string }; // 当前会话消息列表之前
  "thread.after": { threadId?: string }; // 当前会话消息列表之后
  "thread.right": { threadId?: string }; // 当前会话中央列右侧
  "message.before": MessageSlotContext; // 单条消息内容之前
  "message.after": MessageSlotContext; // 单条消息内容之后
  "message.actions": MessageSlotContext; // 单条消息操作区域
  "composer.overlay": ComposerOverlaySlotContext; // 暂时接管输入框交互的覆盖层
  "composer.before": ComposerSlotContext; // 输入框区域之前
  "composer.actions.left": ComposerSlotContext; // 输入框操作栏左侧
  "composer.actions.right": ComposerSlotContext; // 输入框操作栏右侧
  "composer.drawer.left": ComposerDrawerSlotContext; // Composer 展开抽屉左侧
  "composer.drawer.right": ComposerDrawerSlotContext; // Composer 展开抽屉右侧
  "composer.after": ComposerSlotContext; // 输入框区域之后
  "statusbar.left": Record<never, never>; // 状态栏左侧区域
  "statusbar.right": Record<never, never>; // 状态栏右侧区域
}

/**
 * 注册到某一个 Workbench Slot 的 React 组件定义。
 *
 * 贡献对象在注册时被复制并浅冻结。`component` 必须是组件类型而不是 ReactNode；它在各自的
 * Error Boundary 内渲染，并接收 `SlotPropsMap[K]` 对应的 context。
 */
export interface SlotContribution<K extends WorkbenchSlot = WorkbenchSlot> {
  /** 在同一个 Slot 内唯一的非空稳定 id；不同 Slot 可以复用同一 id，但不建议这样命名。 */
  id: string;
  /** 由 SlotHost 实例化的组件类型。需要 Hook 或事件时，组件文件应声明 `"use client"`。 */
  component: ComponentType<SlotPropsMap[K]>;
  /**
   * 可选排序值，默认 `0`，数值越小越靠前。相同 order 保持注册顺序；只有 Slot 支持 order。
   */
  order?: number;
}

/**
 * 所有 SlotContribution 的可订阅注册表。
 *
 * 业务扩展应在同步 setup 中注册。Host 通过 `get()` 的稳定只读快照与 `subscribe()` 响应变化。
 */
export interface SlotRegistry {
  /**
   * 向指定 Slot 注册贡献并返回撤销注册的 Disposable。
   *
   * 未声明的 Slot、空 id 或同一 Slot 内重复 id 会同步抛错。省略 order 时按 `0` 保存。
   */
  register<K extends WorkbenchSlot>(slot: K, contribution: SlotContribution<K>): Disposable;
  /** 返回已按 order/注册顺序排序的稳定只读快照；无贡献时返回稳定空数组。 */
  get<K extends WorkbenchSlot>(slot: K): readonly SlotContribution<K>[];
  /** 订阅任意 Slot 的注册/注销变化并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}
