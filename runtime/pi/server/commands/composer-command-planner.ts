import type { PromptTemplate, Skill } from "@earendil-works/pi-coding-agent";

import type {
  WorkbenchComposerCommandEffect,
  WorkbenchComposerCommandSubmission,
  WorkbenchComposerSubmission,
} from "../../../composer-request";
import { PiServerError } from "../core/errors";
import { validatePiCompactCommandArguments } from "./pi-composer-command-arguments";
import {
  piComposerBuiltinCommand,
  PI_COMPOSER_BUILTIN_COMMANDS,
  type PiComposerBuiltinCommand,
} from "./pi-composer-command-catalog";

interface RegisteredExtensionCommand {
  invocationName: string;
}

export interface ComposerCommandPlanningSession {
  extensionRunner: {
    getRegisteredCommands(): readonly RegisteredExtensionCommand[];
  };
  promptTemplates: readonly PromptTemplate[];
  resourceLoader: {
    getSkills(): { skills: readonly Skill[] };
  };
}

export type PlannedWorkbenchComposerCommand =
  | {
      command: WorkbenchComposerCommandSubmission;
      kind: "workbench";
      effect: WorkbenchComposerCommandEffect;
      exclusive: false;
    }
  | {
      command: WorkbenchComposerCommandSubmission;
      kind: "builtin";
      effect: "session-action";
      exclusive: true;
      builtin: PiComposerBuiltinCommand;
    }
  | {
      command: WorkbenchComposerCommandSubmission;
      kind: "extension";
      effect: "agent-turn";
      exclusive: true;
    }
  | {
      command: WorkbenchComposerCommandSubmission;
      kind: "prompt";
      effect: "prompt-transform";
      exclusive: false;
      template: PromptTemplate;
    }
  | {
      command: WorkbenchComposerCommandSubmission;
      kind: "skill";
      effect: "instruction";
      exclusive: false;
      skill: Skill;
    };

function workbenchEffect(submission: WorkbenchComposerSubmission): WorkbenchComposerCommandEffect {
  if (submission.context.length > 0) return "context-provider";
  if (submission.mode !== undefined || submission.model !== undefined) return "request-config";
  return Object.keys(submission.metadata).length > 0 ? "request-config" : "instruction";
}

/** Full preflight: resolve every token before any command with side effects executes. */
export function preflightPlanWorkbenchComposerCommands(
  session: ComposerCommandPlanningSession,
  submission: WorkbenchComposerSubmission,
): PlannedWorkbenchComposerCommand[] {
  const builtinNames = new Set(PI_COMPOSER_BUILTIN_COMMANDS.map((command) => command.name));
  const extensionNames = new Set(
    session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName),
  );
  const promptTemplates = new Map(
    session.promptTemplates
      .filter(
        (template) =>
          !builtinNames.has(template.name as PiComposerBuiltinCommand["name"]) &&
          !extensionNames.has(template.name),
      )
      .map((template) => [template.name, template]),
  );
  const skills = new Map<string, Skill>(
    session.resourceLoader
      .getSkills()
      .skills.map((skill) => [`skill:${skill.name}`, skill] as const),
  );

  const planned = submission.commands.map((command): PlannedWorkbenchComposerCommand => {
    if (command.source === "workbench") {
      return {
        command,
        kind: "workbench",
        effect: workbenchEffect(submission),
        exclusive: false,
      };
    }
    const builtin = piComposerBuiltinCommand(command.commandId);
    if (builtin) {
      if (builtin.name === "compact") {
        validatePiCompactCommandArguments(command, submission.text);
      }
      return { command, kind: "builtin", effect: "session-action", exclusive: true, builtin };
    }
    if (extensionNames.has(command.commandId)) {
      return { command, kind: "extension", effect: "agent-turn", exclusive: true };
    }
    const template = promptTemplates.get(command.commandId);
    if (template) {
      return {
        command,
        kind: "prompt",
        effect: "prompt-transform",
        exclusive: false,
        template,
      };
    }
    const skill = skills.get(command.commandId);
    if (skill) {
      return { command, kind: "skill", effect: "instruction", exclusive: false, skill };
    }
    throw new PiServerError("pi_command_not_found", 400);
  });

  if (planned.length > 1 && planned.some((command) => command.exclusive)) {
    throw new PiServerError("pi_composer_command_conflict", 400);
  }
  return planned;
}
