import type {
  CommandListPayload,
  CommandListValue,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
  PiResourceCatalogTarget,
} from "@/runtime/pi/contracts/rpc";
import { projectPiAgentCommands } from "@/runtime/pi/shared/commands/command-projection";
import {
  AgentCommandCatalogError,
  type AgentCommandCatalogPort,
  type AgentCommandCatalogTarget,
} from "@/runtime/server/agent-command-catalog-port";
import { RpcDomainError } from "../core/rpc-domain-error";
import { getScopedResourceContextService } from "../resources/scoped-resource-context";
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
  sourceInfo: {
    source: string;
    scope: ExtensionSourceScope;
    origin: ExtensionSourceOrigin;
  };
}

export interface CommandSessionHost {
  session: {
    extensionRunner?: {
      getRegisteredCommands(): readonly RegisteredExtensionCommand[];
    };
    promptTemplates?: readonly LoadedPromptTemplate[];
    resourceLoader: {
      getSkills(): { skills: readonly LoadedSkill[] };
    };
  };
}

export interface CommandServiceDependencies {
  getSession(sessionId: string): Promise<CommandSessionHost>;
  getScopedResourceHost(target: PiResourceCatalogTarget): Promise<CommandSessionHost>;
}

/** Pi command-catalog capability exposed to the wire transport. */
export interface CommandCatalogProtocol {
  list(request: CommandListPayload): Promise<CommandListValue>;
}

export interface CommandServiceErrorDetails {
  "session-not-found": { sessionId: string };
  internal: Record<string, never>;
}

export type CommandServiceErrorCode = keyof CommandServiceErrorDetails;

export class CommandServiceError<
  Code extends CommandServiceErrorCode = CommandServiceErrorCode,
> extends RpcDomainError<Code, CommandServiceErrorDetails[Code]> {
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

export class CommandService implements AgentCommandCatalogPort, CommandCatalogProtocol {
  private readonly dependencies: CommandServiceDependencies;

  constructor(dependencies: Partial<CommandServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        return {
          session: {
            resourceLoader: context.resourceLoader,
          },
        };
      },
      ...dependencies,
    };
  }

  async list(request: CommandListPayload): Promise<CommandListValue> {
    let host: CommandSessionHost;
    const resourceTarget = "target" in request ? request.target : undefined;
    if (resourceTarget) {
      host = await this.dependencies.getScopedResourceHost(resourceTarget);
    } else {
      const sessionId = "sessionId" in request ? request.sessionId : undefined;
      if (!sessionId) {
        throw new CommandServiceError("internal", "The command catalog identity is missing.", {});
      }
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
    }

    try {
      const builtinNames = new Set<string>(
        PI_COMPOSER_BUILTIN_COMMANDS.map((command) => command.name),
      );
      const extensionCommands = (
        host.session.extensionRunner?.getRegisteredCommands() ?? []
      ).filter(
        (command) => !builtinNames.has(command.name) || command.invocationName !== command.name,
      );
      const reservedPromptNames = new Set([
        ...builtinNames,
        ...extensionCommands.map((command) => command.invocationName),
      ]);
      const skills = host.session.resourceLoader
        .getSkills()
        .skills.filter(
          (skill) =>
            !resourceTarget ||
            skill.sourceInfo.scope === "user" ||
            (resourceTarget.scope === "project" && skill.sourceInfo.scope === "project"),
        );

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
          ...(host.session.promptTemplates ?? [])
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
          ...skills.map((skill) => ({
            kind: "skill" as const,
            name: skill.name,
            invocationName: `skill:${skill.name}`,
            effect: "instruction" as const,
            exclusive: false,
            description: skill.description,
            modelInvocable: !skill.disableModelInvocation,
            source: skill.sourceInfo.source,
            scope: skill.sourceInfo.scope,
            origin: skill.sourceInfo.origin,
          })),
        ],
      };
    } catch (error) {
      throw new CommandServiceError(
        "internal",
        "The Composer commands could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async getCatalog(target: AgentCommandCatalogTarget) {
    const request: CommandListPayload =
      target.kind === "thread"
        ? { sessionId: target.threadId }
        : target.kind === "project"
          ? { target: { scope: "project", workspaceId: target.workspaceId } }
          : { target: { scope: "user" } };
    try {
      return projectPiAgentCommands((await this.list(request)).commands);
    } catch (error) {
      if (error instanceof AgentCommandCatalogError) throw error;
      if (error instanceof CommandServiceError && error.code === "session-not-found") {
        throw new AgentCommandCatalogError("thread-not-found", "The Agent thread does not exist.", {
          cause: error,
        });
      }
      throw new AgentCommandCatalogError(
        "internal",
        "The Agent command catalog could not be loaded.",
        { cause: error },
      );
    }
  }
}
