import type { ComponentType } from "react";

import type { LocalizableText } from "@/i18n";

import type { CommandRegistry } from "./command";
import type { ComposerCommandRegistry } from "./composer-command";
import type { Disposable } from "./disposable";
import type { MainViewRegistry } from "./main-view";
import type { OpenerRegistry } from "./opener";
import type { PanelLocation, PanelRegistry } from "./panel";
import type { RendererRegistry } from "./renderer";
import type { SettingsRegistry } from "./settings";
import type { SlotRegistry, WorkbenchSlot } from "./slot";
import type { WorkspaceSurfaceRegistry } from "./workspace-surface";

/** Workbench 中所有直接承载 React 组件的公开贡献类型。 */
export const COMPONENT_EXTENSION_CONTRIBUTION_KINDS = [
  "slot",
  "panel",
  "message-renderer",
  "message-part-renderer",
  "tool-renderer",
  "data-renderer",
  "settings-section",
  "settings-item",
  "main-view",
  "workspace-surface",
] as const;

export type ComponentExtensionContributionKind =
  (typeof COMPONENT_EXTENSION_CONTRIBUTION_KINDS)[number];

/** 所有组件贡献共享的工具箱展示契约。 */
interface ComponentExtensionContributionBase {
  /** 与实际注册贡献一致的稳定 id、名称或 kind。 */
  readonly id: string;
  /** 用户可理解的组件出现区域，例如 AI 消息中的单个消息 Part。 */
  readonly surface: LocalizableText;
  /** 可选的最终 React 挂载 Host/Primitive 路径；Slot target 自身足够时可以省略。 */
  readonly host?: string;
  /** 命中、替换或回退规则的可选说明。 */
  readonly description?: LocalizableText;
  /** 使用贡献真实组件库和样式渲染的无 props 预览组件类型。 */
  readonly preview: ComponentType;
  /** 实现该贡献的项目相对源码文件；首项应为主要 React 组件文件。 */
  readonly sourceFiles: readonly [string, ...string[]];
}

/**
 * 一个可在工具箱中检查和预览的真实前端组件贡献。
 *
 * Slot target 直接复用平台的 `WorkbenchSlot` 联合类型，Panel target 复用 `PanelLocation`，确保
 * 工具箱位置框线图使用真实宿主区域；其他 Registry/Host 使用其自身的稳定字符串 key。
 */
export type ComponentExtensionContribution = ComponentExtensionContributionBase &
  (
    | { readonly kind: "slot"; readonly target: WorkbenchSlot }
    | { readonly kind: "panel"; readonly target: PanelLocation }
    | {
        readonly kind: Exclude<ComponentExtensionContributionKind, "panel" | "slot">;
        readonly target: string;
      }
  );

/**
 * 扩展在 Workbench 工具箱中公开的可选前端组件能力描述。
 *
 * 文案保留为延迟解析的消息描述，由工具箱 Host 按当前 locale 解析。未提供该元数据的扩展仍可
 * 正常激活，只是不进入面向用户的“组件拓展”目录。
 */
export interface ExtensionToolboxCapability {
  /** 工具箱使用的能力分类；前端组件渲染能力不得归入 Pi 扩展。 */
  readonly kind: "component-extension";
  /** 扩展的分发方式；installable 可由应用级安装注册表独立激活或卸载。 */
  readonly distribution: "builtin" | "installable";
  /** 工具箱能力列表和详情页使用的本地化名称。 */
  readonly name: LocalizableText;
  /** 对该扩展所提供能力的简短本地化说明。 */
  readonly description?: LocalizableText;
  /** 定义 `defineExtension()` 和 setup 生命周期的项目相对入口文件。 */
  readonly entryFile: string;
  /** 该能力拥有的所有前端组件贡献；一个扩展可同时进入多个插槽或宿主。 */
  readonly contributions: readonly [
    ComponentExtensionContribution,
    ...ComponentExtensionContribution[],
  ];
}

/**
 * 传给扩展 `setup()` 的能力集合。
 *
 * ExtensionManager 为每次激活创建一个受跟踪的 Context。通过这些 Registry 创建的 Disposable
 * 会自动归属当前扩展，并在 setup 回滚、停用或 Provider 卸载时按反向顺序清理。Context 仅用于
 * 同步注册；不要将它当作 React 状态容器，也不要在 setup 中调用 Hook。
 */
export interface ExtensionContext {
  /** 在宿主声明的位置插入小型 React 组件。 */
  readonly slots: SlotRegistry;
  /** 注册由 Workbench 管理位置、尺寸、打开状态和错误边界的 Panel。 */
  readonly panels: PanelRegistry;
  /** 注册进入命令面板及可选全局快捷键的动作。 */
  readonly commands: CommandRegistry;
  /** 注册按能力评分的资源打开处理器，避免贡献之间直接引用实现。 */
  readonly openers: OpenerRegistry;
  /** 注册 Composer 内的结构化命令 Token 及其提交期编译行为。 */
  readonly composerCommands: ComposerCommandRegistry;
  /** 注册整条消息、可叠加消息 Part、按名称匹配的 Tool/Data Renderer 和时间线展示描述。 */
  readonly renderers: RendererRegistry;
  /** 注册共享设置面板中的分区和功能自有设置项。 */
  readonly settings: SettingsRegistry;
  /** 注册替换中央对话区域的完整功能主视图。 */
  readonly mainViews: MainViewRegistry;
  /** 注册由 RightWorkspace 核心宿主管理标签和生命周期的检查能力。 */
  readonly workspace: WorkspaceSurfaceRegistry;
}

/**
 * `setup()` 支持的同步返回值。
 *
 * Registry Disposable 即使不返回也会被 Manager 跟踪；仍建议显式返回以表达所有权。扩展自行
 * 创建的监听器、timer 或订阅必须包装成 Disposable 并返回。Promise 不属于合法返回值。
 */
export type ExtensionSetupResult = void | Disposable | readonly Disposable[];

/**
 * 一个可由 ExtensionManager 激活的静态 Workbench 扩展。
 *
 * 扩展对象应在模块作用域定义并保持引用稳定。`ExtensionProvider` 使用对象标识判断是否需要
 * 停用并重新激活；在 React render 中临时创建对象会导致不必要的生命周期重启。
 */
export interface WorkbenchExtension {
  /** ExtensionManager 范围内全局唯一、非空且不可本地化的 id。推荐 `workbench.<feature>`。 */
  id: string;
  /** 面向日志和开发工具的人类可读名称；不是产品 UI 的本地化来源。 */
  name: string;
  /** 非空版本元数据；当前不参与依赖解析或升级协商。 */
  version: string;
  /** 可选的工具箱能力目录元数据；扩展停用后对应条目会随活动扩展快照一起移除。 */
  toolbox?: ExtensionToolboxCapability;
  /**
   * 同步注册扩展贡献并返回扩展拥有的额外资源。
   *
   * setup 抛错时，本次已注册的贡献会立即回滚；返回的资源在扩展停用时反向释放。异步初始化
   * 应放入贡献组件的 effect、Command `run()` 或显式创建且可取消的后台资源中。
   */
  setup(context: ExtensionContext): ExtensionSetupResult;
}
