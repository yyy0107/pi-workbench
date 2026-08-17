import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

export const WORKBENCH_SLOTS = [
  "header.left",
  "header.center",
  "header.right",
  "sidebar.brand",
  "sidebar.header",
  "sidebar.navigation",
  "sidebar.workspace.actions",
  "sidebar.top",
  "sidebar.bottom",
  "sidebar.footer",
  "panel.right.add-menu",
  "panel.right.actions",
  "thread.header",
  "thread.before",
  "thread.after",
  "message.before",
  "message.after",
  "message.actions",
  "composer.before",
  "composer.actions.left",
  "composer.actions.right",
  "composer.after",
  "statusbar.left",
  "statusbar.right",
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
  "thread.header": { threadId?: string }; // 当前会话顶部区域
  "thread.before": { threadId?: string }; // 当前会话消息列表之前
  "thread.after": { threadId?: string }; // 当前会话消息列表之后
  "message.before": MessageSlotContext; // 单条消息内容之前
  "message.after": MessageSlotContext; // 单条消息内容之后
  "message.actions": MessageSlotContext; // 单条消息操作区域
  "composer.before": ComposerSlotContext; // 输入框区域之前
  "composer.actions.left": ComposerSlotContext; // 输入框操作栏左侧
  "composer.actions.right": ComposerSlotContext; // 输入框操作栏右侧
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
