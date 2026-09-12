import {
  BoxIcon,
  FileTextIcon,
  MessageSquareQuoteIcon,
  MessagesSquareIcon,
  PlugIcon,
  PuzzleIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import type { WorkbenchAgentCommandKind } from "@workbench/agent-runtime-contracts/commands";

export type ComposerTokenKind =
  | WorkbenchAgentCommandKind
  | "conversation"
  | "workspace-file"
  | "workbench";

const COMPOSER_TOKEN_ICONS: Readonly<Record<ComposerTokenKind, LucideIcon>> = {
  builtin: SquareTerminalIcon,
  extension: PuzzleIcon,
  prompt: MessageSquareQuoteIcon,
  skill: BoxIcon,
  conversation: MessagesSquareIcon,
  "workspace-file": FileTextIcon,
  workbench: WrenchIcon,
};

export type ComposerCommandIconKind = Exclude<ComposerTokenKind, "conversation" | "workspace-file">;

const COMPOSER_COMMAND_ICONS: Readonly<Record<ComposerCommandIconKind, LucideIcon>> = {
  builtin: SquareTerminalIcon,
  extension: PlugIcon,
  prompt: FileTextIcon,
  skill: BoxIcon,
  workbench: WrenchIcon,
};

export function ComposerTokenIcon({ kind }: { kind: ComposerTokenKind }) {
  const Icon = COMPOSER_TOKEN_ICONS[kind];
  return <Icon />;
}

export function ComposerCommandIcon({
  kind,
  className,
}: {
  kind: ComposerCommandIconKind;
  className?: string;
}) {
  const Icon = COMPOSER_COMMAND_ICONS[kind];
  return <Icon className={className} />;
}
