import type {
  WorkbenchComposerCommandArgsBinding,
  WorkbenchComposerCommandArgsSchema,
} from "@/runtime/shared/composer/request";
import { PI_COMPACT_CUSTOM_INSTRUCTIONS_MAX_LENGTH } from "./pi-composer-command-arguments";

/**
 * Pi interactive commands that Workbench can execute through public AgentSession APIs.
 *
 * The full Pi TUI catalog also contains terminal-only UI actions (for example `/quit` and
 * `/copy`). Those commands are intentionally absent until Workbench has an equivalent semantic
 * handler; advertising them as ordinary prompts would silently do the wrong thing.
 */
export interface PiComposerBuiltinCommand {
  readonly name: "compact" | "reload";
  readonly effect: "session-action";
  readonly exclusive: true;
  readonly description: string;
  readonly argumentHint?: string;
  readonly argsSchema?: WorkbenchComposerCommandArgsSchema;
  readonly argsBinding?: WorkbenchComposerCommandArgsBinding;
}

export const PI_COMPOSER_BUILTIN_COMMANDS: readonly PiComposerBuiltinCommand[] = Object.freeze([
  {
    name: "compact",
    effect: "session-action",
    exclusive: true,
    description: "Manually compact the session context",
    argumentHint: "[custom instructions]",
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        customInstructions: {
          type: "string",
          maxLength: PI_COMPACT_CUSTOM_INSTRUCTIONS_MAX_LENGTH,
        },
      },
    },
    argsBinding: {
      kind: "message-text",
      field: "customInstructions",
      consumeText: true,
    },
  },
  {
    name: "reload",
    effect: "session-action",
    exclusive: true,
    description: "Reload extensions, skills, prompts, and context files",
  },
] as const);

export function piComposerBuiltinCommand(name: string) {
  return PI_COMPOSER_BUILTIN_COMMANDS.find((command) => command.name === name);
}
