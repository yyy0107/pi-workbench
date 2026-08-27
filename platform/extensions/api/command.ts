import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "@/i18n";
import type { OpenMainViewRequest } from "./main-view";
import type { PanelLocation } from "./panel";

import type { Disposable } from "./disposable";

/**
 * 命令执行时可使用的宿主能力。
 *
 * 该对象由 `CommandService` 创建并冻结，只暴露经过约束的 Panel 与导航操作；它不是完整的
 * ExtensionContext，也不能用于注册新贡献。命令应通过这里调用宿主行为，避免直接依赖 Store、
 * Router 或具体 Host 实现。
 */
export interface CommandExecutionContext {
  /** 对已注册 Panel 的基础操作。传给 `open`/`toggle` 的未知 id 会抛出异常。 */
  panels: {
    /** 打开并激活 Panel；首次打开时应用定义中的默认位置和默认尺寸。 */
    open(panelId: string): void;
    /** 关闭 Panel。关闭未知或未打开的 id 是安全的无操作。 */
    close(panelId: string): void;
    /** 根据当前打开状态调用 `open` 或 `close`。 */
    toggle(panelId: string): void;
    /** 在执行其他操作前把 Panel 移到指定宿主位置。 */
    move(panelId: string, location: PanelLocation): void;
  };
  /** 会话级导航操作。默认实现会触发浏览器页面导航。 */
  navigation: {
    /** 导航到新会话入口。 */
    newThread(): void;
    /** 打开指定会话；`threadId` 必须是非空稳定 id。 */
    openThread(threadId: string): void;
  };
  /** Transient pages rendered in the shared Workbench shell. */
  mainViews: {
    /** Open a registered Main View while preserving the Workbench header and Sidebar. */
    open<P extends Record<string, unknown>>(request: OpenMainViewRequest<P>): void;
    /** Return the central workspace to its default conversation. */
    close(): void;
  };
}

/**
 * 注册到命令面板和全局快捷键系统的命令定义。
 *
 * 定义会在注册时被复制并浅冻结，`shortcut` 也会复制并冻结。注册后修改原对象不会更新 UI；
 * 如需替换命令，应先 dispose 原注册再注册新定义。所有用户可见文案都应使用
 * `defineMessage(...)` 创建的描述符，使 Host 能在 locale 变化时重新解析。
 */
export interface CommandDefinition {
  /** 全局唯一且不可本地化的协议 id，推荐使用 `<feature>.<action>`。 */
  id: string;
  /** 命令面板中的主标题。内置扩展应使用延迟解析的消息描述符。 */
  title: LocalizableText;
  /** 可选说明文字，用于解释命令结果或适用范围。 */
  description?: LocalizableText;
  /** 命令面板分组标题；省略时进入平台默认分组。 */
  category?: LocalizableText;
  /** 命令面板中显示的 Lucide 图标。Host 负责展示，不应编码业务状态。 */
  icon?: LucideIcon;
  /**
   * 可选快捷键 token。
   *
   * 支持 `Mod`/`CmdOrCtrl`、`Ctrl`、`Meta`/`Cmd`、`Alt`/`Option`、`Shift` 和恰好
   * 一个普通按键。修饰键采用精确匹配；多余修饰键不会命中。冲突时按 Registry 注册顺序选择
   * 第一个命令，因此扩展作者必须主动避免冲突。
   */
  shortcut?: readonly string[];
  /**
   * 执行命令。可以同步完成或返回 Promise。
   *
   * 抛出的异常和 rejected Promise 会向调用方传播；命令面板会统一上报，但扩展组件直接调用
   * `CommandService.execute()` 时仍需自行处理 rejection。此函数不是 React 组件，不能调用 Hook。
   */
  run(context: CommandExecutionContext): void | Promise<void>;
}

/**
 * CommandDefinition 的可订阅注册表。
 *
 * 业务扩展通常只在同步 `setup()` 中调用 `register()`；Host 和 Service 使用其余只读方法。
 */
export interface CommandRegistry {
  /**
   * 注册命令并返回可撤销注册的 Disposable。
   *
   * `id` 必须非空且在整个 Registry 内唯一；重复注册会同步抛错。
   */
  register(command: CommandDefinition): Disposable;
  /** 按精确 id 返回当前冻结定义；未注册时返回 `undefined`。 */
  get(commandId: string): CommandDefinition | undefined;
  /** 返回按注册顺序排列的稳定只读快照；Registry 变化前引用保持不变。 */
  getAll(): readonly CommandDefinition[];
  /** 订阅注册/注销变化。返回的函数用于取消订阅；listener 不接收参数。 */
  subscribe(listener: () => void): () => void;
}
