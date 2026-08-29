import {
  MessageSquareQuoteIcon,
  MessagesSquareIcon,
  PuzzleIcon,
  SparklesIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import type { WorkbenchAgentCommandKind } from "@/runtime/shared/agent-command/catalog";

export type ComposerTokenKind = WorkbenchAgentCommandKind | "conversation" | "workbench";

const COMPOSER_TOKEN_ICONS: Readonly<Record<ComposerTokenKind, LucideIcon>> = {
  builtin: SquareTerminalIcon,
  extension: PuzzleIcon,
  prompt: MessageSquareQuoteIcon,
  skill: SparklesIcon,
  conversation: MessagesSquareIcon,
  workbench: WrenchIcon,
};

export function ComposerTokenIcon({ kind }: { kind: ComposerTokenKind }) {
  const Icon = COMPOSER_TOKEN_ICONS[kind];
  return <Icon />;
}
