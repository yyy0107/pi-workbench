import type { CommandRegistry } from "./command";
import type { Disposable } from "./disposable";
import type { PanelRegistry } from "./panel";
import type { RendererRegistry } from "./renderer";
import type { SlotRegistry } from "./slot";

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
  /** 注册整条消息呈现器以及按名称匹配的 Tool/Data Renderer。 */
  readonly renderers: RendererRegistry;
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
  /**
   * 同步注册扩展贡献并返回扩展拥有的额外资源。
   *
   * setup 抛错时，本次已注册的贡献会立即回滚；返回的资源在扩展停用时反向释放。异步初始化
   * 应放入贡献组件的 effect、Command `run()` 或显式创建且可取消的后台资源中。
   */
  setup(context: ExtensionContext): ExtensionSetupResult;
}
