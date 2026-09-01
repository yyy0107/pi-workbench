import type { ComponentType } from "react";
import type {
  DataMessagePart,
  DataMessagePartComponent,
  EnrichedPartState,
  ToolCallMessagePart,
  ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "./localizable-text";
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
 * 工具时间线折叠控制器接收当前 Part 与受控展开状态。
 *
 * 控制器只用于响应扩展拥有的展示状态，例如等待用户输入；它不渲染工具详情、不执行工具，
 * 也不能修改 Part。Host 会把控制器挂在折叠内容之外，因此详情关闭时仍可请求展开。
 */
export interface ToolPresentationDisclosureControllerProps {
  readonly part: ToolCallMessagePart;
  readonly running: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export type ToolPresentationDisclosureController =
  ComponentType<ToolPresentationDisclosureControllerProps>;

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

/** 单个 assistant-ui 消息 Part 的可叠加扩展 renderer 参数。 */
export interface MessagePartRendererProps {
  readonly part: EnrichedPartState;
}

export type MessagePartRendererComponent = ComponentType<MessagePartRendererProps>;

/**
 * 可叠加的消息 Part renderer。
 *
 * `canRender` 在 React render 期间调用，必须是纯函数、容忍 streaming 中的部分数据，并且不能
 * 修改 Part。多个贡献同时匹配时，注册顺序靠前的贡献优先。
 */
export interface MessagePartRendererContribution {
  /** 用于生命周期、错误隔离和诊断的非空稳定 id。 */
  readonly id: string;
  /** 判断该贡献是否接管当前 Part。 */
  readonly canRender: (part: EnrichedPartState) => boolean;
  /** 命中后挂载的组件类型。 */
  readonly component: MessagePartRendererComponent;
}

/**
 * 按注册顺序匹配任意消息 Part 的可订阅 Registry。
 *
 * 它用于无法通过 tool/data 协议名称表达的叶子级扩展，例如受约束的结构化文本展示。没有贡献
 * 命中时，Host 必须回退到调用方已有的消息呈现。
 */
export interface MessagePartRendererRegistry {
  /** 注册贡献并返回撤销注册的 Disposable；重复 id 或空 id 会同步抛错。 */
  register(contribution: MessagePartRendererContribution): Disposable;
  /** 返回冻结的注册顺序快照；Registry 变化前引用保持不变。 */
  getAll(): readonly Readonly<MessagePartRendererContribution>[];
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
 * 一个工具调用在消息工作轨迹中的轻量展示描述。
 *
 * 它只控制外层动作标签、图标和折叠摘要，不替代 Tool Renderer，也不改变或执行工具。
 * `summarize` 会在参数仍可能部分到达的 streaming 阶段调用，因此必须是纯函数并容忍缺失字段。
 */
export interface ToolPresentationDefinition {
  /** 工具完成后的动作标签，例如“运行”。 */
  readonly label: LocalizableText;
  /** 工具执行中的默认动作标签，例如“正在运行”。 */
  readonly activeLabel: LocalizableText;
  /** 可选的动态执行中标签；必须是纯函数、容忍部分参数，空值或异常时使用 `activeLabel`。 */
  readonly getActiveLabel?: (part: ToolCallMessagePart) => LocalizableText | undefined;
  /** 时间线步骤图标。 */
  readonly icon: LucideIcon;
  /** 可选的单行摘要提取器；可返回本地化描述，空值时继续使用 Workbench 的安全 fallback。 */
  readonly summarize?: (part: ToolCallMessagePart) => LocalizableText | undefined;
  /**
   * 可选的受控折叠行为；适用于工具在运行中异步进入“需要用户操作”等展示状态时自动展开。
   * 该组件始终位于折叠详情之外，不得执行工具或复制详情 UI。
   */
  readonly disclosureController?: ToolPresentationDisclosureController;
}

/**
 * 按 `toolName` 精确匹配时间线展示描述的可订阅 Registry。
 *
 * 名称区分大小写且唯一。注册值会被复制并浅冻结，快照在 Registry 变化前保持引用稳定。
 */
export interface ToolPresentationRegistry {
  /** 注册一个工具展示描述并返回撤销注册的 Disposable。 */
  register(toolName: string, presentation: ToolPresentationDefinition): Disposable;
  /** 读取一个工具的展示描述。 */
  get(toolName: string): ToolPresentationDefinition | undefined;
  /** 返回 toolName 到展示描述的冻结稳定快照。 */
  getPresentationMap(): Readonly<Record<string, ToolPresentationDefinition>>;
  /** 订阅注册/注销变化并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}

/**
 * 命名 Data Part 在消息工作轨迹中的展示声明。
 *
 * Data Renderer 仍然拥有步骤内容；该声明只让整条消息 Renderer 知道这个 Part 应和 reasoning、
 * tool-call 一起进入工作时间线，以及它当前是否为活动步骤。谓词会在 React render 期间调用，
 * 必须是纯函数、容忍未知 data，并且不能泄露或修改 payload。
 */
export interface DataPresentationDefinition {
  /** 当前仅支持进入 reasoning/tool 共用时间线。 */
  readonly display: "timeline";
  /** 可选可见性判断；返回 false 时 Part 不进入时间线，仍由普通 Data Renderer 决定是否显示。 */
  readonly isVisible?: (part: DataMessagePart) => boolean;
  /** 可选活动状态判断，用于时间线的展开状态与进行中提示。 */
  readonly isActive?: (part: DataMessagePart) => boolean;
}

/** 按 `data.name` 精确匹配 Data Part 时间线展示声明的可订阅 Registry。 */
export interface DataPresentationRegistry {
  /** 注册一个 Data Part 展示声明并返回撤销注册的 Disposable。 */
  register(dataName: string, presentation: DataPresentationDefinition): Disposable;
  /** 读取一个 Data Part 的展示声明。 */
  get(dataName: string): DataPresentationDefinition | undefined;
  /** 返回 dataName 到展示声明的冻结稳定快照。 */
  getPresentationMap(): Readonly<Record<string, DataPresentationDefinition>>;
  /** 订阅注册/注销变化并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}

/**
 * 扩展可注册的消息呈现能力集合。
 *
 * `message` 决定整条消息如何遍历和分组；`parts` 提供按谓词匹配的可叠加叶子 renderer；
 * `tools`/`data` 提供按协议名称精确匹配的叶子 renderer；
 * `toolPresentations`/`dataPresentations` 为工具和命名 Data Part 提供与具体消息布局解耦的
 * 时间线元数据。
 * 常见能力扩展应把其 Panel、Command、Slot 和相关 Tool/Data Renderer 放在同一 setup 生命周期
 * 中，使扩展停用时入口与展示一起清理。
 */
export interface RendererRegistry {
  /** 全局唯一的整条消息呈现器。 */
  readonly message: MessageRendererRegistry;
  /** 按注册顺序匹配任意消息 Part 的可叠加 renderer。 */
  readonly parts: MessagePartRendererRegistry;
  /** 按 `toolName` 精确匹配的 Tool renderer。 */
  readonly tools: NamedRendererRegistry<ToolRendererComponent>;
  /** 按 `data.name` 精确匹配的 Data renderer。 */
  readonly data: NamedRendererRegistry<DataRendererComponent>;
  /** 按 `toolName` 精确匹配的工具时间线展示描述。 */
  readonly toolPresentations: ToolPresentationRegistry;
  /** 按 `data.name` 精确匹配的 Data Part 时间线展示描述。 */
  readonly dataPresentations: DataPresentationRegistry;
}
