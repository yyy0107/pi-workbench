import type {
  CommandListPayload,
  CommandListValue,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
} from "../../rpc-contracts";
import { getOrStartSession } from "../sessions/session-registry";
import { PI_COMPOSER_BUILTIN_COMMANDS } from "./pi-composer-command-catalog";

interface RegisteredExtensionCommand {
  name: string;
  invocationName: string;
  description?: string;
  sourceInfo: {
    source: string;
    scope: ExtensionSourceScope;
    origin: ExtensionSourceOrigin;
  };
}

interface LoadedPromptTemplate {
  name: string;
  description?: string;
  argumentHint?: string;
  sourceInfo: {
    source: string;
    scope: ExtensionSourceScope;
    origin: ExtensionSourceOrigin;
  };
}

interface LoadedSkill {
  name: string;
  description: string;
  disableModelInvocation: boolean;
}

export interface CommandSessionHost {
  session: {
    extensionRunner: {
      getRegisteredCommands(): readonly RegisteredExtensionCommand[];
    };
    promptTemplates: readonly LoadedPromptTemplate[];
    resourceLoader: {
      getSkills(): { skills: readonly LoadedSkill[] };
    };
  };
}

export interface CommandServiceDependencies {
  getSession(sessionId: string): Promise<CommandSessionHost>;
}

export interface CommandServiceErrorDetails {
  "session-not-found": { sessionId: string };
  internal: Record<string, never>;
}

export type CommandServiceErrorCode = keyof CommandServiceErrorDetails;

export class CommandServiceError<
  Code extends CommandServiceErrorCode = CommandServiceErrorCode,
> extends Error {
  readonly code: Code;
  readonly details: CommandServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: CommandServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CommandServiceError";
    this.code = code;
    this.details = details;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export class CommandService {
  private readonly dependencies: CommandServiceDependencies;

  constructor(dependencies: Partial<CommandServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      ...dependencies,
    };
  }

  async list({ sessionId }: CommandListPayload): Promise<CommandListValue> {
    let host: CommandSessionHost;
    try {
      host = await this.dependencies.getSession(sessionId);
    } catch (error) {
      if (errorCode(error) === "pi_session_not_found") {
        throw new CommandServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId },
          { cause: error },
        );
      }
      throw new CommandServiceError(
        "internal",
        "The session commands could not be loaded.",
        {},
        { cause: error },
      );
    }

    try {
      const builtinNames = new Set<string>(
        PI_COMPOSER_BUILTIN_COMMANDS.map((command) => command.name),
      );
      const extensionCommands = host.session.extensionRunner
        .getRegisteredCommands()
        .filter(
          (command) => !builtinNames.has(command.name) || command.invocationName !== command.name,
        );
      const reservedPromptNames = new Set([
        ...builtinNames,
        ...extensionCommands.map((command) => command.invocationName),
      ]);

      return {
        commands: [
          ...PI_COMPOSER_BUILTIN_COMMANDS.map((command) => ({
            kind: "builtin" as const,
            name: command.name,
            invocationName: command.name,
            effect: command.effect,
            exclusive: command.exclusive,
            description: command.description,
            ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
            ...(command.argsSchema === undefined ? {} : { argsSchema: command.argsSchema }),
            ...(command.argsBinding === undefined ? {} : { argsBinding: command.argsBinding }),
          })),
          ...extensionCommands.map((command) => ({
            kind: "extension" as const,
            name: command.name,
            invocationName: command.invocationName,
            effect: "agent-turn" as const,
            exclusive: true,
            ...(command.description === undefined ? {} : { description: command.description }),
            source: command.sourceInfo.source,
            scope: command.sourceInfo.scope,
            origin: command.sourceInfo.origin,
          })),
          ...host.session.promptTemplates
            .filter((template) => !reservedPromptNames.has(template.name))
            .map((template) => ({
              kind: "prompt" as const,
              name: template.name,
              invocationName: template.name,
              effect: "prompt-transform" as const,
              exclusive: false,
              ...(template.description === undefined ? {} : { description: template.description }),
              ...(template.argumentHint === undefined
                ? {}
                : { argumentHint: template.argumentHint }),
              source: template.sourceInfo.source,
              scope: template.sourceInfo.scope,
              origin: template.sourceInfo.origin,
            })),
          ...host.session.resourceLoader.getSkills().skills.map((skill) => ({
            kind: "skill" as const,
            name: skill.name,
            invocationName: `skill:${skill.name}`,
            effect: "instruction" as const,
            exclusive: false,
            description: skill.description,
            modelInvocable: !skill.disableModelInvocation,
          })),
        ],
      };
    } catch (error) {
      throw new CommandServiceError(
        "internal",
        "The session commands could not be loaded.",
        {},
        { cause: error },
      );
    }
  }
}
