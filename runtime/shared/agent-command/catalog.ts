import type {
  WorkbenchComposerCommandArgsBinding,
  WorkbenchComposerCommandArgsSchema,
  WorkbenchComposerCommandEffect,
} from "@/runtime/shared/composer/request";

export type WorkbenchAgentCommandKind = "builtin" | "extension" | "prompt" | "skill";
export type WorkbenchAgentCommandScope = "user" | "project" | "temporary";

/** Workbench-facing location for a command contributed by an Agent Runtime resource. */
export interface WorkbenchAgentCommandSource {
  readonly scope: WorkbenchAgentCommandScope;
  /** Optional human-readable contributor, such as a package name. */
  readonly label?: string;
}

interface WorkbenchAgentCommandBase {
  readonly name: string;
  /** Collision-safe name accepted by the selected Agent Runtime. */
  readonly invocationName: string;
  readonly effect: WorkbenchComposerCommandEffect;
  readonly exclusive: boolean;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly argsSchema?: WorkbenchComposerCommandArgsSchema;
  readonly argsBinding?: WorkbenchComposerCommandArgsBinding;
}

export interface WorkbenchAgentBuiltinCommand extends WorkbenchAgentCommandBase {
  readonly kind: "builtin";
}

export interface WorkbenchAgentExtensionCommand extends WorkbenchAgentCommandBase {
  readonly kind: "extension";
  readonly source: WorkbenchAgentCommandSource;
}

export interface WorkbenchAgentPromptCommand extends WorkbenchAgentCommandBase {
  readonly kind: "prompt";
  readonly source: WorkbenchAgentCommandSource;
}

export interface WorkbenchAgentSkillCommand extends WorkbenchAgentCommandBase {
  readonly kind: "skill";
  readonly source: WorkbenchAgentCommandSource;
  readonly modelInvocable: boolean;
}

/** Backend-neutral command catalog consumed by the Workbench Composer. */
export type WorkbenchAgentCommand =
  | WorkbenchAgentBuiltinCommand
  | WorkbenchAgentExtensionCommand
  | WorkbenchAgentPromptCommand
  | WorkbenchAgentSkillCommand;

export const EMPTY_WORKBENCH_AGENT_COMMANDS = Object.freeze([]) as readonly WorkbenchAgentCommand[];
