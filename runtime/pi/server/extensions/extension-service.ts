import { basename, dirname, extname } from "node:path";

import type {
  ExtensionListPayload,
  ExtensionListValue,
  ExtensionRegisteredCommandView,
  ExtensionRegisteredToolView,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
} from "../../rpc-contracts";
import { getOrStartSession } from "../sessions/session-registry";

interface LoadedTool {
  definition?: {
    label?: unknown;
    description?: unknown;
    parameters?: unknown;
  };
}

interface LoadedCommand {
  description?: unknown;
  getArgumentCompletions?: unknown;
}

interface LoadedExtension {
  path: string;
  hidden?: boolean;
  sourceInfo: {
    source: string;
    scope: ExtensionSourceScope;
    origin: ExtensionSourceOrigin;
  };
  handlers: ReadonlyMap<string, readonly unknown[]>;
  tools: ReadonlyMap<string, LoadedTool>;
  commands: ReadonlyMap<string, LoadedCommand>;
}

interface LoadedExtensionsResult {
  extensions: readonly LoadedExtension[];
  errors: readonly unknown[];
}

export interface ExtensionSessionHost {
  session: {
    resourceLoader: {
      getExtensions(): LoadedExtensionsResult;
    };
  };
}

export interface ExtensionServiceDependencies {
  getSession(sessionId: string): Promise<ExtensionSessionHost>;
}

export interface ExtensionServiceErrorDetails {
  "session-not-found": { sessionId: string };
  internal: Record<string, never>;
}

export type ExtensionServiceErrorCode = keyof ExtensionServiceErrorDetails;

export class ExtensionServiceError<
  Code extends ExtensionServiceErrorCode = ExtensionServiceErrorCode,
> extends Error {
  readonly code: Code;
  readonly details: ExtensionServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: ExtensionServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExtensionServiceError";
    this.code = code;
    this.details = details;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function extensionName(path: string): string {
  const fileName = basename(path);
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return stem === "index" ? basename(dirname(path)) : stem;
}

function sortedNames(values: ReadonlyMap<string, unknown>): string[] {
  return [...values.keys()].sort((left, right) => left.localeCompare(right));
}

function sortedEntries<T>(values: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function boundedText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength)}…`;
}

const MAX_EXTENSION_PARAMETER_SCHEMA_LENGTH = 64 * 1024;

function serializeParameterSchema(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value, null, 2);
    return json && json.length <= MAX_EXTENSION_PARAMETER_SCHEMA_LENGTH ? json : undefined;
  } catch {
    return undefined;
  }
}

function extensionToolView(name: string, tool: LoadedTool): ExtensionRegisteredToolView {
  const description = boundedText(tool.definition?.description, 16 * 1024);
  const parameterSchemaJson = serializeParameterSchema(tool.definition?.parameters);
  return {
    name,
    label: boundedText(tool.definition?.label, 512) ?? name,
    ...(description ? { description } : {}),
    ...(parameterSchemaJson ? { parameterSchemaJson } : {}),
  };
}

function extensionCommandView(
  name: string,
  command: LoadedCommand,
): ExtensionRegisteredCommandView {
  const description = boundedText(command.description, 16 * 1024);
  return {
    name,
    ...(description ? { description } : {}),
    hasArgumentCompletions: typeof command.getArgumentCompletions === "function",
  };
}

export class ExtensionService {
  private readonly dependencies: ExtensionServiceDependencies;

  constructor(dependencies: Partial<ExtensionServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      ...dependencies,
    };
  }

  async list({ sessionId }: ExtensionListPayload): Promise<ExtensionListValue> {
    let host: ExtensionSessionHost;
    try {
      host = await this.dependencies.getSession(sessionId);
    } catch (error) {
      if (errorCode(error) === "pi_session_not_found") {
        throw new ExtensionServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId },
          { cause: error },
        );
      }
      throw new ExtensionServiceError(
        "internal",
        "The session extensions could not be loaded.",
        {},
        { cause: error },
      );
    }

    try {
      const result = host.session.resourceLoader.getExtensions();
      return {
        extensions: result.extensions
          .filter((extension) => !extension.hidden)
          .map((extension) => ({
            name: extensionName(extension.path),
            filePath: extension.path,
            source: extension.sourceInfo.source,
            scope: extension.sourceInfo.scope,
            origin: extension.sourceInfo.origin,
            eventNames: sortedNames(extension.handlers),
            toolNames: sortedNames(extension.tools),
            commandNames: sortedNames(extension.commands),
            eventDetails: sortedEntries(extension.handlers).map(([name, handlers]) => ({
              name,
              handlerCount: handlers.length,
            })),
            toolDetails: sortedEntries(extension.tools).map(([name, tool]) =>
              extensionToolView(name, tool),
            ),
            commandDetails: sortedEntries(extension.commands).map(([name, command]) =>
              extensionCommandView(name, command),
            ),
          })),
        loadErrorCount: result.errors.length,
      };
    } catch (error) {
      throw new ExtensionServiceError(
        "internal",
        "The session extensions could not be loaded.",
        {},
        { cause: error },
      );
    }
  }
}
