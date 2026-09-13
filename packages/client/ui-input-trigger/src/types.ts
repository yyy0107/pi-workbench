import type { ComposerJsonValue } from "@workbench/core-contracts/composer";

export interface ComposerTriggerItem {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, ComposerJsonValue>>;
}

export type WorkbenchComposerSuggestionGroup =
  | "builtin"
  | "extension"
  | "prompt"
  | "skill"
  | "workbench";
