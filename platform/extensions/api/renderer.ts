import type { ComponentType } from "react";
import type { DataMessagePartComponent, ToolCallMessagePartComponent } from "@assistant-ui/react";

import type { Disposable } from "./disposable";

/**
 * 单个 assistant-ui `tool-call` Part 的 React renderer。
 *
 * 参数在 streaming 阶段可能只完成部分解析，组件必须容忍可选字段，并覆盖 `running`、
 * `complete`、`incomplete`、`requires-action` 等状态。Renderer 只负责呈现；注册它不会向模型
 * 暴露、执行或授权对应工具。
 */
export type ToolRendererComponent = ToolCallMessagePartComponent;

/**
 * 单个 assistant-ui 命名 `data` Part 的 React renderer。
 *
 * Data Part 必须由 Runtime/transport 实际发出，且 `part.name` 与注册名称精确匹配后才会挂载。
 */
export type DataRendererComponent = DataMessagePartComponent;

/**
 * 整条消息内容区域的无 props React 组件。
 *
 * 组件在 `MessagePrimitive.Root` 内挂载，应渲染一个 `MessagePrimitive.Parts` 或
 * `MessagePrimitive.GroupedParts`，并负责所有叶子 Part 的呈现。若需要叠加精确 Tool/Data
 * Renderer，应在对应叶子分支使用公开的 `RendererHost`。
 */
export type MessageRendererComponent = ComponentType;

/**
 * 单实例 Message Renderer 的注册值。
 *
 * 对象在注册时被复制并浅冻结。它拥有消息 Part 的分组策略、reasoning/tool/data chrome 和
 * fallback 样式，但不拥有消息数据或 Runtime 状态；这些状态应直接从 assistant-ui 读取。
 */
export interface MessageRendererContribution {
  /** 用于错误隔离和诊断的非空稳定 id；不可本地化。 */
  readonly id: string;
  /** 接管消息内容区域的组件类型，不是预先创建的 ReactNode。 */
  readonly component: MessageRendererComponent;
}

/**
 * 全局单实例 Message Renderer 注册表。
 *
 * 同一时间只能存在一个贡献。这样每条消息只有一个组件负责 `Parts`/`GroupedParts`，避免多个
 * 扩展重复消费相同 Part。没有贡献时，Workbench Host 会使用调用方提供的安全 fallback。
 */
export interface MessageRendererRegistry {
  /** 注册唯一贡献并返回撤销注册的 Disposable；已有贡献或空 id 会同步抛错。 */
  register(contribution: MessageRendererContribution): Disposable;
  /** 返回当前冻结贡献；未注册时返回 `undefined`。 */
  get(): MessageRendererContribution | undefined;
  /** 订阅注册/注销变化并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}

/**
 * 按协议名称精确匹配组件的可订阅 Registry。
 *
 * Tool 和 Data 各使用独立实例。名称区分大小写、必须非空，并在单个 Registry 内唯一；该 API
 * 没有模糊匹配、优先级或 order。Host 通过 `getComponentMap()` 获取稳定快照以订阅 React UI。
 */
export interface NamedRendererRegistry<TComponent> {
  /** 注册名称与组件，并返回撤销该精确注册的 Disposable；重复名称会同步抛错。 */
  register(name: string, component: TComponent): Disposable;
  /** 按区分大小写的精确名称读取组件；未命中时返回 `undefined`。 */
  get(name: string): TComponent | undefined;
  /** 返回 name 到 component 的冻结稳定快照；Registry 变化前引用保持不变。 */
  getComponentMap(): Readonly<Record<string, TComponent>>;
  /** 订阅注册/注销变化并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}

/**
 * 扩展可注册的消息呈现能力集合。
 *
 * `message` 决定整条消息如何遍历和分组；`tools`/`data` 提供可叠加的精确叶子 renderer。
 * 常见能力扩展应把其 Panel、Command、Slot 和相关 Tool/Data Renderer 放在同一 setup 生命周期
 * 中，使扩展停用时入口与展示一起清理。
 */
export interface RendererRegistry {
  /** 全局唯一的整条消息呈现器。 */
  readonly message: MessageRendererRegistry;
  /** 按 `toolName` 精确匹配的 Tool renderer。 */
  readonly tools: NamedRendererRegistry<ToolRendererComponent>;
  /** 按 `data.name` 精确匹配的 Data renderer。 */
  readonly data: NamedRendererRegistry<DataRendererComponent>;
}
