import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "@/i18n";
import type { WorkbenchComposerCommandArgsBinding } from "@/runtime/composer-request";

import type { Disposable } from "./disposable";

export type ComposerJsonPrimitive = string | number | boolean | null;
export type ComposerJsonValue =
  | ComposerJsonPrimitive
  | readonly ComposerJsonValue[]
  | { readonly [key: string]: ComposerJsonValue };

/** JSON-Schema-compatible command argument description owned by the contributing extension. */
export type ComposerCommandArgsSchema = Readonly<Record<string, ComposerJsonValue>>;
export type ComposerCommandArgsBinding = WorkbenchComposerCommandArgsBinding;

export type ComposerCommandBehavior = "modifier" | "context" | "transform" | "immediate";
export type ComposerCommandScope = "message" | "segment";
export type ComposerCommandEffect =
  | "session-action"
  | "request-config"
  | "instruction"
  | "context-provider"
  | "prompt-transform"
  | "agent-turn";

export interface ComposerTextNode {
  readonly type: "text";
  readonly text: string;
}

export interface ComposerCommandNode {
  readonly type: "command";
  /** Stable node identity within one composer document. */
  readonly id: string;
  /** Registry id. This is never inferred from the visible label. */
  readonly commandId: string;
  readonly label: string;
  readonly args?: ComposerJsonValue;
  readonly scope: ComposerCommandScope;
  readonly source: "workbench" | "pi";
}

export interface ComposerCommandArgumentNode {
  readonly type: "command-argument";
  readonly id: string;
  readonly commandNodeId: string;
  readonly field: string;
  readonly text: string;
}

export interface ComposerMentionNode {
  readonly type: "mention";
  readonly id: string;
  readonly mentionType: string;
  readonly value: string;
  readonly label: string;
}

export interface ComposerAttachmentNode {
  readonly type: "attachment";
  readonly id: string;
  readonly attachmentType: string;
  readonly value: string;
  readonly label: string;
}

export type ComposerDocumentNode =
  | ComposerTextNode
  | ComposerCommandNode
  | ComposerCommandArgumentNode
  | ComposerMentionNode
  | ComposerAttachmentNode;

export type ComposerDocument = readonly ComposerDocumentNode[];

export interface ComposerCompiledContext {
  readonly type: string;
  readonly value: ComposerJsonValue;
}

/** Mutable, request-scoped target passed to a command's `apply()` function. */
export interface ComposerCommandRequestDraft {
  text: string;
  mode?: string;
  model?: string;
  readonly context: ComposerCompiledContext[];
  readonly metadata: Record<string, ComposerJsonValue>;
}

export interface ComposerCommandApplyContext {
  readonly phase: "selection" | "submit";
  readonly command: ComposerCommandNode;
  readonly document: ComposerDocument;
  readonly index: number;
}

export interface CompiledComposerRequest {
  readonly version: 1;
  /** Canonical structural representation persisted with the Workbench user message. */
  readonly document: ComposerDocument;
  /** Directive-bearing source used only to restore the user-facing Composer document. */
  readonly sourceText: string;
  readonly text: string;
  readonly mode?: string;
  readonly model?: string;
  readonly context: readonly ComposerCompiledContext[];
  readonly metadata: Readonly<Record<string, ComposerJsonValue>>;
  readonly commands: readonly ComposerCommandNode[];
}

export interface ComposerCommandOptions {
  /** How the token participates in request compilation. */
  readonly behavior: ComposerCommandBehavior;
  /** Semantic effect used by the request compiler and command trace. */
  readonly effect?: ComposerCommandEffect;
  /** Exclusive commands cannot be combined with another command token. */
  readonly exclusive?: boolean;
  /** Mutually exclusive commands share a group; the most recently selected token replaces peers. */
  readonly group?: string;
  /** Message-level by default. Segment scope is exposed for extensions that implement local ranges. */
  readonly scope?: ComposerCommandScope;
  /** Declarative argument schema. It is data, not a validator callback. */
  readonly argsSchema?: ComposerCommandArgsSchema;
  /** Identifies the primary free-text field in the structured command parameter panel. */
  readonly argsBinding?: ComposerCommandArgsBinding;
  /**
   * Applies the command to a request draft. Deferred commands run during submit. Immediate commands
   * run at selection time and should perform their action synchronously.
   */
  readonly apply: (
    draft: ComposerCommandRequestDraft,
    context: ComposerCommandApplyContext,
  ) => void;
}

/** A Workbench-owned companion definition; Pi's `registerCommand()` remains untouched. */
export interface ComposerCommandDefinition {
  /** Stable id. Use the Pi invocation name when this definition describes a Pi command. */
  readonly id: string;
  readonly label: LocalizableText;
  readonly description?: LocalizableText;
  readonly icon?: LucideIcon;
  readonly composer: ComposerCommandOptions;
}

export interface ComposerCommandRegistry {
  register(command: ComposerCommandDefinition): Disposable;
  get(commandId: string): ComposerCommandDefinition | undefined;
  getAll(): readonly ComposerCommandDefinition[];
  subscribe(listener: () => void): () => void;
}
