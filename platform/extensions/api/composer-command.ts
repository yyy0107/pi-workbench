import type { LucideIcon } from "lucide-react";

import type {
  CanonicalComposerRequest,
  ComposerAttachmentNode as CanonicalComposerAttachmentNode,
  ComposerCommandArgsBinding as CanonicalComposerCommandArgsBinding,
  ComposerCommandArgsSchema as CanonicalComposerCommandArgsSchema,
  ComposerCommandArgumentNode as CanonicalComposerCommandArgumentNode,
  ComposerCommandEffect as CanonicalComposerCommandEffect,
  ComposerCommandNode as CanonicalComposerCommandNode,
  ComposerCommandScope as CanonicalComposerCommandScope,
  ComposerCommandSubmission as CanonicalComposerCommandSubmission,
  ComposerContextSubmission,
  ComposerDocument as CanonicalComposerDocument,
  ComposerDocumentNode as CanonicalComposerDocumentNode,
  ComposerJsonPrimitive as CanonicalComposerJsonPrimitive,
  ComposerJsonValue as CanonicalComposerJsonValue,
  ComposerMentionNode as CanonicalComposerMentionNode,
  ComposerTextNode as CanonicalComposerTextNode,
} from "@/contracts/composer";
import type { LocalizableText } from "@/i18n";

import type { Disposable } from "./disposable";

export type ComposerJsonPrimitive = CanonicalComposerJsonPrimitive;
export type ComposerJsonValue = CanonicalComposerJsonValue;

/** JSON-Schema-compatible command argument description owned by the contributing extension. */
export type ComposerCommandArgsSchema = CanonicalComposerCommandArgsSchema;
export type ComposerCommandArgsBinding = CanonicalComposerCommandArgsBinding;

export type ComposerCommandBehavior = "modifier" | "context" | "transform" | "immediate";
export type ComposerCommandScope = CanonicalComposerCommandScope;
export type ComposerCommandEffect = CanonicalComposerCommandEffect;
export type ComposerTextNode = CanonicalComposerTextNode;
export type ComposerCommandNode = CanonicalComposerCommandNode;
export type ComposerCommandSubmission = CanonicalComposerCommandSubmission;
export type ComposerCommandArgumentNode = CanonicalComposerCommandArgumentNode;
export type ComposerMentionNode = CanonicalComposerMentionNode;
export type ComposerAttachmentNode = CanonicalComposerAttachmentNode;
export type ComposerDocumentNode = CanonicalComposerDocumentNode;
export type ComposerDocument = CanonicalComposerDocument;
export type ComposerCompiledContext = ComposerContextSubmission;

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

export type CompiledComposerRequest = CanonicalComposerRequest;

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

/** A Workbench-owned companion definition; the active Agent runtime's registry remains untouched. */
export interface ComposerCommandDefinition {
  /** Stable id. Use the Agent invocation name when this definition describes an Agent command. */
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
