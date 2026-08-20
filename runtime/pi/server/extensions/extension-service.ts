import { basename, dirname, extname } from "node:path";

import type {
  ExtensionListPayload,
  ExtensionListValue,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
} from "../../rpc-contracts";
import { getOrStartSession } from "../sessions/session-registry";

interface LoadedExtension {
  path: string;
  hidden?: boolean;
  sourceInfo: {
    source: string;
    scope: ExtensionSourceScope;
    origin: ExtensionSourceOrigin;
  };
  handlers: ReadonlyMap<string, readonly unknown[]>;
  tools: ReadonlyMap<string, unknown>;
  commands: ReadonlyMap<string, unknown>;
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
            source: extension.sourceInfo.source,
            scope: extension.sourceInfo.scope,
            origin: extension.sourceInfo.origin,
            eventNames: sortedNames(extension.handlers),
            toolNames: sortedNames(extension.tools),
            commandNames: sortedNames(extension.commands),
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
