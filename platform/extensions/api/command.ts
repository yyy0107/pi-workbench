import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "@/i18n";

import type { Disposable } from "./disposable";

export interface CommandExecutionContext {
  panels: {
    open(panelId: string): void;
    close(panelId: string): void;
    toggle(panelId: string): void;
  };
  navigation: {
    newThread(): void;
    openThread(threadId: string): void;
  };
}

export interface CommandDefinition {
  id: string;
  title: LocalizableText;
  description?: LocalizableText;
  category?: LocalizableText;
  icon?: LucideIcon;
  shortcut?: readonly string[];
  run(context: CommandExecutionContext): void | Promise<void>;
}

export interface CommandRegistry {
  register(command: CommandDefinition): Disposable;
  get(commandId: string): CommandDefinition | undefined;
  getAll(): readonly CommandDefinition[];
  subscribe(listener: () => void): () => void;
}
