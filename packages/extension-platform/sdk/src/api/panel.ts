import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "./localizable-text";

import type { Disposable } from "./disposable";

/**
 * Workbench 可承载 Panel 的区域。
 *
 * `left`、`right`、`bottom` 是稳定布局协议，不应本地化。当前右侧区域支持标签页；具体 chrome、
 * 折叠和 resize 行为由 Workbench Host 管理，而不是 Panel 内容组件管理。
 */
export type PanelLocation = "left" | "right" | "bottom";

/** PanelLocation 的运行时枚举，用于校验、遍历和 UI 选项。 */
export const PANEL_LOCATIONS = ["left", "right", "bottom"] as const;

/**
 * Workbench 挂载 Panel 内容组件时传入的 props。
 *
 * 内容组件只负责业务内容，不应重复渲染 Host 已提供的标题栏、标签、resize handle 或关闭 chrome。
 */
export interface PanelComponentProps {
  /** 当前定义的稳定 Panel id，可用于 `data-*`、DOM id 或扩展内部关联。 */
  panelId: string;
  /** 关闭当前 Panel 的便捷回调。调用后组件通常会从对应 Host 卸载。 */
  close(): void;
}

/**
 * 自定义右侧 Panel 标签内容收到的只读状态。
 *
 * 标签组件应只输出图标、标题等非交互内容；外层选中、关闭和键盘交互仍由 Host 所有。
 */
export interface PanelTabComponentProps {
  /** 当前标签对应的稳定 Panel id。 */
  panelId: string;
  /** 此 Panel 是否为其当前位置当前激活的 Panel。 */
  isActive: boolean;
}

/**
 * Panel 标签 className，或基于标签状态计算 className 的纯函数。
 *
 * 函数会在 React render 中执行，必须无副作用且不能调用 Hook；需要 Hook 时使用 `tabComponent`。
 */
export type PanelTabClassName = string | ((context: PanelTabComponentProps) => string | undefined);

/**
 * 对 Workbench 所有标签 chrome 的定点样式覆盖。
 *
 * 类名会在 Host 默认类名之后通过 `cn()` 合并，因此 Tailwind 冲突工具类可覆盖默认值。扩展只应
 * 调整视觉，不应依赖这些 className 重建标签选择或关闭行为。
 */
export interface PanelTabClassNames {
  /** 整个标签容器，包括 trigger 和关闭按钮。 */
  root?: PanelTabClassName;
  /** 选择/激活标签的 Host trigger。 */
  trigger?: PanelTabClassName;
  /** Host 提供的单标签关闭按钮。 */
  closeButton?: PanelTabClassName;
}

/**
 * Panel 的静态注册定义。
 *
 * 注册只声明能力，不会自动打开 Panel。定义会被复制并浅冻结；`tabClassNames` 也会复制冻结。
 * 打开状态、当前位置和各位置尺寸由 PanelService/Panel Store 管理，不应保存在此对象中。
 */
export interface PanelDefinition {
  /** PanelRegistry 范围内全局唯一、非空且不可本地化的 id。 */
  id: string;
  /**
   * Host 标题和默认标签文案。
   *
   * 内置扩展应传入 `defineMessage(...)` 描述符，使 Host 可在 locale 变化时重新解析。若未提供
   * `tabComponent`，此字段必填且字符串值不能是空白。
   */
  title?: LocalizableText;
  /** Host 标题/标签可显示的 Lucide 图标；不负责点击行为。 */
  icon?: LucideIcon;
  /**
   * 可选自定义标签内容组件。它可以使用 Hook 读取动态状态，但必须保持非交互；Host 仍提供外层
   * button、选中状态和关闭操作。提供后 `title`/`icon` 作为 fallback 元数据。
   */
  tabComponent?: ComponentType<PanelTabComponentProps>;
  /** 可选标签 chrome 样式覆盖。 */
  tabClassNames?: PanelTabClassNames;
  /** Panel 主内容组件；由对应位置的 PanelHost 在 Error Boundary 内挂载。 */
  component: ComponentType<PanelComponentProps>;
  /** Panel 第一次打开且没有已保存位置时使用的位置。 */
  defaultLocation: PanelLocation;
  /** 对应位置尚无尺寸时使用的初始像素尺寸。尺寸按 location 保存，不按 Panel 保存。 */
  defaultSize?: number;
  /** 当前 Panel 激活时 resize 可达到的最小像素尺寸。 */
  minSize?: number;
  /** 当前 Panel 激活时 resize 可达到的最大像素尺寸；必须不小于 `minSize`。 */
  maxSize?: number;
}

/**
 * PanelDefinition 的可订阅注册表。
 *
 * Registry 只管理定义；请通过 `PanelService` 打开、关闭、移动或调整 Panel，避免直接修改 Store。
 */
export interface PanelRegistry {
  /**
   * 注册定义并返回撤销注册的 Disposable。
   *
   * id 重复、title/tabComponent 同时缺失、空字符串 title 或非法尺寸范围都会同步抛错。
   */
  register(panel: PanelDefinition): Disposable;
  /** 按精确 id 返回冻结定义；不存在时返回 `undefined`。 */
  get(panelId: string): PanelDefinition | undefined;
  /** 返回按注册顺序排列的稳定只读快照；Registry 变化前引用保持不变。 */
  getAll(): readonly PanelDefinition[];
  /** 订阅注册/注销变化并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}
