import type { CommandRegistry } from "./command";
import type { Disposable } from "./disposable";
import type { PanelRegistry } from "./panel";
import type { RendererRegistry } from "./renderer";
import type { SlotRegistry } from "./slot";

export interface ExtensionContext {
  readonly slots: SlotRegistry;
  readonly panels: PanelRegistry;
  readonly commands: CommandRegistry;
  readonly renderers: RendererRegistry;
}

export type ExtensionSetupResult = void | Disposable | readonly Disposable[];

export interface WorkbenchExtension {
  id: string;
  name: string;
  version: string;
  setup(context: ExtensionContext): ExtensionSetupResult;
}
