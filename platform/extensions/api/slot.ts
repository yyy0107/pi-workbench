import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

export const WORKBENCH_SLOTS = [
  "header.left", // 顶部栏左侧：Logo、返回按钮、侧边栏开关等
  "header.center", // 顶部栏中间：当前会话标题、工作区标题等
  "header.right", // 顶部栏右侧：全局操作、设置、用户菜单等

  "sidebar.brand", // 侧边栏品牌区域：Logo、产品名称等
  "sidebar.header", // 侧边栏头部：标题、折叠按钮等
  "sidebar.navigation", // 侧边栏导航区域：主导航、页面入口等
  "sidebar.workspace.actions", // 工作区操作：新建会话、新建工作区等
  "sidebar.top", // 侧边栏主体顶部扩展区域
  "sidebar.bottom", // 侧边栏主体底部扩展区域
  "sidebar.footer", // 侧边栏页脚：设置、账户、版本信息等

  "panel.right.add-menu", // 右侧面板添加菜单：新增面板/工具入口
  "panel.right.actions", // 右侧面板操作区：关闭、固定、切换等

  "thread.left", // 会话区域左侧：会话级导航、上下文工具等
  "thread.header", // 会话区域头部：会话信息、模型状态、会话操作等
  "thread.before", // 消息列表之前：提示、上下文信息、全局状态等
  "thread.after", // 消息列表之后：会话级附加内容
  "thread.right", // 会话区域右侧：会话级信息、辅助工具等

  "message.before", // 单条消息内容之前：状态、来源、角色信息等
  "message.after", // 单条消息内容之后：补充信息、引用、反馈等
  "message.actions", // 单条消息操作区：复制、重试、编辑、点赞等

  "composer.before", // 输入框之前：上下文提示、附件预览、状态提示等
  "composer.actions.left", // 输入框左侧操作：附件、@、/ 命令、工具等
  "composer.actions.right", // 输入框右侧操作：模型选择、语音、发送等
  "composer.drawer.left", // Composer 左侧抽屉：附件、工具、Skill 等扩展面板
  "composer.drawer.right", // Composer 右侧抽屉：模型、参数、上下文等扩展面板
  "composer.after", // 输入框之后：免责声明、快捷提示、Token 信息等

  "statusbar.left", // 底部状态栏左侧：连接状态、Agent 状态、分支等
  "statusbar.right", // 底部状态栏右侧：Token、上下文、模型、延迟等
] as const;

export type WorkbenchSlot = (typeof WORKBENCH_SLOTS)[number];

export interface MessageSlotContext {
  messageId: string;
  role: "user" | "assistant" | "system";
  isLast: boolean;
}

export interface ComposerSlotContext {
  isRunning: boolean;
  isEmpty: boolean;
}

export interface ComposerDrawerSlotContext extends ComposerSlotContext {
  closeDrawer(): void;
}

export interface RightPanelAddMenuSlotContext {
  activePanelId: string;
  closeMenu(): void;
}

export interface RightPanelActionsSlotContext {
  activePanelId: string;
}

export interface SlotPropsMap {
  "header.left": Record<never, never>; // 顶栏左侧区域
  "header.center": Record<never, never>; // 顶栏居中区域
  "header.right": Record<never, never>; // 顶栏右侧区域
  "sidebar.brand": Record<never, never>; // 侧边栏顶部品牌标识
  "sidebar.header": Record<never, never>; // 侧边栏品牌下方的头部控件
  "sidebar.navigation": Record<never, never>; // “新建会话”下方的主导航
  "sidebar.workspace.actions": Record<never, never>; // “工作区”标题右侧的操作区
  "sidebar.top": Record<never, never>; // 会话列表上方的上下文区域
  "sidebar.bottom": Record<never, never>; // 会话列表下方的上下文区域
  "sidebar.footer": Record<never, never>; // 侧边栏固定底部工具区
  "panel.right.add-menu": RightPanelAddMenuSlotContext; // 右侧 Panel 加号弹出菜单
  "panel.right.actions": RightPanelActionsSlotContext; // 右侧 Panel 标签行尾部图标区
  "thread.left": { threadId?: string }; // 当前会话中央列左侧
  "thread.header": { threadId?: string }; // 当前会话顶部区域
  "thread.before": { threadId?: string }; // 当前会话消息列表之前
  "thread.after": { threadId?: string }; // 当前会话消息列表之后
  "thread.right": { threadId?: string }; // 当前会话中央列右侧
  "message.before": MessageSlotContext; // 单条消息内容之前
  "message.after": MessageSlotContext; // 单条消息内容之后
  "message.actions": MessageSlotContext; // 单条消息操作区域
  "composer.before": ComposerSlotContext; // 输入框区域之前
  "composer.actions.left": ComposerSlotContext; // 输入框操作栏左侧
  "composer.actions.right": ComposerSlotContext; // 输入框操作栏右侧
  "composer.drawer.left": ComposerDrawerSlotContext; // Composer 展开抽屉左侧
  "composer.drawer.right": ComposerDrawerSlotContext; // Composer 展开抽屉右侧
  "composer.after": ComposerSlotContext; // 输入框区域之后
  "statusbar.left": Record<never, never>; // 状态栏左侧区域
  "statusbar.right": Record<never, never>; // 状态栏右侧区域
}

export interface SlotContribution<K extends WorkbenchSlot = WorkbenchSlot> {
  id: string;
  component: ComponentType<SlotPropsMap[K]>;
  order?: number;
}

export interface SlotRegistry {
  register<K extends WorkbenchSlot>(slot: K, contribution: SlotContribution<K>): Disposable;
  get<K extends WorkbenchSlot>(slot: K): readonly SlotContribution<K>[];
  subscribe(listener: () => void): () => void;
}
