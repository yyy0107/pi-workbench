import { createHash } from "node:crypto";
import { readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  DefaultPackageManager,
  getAgentDir,
  type ResolvedPaths,
  type ResolvedResource,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import mime from "mime";

import type {
  ExtensionFileReadPayload,
  ExtensionFileSnapshotValue,
  ExtensionFilesListPayload,
  ExtensionFilesListValue,
  ExtensionIdentityPayload,
  ExtensionListPayload,
  ExtensionListValue,
  ExtensionRegisteredCommandView,
  ExtensionRegisteredToolView,
  ExtensionRemovePayload,
  ExtensionRemoveValue,
  ExtensionSetEnabledPayload,
  ExtensionSetEnabledValue,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
} from "../../rpc-contracts";
import {
  clonePackageSource,
  pathWithin,
  withResourceEnabled,
} from "../resources/resource-mutations";
import {
  readResourceTextFile,
  ResourceTextFileTooLargeError,
  ResourceTextFileUnsupportedEncodingError,
} from "../resources/resource-text-file";
import { getOrStartSession } from "../sessions/session-registry";

export const MAX_EXTENSION_FILE_BYTES = 5 * 1024 * 1024;
const EXTENSION_DIRECTORY_ENTRY_LIMIT = 2_000;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

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

interface ExtensionSourceInfo {
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
  baseDir?: string;
}

interface LoadedExtension {
  path: string;
  resolvedPath?: string;
  hidden?: boolean;
  sourceInfo: ExtensionSourceInfo;
  handlers: ReadonlyMap<string, readonly unknown[]>;
  tools: ReadonlyMap<string, LoadedTool>;
  commands: ReadonlyMap<string, LoadedCommand>;
}

interface ExtensionRecord {
  name: string;
  filePath: string;
  enabled: boolean;
  sourceInfo: ExtensionSourceInfo;
  handlers: ReadonlyMap<string, readonly unknown[]>;
  tools: ReadonlyMap<string, LoadedTool>;
  commands: ReadonlyMap<string, LoadedCommand>;
}

interface LoadedExtensionsResult {
  extensions: readonly LoadedExtension[];
  errors: readonly unknown[];
}

export interface ExtensionSessionHost {
  readonly isRunning?: boolean;
  session: {
    resourceLoader: {
      getExtensions(): LoadedExtensionsResult;
    };
    settingsManager?: SettingsManager;
    sessionManager?: { getCwd(): string };
    reload?(): Promise<void>;
  };
}

export interface ExtensionServiceDependencies {
  getSession(sessionId: string): Promise<ExtensionSessionHost>;
  removeExtensionPath(targetPath: string): Promise<void>;
}

export interface ExtensionServiceErrorDetails {
  "session-not-found": { sessionId: string };
  "session-busy": { sessionId: string };
  "extension-not-found": { sessionId: string; name: string };
  "extension-read-only": { name: string };
  "extension-package-managed": { name: string; source: string };
  "extension-source-unavailable": { name: string };
  "extension-update-failed": { name: string };
  "extension-remove-failed": { name: string };
  "extension-file-unreadable": { name: string };
  "extension-file-too-large": { name: string; maxBytes: number };
  "extension-file-unsupported-encoding": { name: string };
  "extension-directory-unreadable": { name: string };
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

function extensionName(filePath: string): string {
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return stem === "index" ? path.basename(path.dirname(filePath)) : stem;
}

function relativeDisplayPath(rootPath: string, candidatePath: string): string {
  return path.relative(rootPath, candidatePath).split(path.sep).join("/");
}

function normalizeExtensionRelativePath(name: string, input: string): string {
  const invalid =
    !input ||
    input.length > 16_384 ||
    input.includes("\0") ||
    input.includes("\\") ||
    path.isAbsolute(input) ||
    WINDOWS_ABSOLUTE_PATH.test(input);
  const segments = input.split("/");
  if (invalid || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ExtensionServiceError(
      "extension-file-unreadable",
      "The requested file is outside the extension root.",
      { name },
    );
  }
  return segments.join("/");
}

function compareDirectoryEntries(
  left: { kind: "file" | "directory"; name: string },
  right: { kind: "file" | "directory"; name: string },
): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" });
}

interface ExtensionFileRoot {
  rootPath: string;
  entryPath: string;
  entryRelativePath: string;
  directoryBacked: boolean;
}

async function extensionFileRoot(extension: ExtensionRecord): Promise<ExtensionFileRoot> {
  const entryPath = await realpath(extension.filePath);
  const rootPath = path.dirname(entryPath);
  return {
    rootPath,
    entryPath,
    entryRelativePath: path.basename(entryPath),
    directoryBacked: path.parse(entryPath).name.toLowerCase() === "index",
  };
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

function sameExtensionIdentity(
  extension: ExtensionRecord,
  identity: ExtensionIdentityPayload,
): boolean {
  return (
    extension.name === identity.name &&
    extension.filePath === identity.filePath &&
    extension.sourceInfo.source === identity.source &&
    extension.sourceInfo.scope === identity.scope &&
    extension.sourceInfo.origin === identity.origin
  );
}

export class ExtensionService {
  private readonly dependencies: ExtensionServiceDependencies;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: Partial<ExtensionServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      removeExtensionPath: (targetPath) => rm(targetPath, { recursive: true }),
      ...dependencies,
    };
  }

  private async serializeMutation<Value>(operation: () => Promise<Value>): Promise<Value> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async getSessionHost(sessionId: string): Promise<ExtensionSessionHost> {
    try {
      return await this.dependencies.getSession(sessionId);
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
  }

  private async resolvedPaths(
    host: ExtensionSessionHost,
    loaded: readonly LoadedExtension[],
  ): Promise<ResolvedPaths> {
    const settingsManager = host.session.settingsManager;
    const cwd = host.session.sessionManager?.getCwd();
    if (!settingsManager || !cwd) {
      return {
        extensions: loaded.map((extension) => ({
          path: extension.path,
          enabled: true,
          metadata: extension.sourceInfo,
        })),
        skills: [],
        prompts: [],
        themes: [],
      };
    }

    const packageManager = new DefaultPackageManager({
      cwd,
      agentDir: getAgentDir(),
      settingsManager,
    });
    return packageManager.resolve(async () => "skip");
  }

  private async records(
    host: ExtensionSessionHost,
  ): Promise<{ records: ExtensionRecord[]; loadErrorCount: number }> {
    const result = host.session.resourceLoader.getExtensions();
    const resolved = (await this.resolvedPaths(host, result.extensions)).extensions;
    const resolvedByPath = new Map(resolved.map((resource) => [resource.path, resource]));
    const seenPaths = new Set<string>();
    const hiddenPaths = new Set<string>();
    const records: ExtensionRecord[] = [];

    for (const extension of result.extensions) {
      const resource =
        resolvedByPath.get(extension.path) ??
        (extension.resolvedPath ? resolvedByPath.get(extension.resolvedPath) : undefined);
      seenPaths.add(extension.path);
      if (extension.resolvedPath) seenPaths.add(extension.resolvedPath);
      if (resource) seenPaths.add(resource.path);
      if (extension.hidden) {
        hiddenPaths.add(extension.path);
        if (extension.resolvedPath) hiddenPaths.add(extension.resolvedPath);
        if (resource) hiddenPaths.add(resource.path);
        continue;
      }
      const filePath = resource?.path ?? extension.path;
      records.push({
        name: extensionName(filePath),
        filePath,
        enabled: resource?.enabled ?? true,
        sourceInfo: resource?.metadata ?? extension.sourceInfo,
        handlers: extension.handlers,
        tools: extension.tools,
        commands: extension.commands,
      });
    }

    for (const resource of resolved) {
      if (seenPaths.has(resource.path) || hiddenPaths.has(resource.path)) continue;
      records.push({
        name: extensionName(resource.path),
        filePath: resource.path,
        enabled: resource.enabled,
        sourceInfo: resource.metadata,
        handlers: new Map(),
        tools: new Map(),
        commands: new Map(),
      });
    }

    return { records, loadErrorCount: result.errors.length };
  }

  private async findExtension(
    host: ExtensionSessionHost,
    identity: ExtensionIdentityPayload,
  ): Promise<ExtensionRecord> {
    const extension = (await this.records(host)).records.find((candidate) =>
      sameExtensionIdentity(candidate, identity),
    );
    if (extension) return extension;
    throw new ExtensionServiceError(
      "extension-not-found",
      "The extension is unavailable in this session.",
      { sessionId: identity.sessionId, name: identity.name },
    );
  }

  private assertMutableSession(host: ExtensionSessionHost, sessionId: string): void {
    if (!host.isRunning) return;
    throw new ExtensionServiceError("session-busy", "The session is currently running.", {
      sessionId,
    });
  }

  private async persistExtensionEnabled(
    host: ExtensionSessionHost,
    extension: ExtensionRecord,
    enabled: boolean,
  ): Promise<void> {
    const settingsManager = host.session.settingsManager;
    const cwd = host.session.sessionManager?.getCwd();
    const baseDir =
      extension.sourceInfo.baseDir ??
      (extension.sourceInfo.origin === "top-level" && cwd
        ? extension.sourceInfo.scope === "project"
          ? path.join(cwd, ".pi")
          : getAgentDir()
        : undefined);
    if (!settingsManager || !baseDir) {
      throw new ExtensionServiceError(
        "extension-source-unavailable",
        "The extension source cannot be updated safely.",
        { name: extension.name },
      );
    }
    if (extension.sourceInfo.scope === "temporary") {
      throw new ExtensionServiceError(
        "extension-read-only",
        "Temporary extensions are read-only.",
        { name: extension.name },
      );
    }

    const resourcePath = path.relative(baseDir, extension.filePath);
    if (!resourcePath || resourcePath === ".." || resourcePath.startsWith(`..${path.sep}`)) {
      throw new ExtensionServiceError(
        "extension-source-unavailable",
        "The extension source cannot be updated safely.",
        { name: extension.name },
      );
    }

    if (extension.sourceInfo.origin === "package") {
      const resolvedPaths = enabled
        ? undefined
        : await this.resolvedPaths(host, host.session.resourceLoader.getExtensions().extensions);
      const settings =
        extension.sourceInfo.scope === "project"
          ? settingsManager.getProjectSettings()
          : settingsManager.getGlobalSettings();
      const packages = (settings.packages ?? []).map(clonePackageSource);
      const packageIndex = packages.findIndex((entry) =>
        typeof entry === "string"
          ? entry === extension.sourceInfo.source
          : entry.source === extension.sourceInfo.source,
      );
      if (packageIndex < 0) {
        throw new ExtensionServiceError(
          "extension-source-unavailable",
          "The extension package configuration is unavailable.",
          { name: extension.name },
        );
      }
      const current = packages[packageIndex];
      const packageEntry = typeof current === "string" ? { source: current } : { ...current };
      packageEntry.extensions = withResourceEnabled(
        packageEntry.extensions ?? [],
        resourcePath,
        enabled,
      );
      if (resolvedPaths) {
        const disableBundledResources = (
          current: readonly string[] | undefined,
          resources: readonly ResolvedResource[],
        ): string[] | undefined => {
          const bundledPaths = resources.flatMap((resource) => {
            if (
              !resource.enabled ||
              resource.metadata.origin !== "package" ||
              resource.metadata.source !== extension.sourceInfo.source ||
              resource.metadata.scope !== extension.sourceInfo.scope
            ) {
              return [];
            }
            const packageRoot = resource.metadata.baseDir;
            if (!packageRoot) {
              throw new ExtensionServiceError(
                "extension-source-unavailable",
                "The extension package resources cannot be updated safely.",
                { name: extension.name },
              );
            }
            const relativePath = path.relative(packageRoot, resource.path);
            if (
              !relativePath ||
              relativePath === ".." ||
              relativePath.startsWith(`..${path.sep}`)
            ) {
              throw new ExtensionServiceError(
                "extension-source-unavailable",
                "The extension package resources cannot be updated safely.",
                { name: extension.name },
              );
            }
            return [relativePath];
          });
          if (bundledPaths.length === 0) return current ? [...current] : undefined;
          return bundledPaths.reduce(
            (patterns, bundledPath) => withResourceEnabled(patterns, bundledPath, false),
            [...(current ?? [])],
          );
        };

        const skills = disableBundledResources(packageEntry.skills, resolvedPaths.skills);
        const prompts = disableBundledResources(packageEntry.prompts, resolvedPaths.prompts);
        const themes = disableBundledResources(packageEntry.themes, resolvedPaths.themes);
        if (skills) packageEntry.skills = skills;
        if (prompts) packageEntry.prompts = prompts;
        if (themes) packageEntry.themes = themes;
      }
      packages[packageIndex] = packageEntry;
      if (extension.sourceInfo.scope === "project") settingsManager.setProjectPackages(packages);
      else settingsManager.setPackages(packages);
    } else {
      const settings =
        extension.sourceInfo.scope === "project"
          ? settingsManager.getProjectSettings()
          : settingsManager.getGlobalSettings();
      const extensions = withResourceEnabled(settings.extensions ?? [], resourcePath, enabled);
      if (extension.sourceInfo.scope === "project") {
        settingsManager.setProjectExtensionPaths(extensions);
      } else {
        settingsManager.setExtensionPaths(extensions);
      }
    }

    await settingsManager.flush();
    const settingsError = settingsManager.drainErrors()[0];
    if (settingsError) throw settingsError.error;
    await host.session.reload?.();
  }

  async list({ sessionId }: ExtensionListPayload): Promise<ExtensionListValue> {
    const host = await this.getSessionHost(sessionId);
    try {
      const snapshot = await this.records(host);
      return {
        extensions: snapshot.records.map((extension) => ({
          name: extension.name,
          filePath: extension.filePath,
          source: extension.sourceInfo.source,
          scope: extension.sourceInfo.scope,
          origin: extension.sourceInfo.origin,
          enabled: extension.enabled,
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
        loadErrorCount: snapshot.loadErrorCount,
      };
    } catch (error) {
      if (error instanceof ExtensionServiceError) throw error;
      throw new ExtensionServiceError(
        "internal",
        "The session extensions could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async setEnabled({
    sessionId,
    enabled,
    ...identity
  }: ExtensionSetEnabledPayload): Promise<ExtensionSetEnabledValue> {
    const host = await this.getSessionHost(sessionId);
    const request = { sessionId, ...identity };
    try {
      return await this.serializeMutation(async () => {
        this.assertMutableSession(host, sessionId);
        const extension = await this.findExtension(host, request);
        if (extension.enabled !== enabled) {
          await this.persistExtensionEnabled(host, extension, enabled);
        }
        return { name: extension.name, filePath: extension.filePath, enabled };
      });
    } catch (error) {
      if (error instanceof ExtensionServiceError) throw error;
      throw new ExtensionServiceError(
        "extension-update-failed",
        "The extension state could not be updated.",
        { name: identity.name },
        { cause: error },
      );
    }
  }

  async listFiles({
    relativePath = "",
    ...identity
  }: ExtensionFilesListPayload): Promise<ExtensionFilesListValue> {
    const host = await this.getSessionHost(identity.sessionId);
    const extension = await this.findExtension(host, identity);

    try {
      const root = await extensionFileRoot(extension);
      if (!root.directoryBacked) {
        if (relativePath) {
          throw new ExtensionServiceError(
            "extension-directory-unreadable",
            "A single-file extension does not expose nested directories.",
            { name: identity.name },
          );
        }
        return {
          extensionName: extension.name,
          rootPath: root.rootPath,
          relativePath: "",
          entries: [
            {
              name: root.entryRelativePath,
              relativePath: root.entryRelativePath,
              kind: "file",
              hidden: root.entryRelativePath.startsWith("."),
            },
          ],
          truncated: false,
        };
      }

      const requestedPath = path.resolve(root.rootPath, relativePath);
      if (!pathWithin(root.rootPath, requestedPath)) {
        throw new ExtensionServiceError(
          "extension-directory-unreadable",
          "The requested directory is outside the extension root.",
          { name: identity.name },
        );
      }
      const canonicalPath = await realpath(requestedPath);
      if (!pathWithin(root.rootPath, canonicalPath) || !(await stat(canonicalPath)).isDirectory()) {
        throw new Error("The requested path is not a readable extension directory.");
      }
      const directoryEntries = await readdir(canonicalPath, { withFileTypes: true });
      const entries: ExtensionFilesListValue["entries"] = [];
      for (const entry of directoryEntries) {
        const entryPath = path.join(canonicalPath, entry.name);
        const symbolicLink = entry.isSymbolicLink();
        let kind: "file" | "directory";
        if (symbolicLink) {
          const canonicalEntry = await realpath(entryPath);
          if (!pathWithin(root.rootPath, canonicalEntry)) continue;
          kind = (await stat(canonicalEntry)).isDirectory() ? "directory" : "file";
        } else if (entry.isDirectory()) kind = "directory";
        else if (entry.isFile()) kind = "file";
        else continue;
        entries.push({
          name: entry.name,
          relativePath: relativeDisplayPath(root.rootPath, entryPath),
          kind,
          hidden: entry.name.startsWith("."),
          ...(symbolicLink ? { symbolicLink: true } : {}),
        });
        if (entries.length > EXTENSION_DIRECTORY_ENTRY_LIMIT) break;
      }
      entries.sort(compareDirectoryEntries);
      return {
        extensionName: extension.name,
        rootPath: root.rootPath,
        relativePath: relativeDisplayPath(root.rootPath, canonicalPath),
        entries: entries.slice(0, EXTENSION_DIRECTORY_ENTRY_LIMIT),
        truncated: entries.length > EXTENSION_DIRECTORY_ENTRY_LIMIT,
      };
    } catch (error) {
      if (error instanceof ExtensionServiceError) throw error;
      throw new ExtensionServiceError(
        "extension-directory-unreadable",
        "The extension directory could not be read.",
        { name: identity.name },
        { cause: error },
      );
    }
  }

  async readFile({
    relativePath: requestedRelativePath,
    ...identity
  }: ExtensionFileReadPayload): Promise<ExtensionFileSnapshotValue> {
    const host = await this.getSessionHost(identity.sessionId);
    const extension = await this.findExtension(host, identity);

    try {
      const root = await extensionFileRoot(extension);
      const relativePath = normalizeExtensionRelativePath(
        identity.name,
        requestedRelativePath ?? root.entryRelativePath,
      );
      if (!root.directoryBacked && relativePath !== root.entryRelativePath) {
        throw new ExtensionServiceError(
          "extension-file-unreadable",
          "A single-file extension exposes only its entry file.",
          { name: identity.name },
        );
      }
      const requestedPath = path.join(root.rootPath, ...relativePath.split("/"));
      if (!pathWithin(root.rootPath, requestedPath)) {
        throw new ExtensionServiceError(
          "extension-file-unreadable",
          "The requested file is outside the extension root.",
          { name: identity.name },
        );
      }
      const absolutePath = await realpath(requestedPath);
      if (!pathWithin(root.rootPath, absolutePath) || !(await stat(absolutePath)).isFile()) {
        throw new ExtensionServiceError(
          "extension-file-unreadable",
          "The requested path is not a readable extension file.",
          { name: identity.name },
        );
      }
      const file = await readResourceTextFile(absolutePath, MAX_EXTENSION_FILE_BYTES);
      return {
        extensionName: extension.name,
        rootPath: root.rootPath,
        relativePath,
        absolutePath,
        name: path.basename(absolutePath),
        content: file.content,
        mediaType: mime.getType(absolutePath) ?? "text/plain",
        encoding: "utf-8",
        version: `sha256:${createHash("sha256").update(file.bytes).digest("base64url")}`,
        size: file.bytes.byteLength,
        modifiedAt: file.modifiedAt,
      };
    } catch (error) {
      if (error instanceof ExtensionServiceError) throw error;
      if (error instanceof ResourceTextFileTooLargeError) {
        throw new ExtensionServiceError(
          "extension-file-too-large",
          "The extension entry file is too large to display.",
          { name: identity.name, maxBytes: MAX_EXTENSION_FILE_BYTES },
          { cause: error },
        );
      }
      if (error instanceof ResourceTextFileUnsupportedEncodingError) {
        throw new ExtensionServiceError(
          "extension-file-unsupported-encoding",
          "The extension entry file is not supported as UTF-8 text.",
          { name: identity.name },
          { cause: error },
        );
      }
      throw new ExtensionServiceError(
        "extension-file-unreadable",
        "The extension entry file could not be read.",
        { name: identity.name },
        { cause: error },
      );
    }
  }

  async remove({ sessionId, ...identity }: ExtensionRemovePayload): Promise<ExtensionRemoveValue> {
    const host = await this.getSessionHost(sessionId);
    const request = { sessionId, ...identity };
    try {
      return await this.serializeMutation(async () => {
        this.assertMutableSession(host, sessionId);
        const extension = await this.findExtension(host, request);
        if (extension.sourceInfo.origin === "package") {
          throw new ExtensionServiceError(
            "extension-package-managed",
            "Package-provided extensions must be removed through the package manager.",
            { name: extension.name, source: extension.sourceInfo.source },
          );
        }
        if (
          extension.sourceInfo.scope === "temporary" ||
          extension.sourceInfo.source !== "auto" ||
          !extension.sourceInfo.baseDir
        ) {
          throw new ExtensionServiceError(
            "extension-read-only",
            "This extension source is read-only.",
            { name: extension.name },
          );
        }

        const [canonicalRoot, canonicalFile] = await Promise.all([
          realpath(path.join(extension.sourceInfo.baseDir, "extensions")),
          realpath(extension.filePath),
        ]);
        if (canonicalRoot === canonicalFile || !pathWithin(canonicalRoot, canonicalFile)) {
          throw new ExtensionServiceError(
            "extension-source-unavailable",
            "The extension deletion target is outside its source root.",
            { name: extension.name },
          );
        }
        const relativeFile = path.relative(canonicalRoot, canonicalFile);
        const firstSegment = relativeFile.split(path.sep)[0];
        if (!firstSegment) {
          throw new ExtensionServiceError(
            "extension-source-unavailable",
            "The extension deletion target is unavailable.",
            { name: extension.name },
          );
        }
        const targetPath = relativeFile.includes(path.sep)
          ? path.join(canonicalRoot, firstSegment)
          : canonicalFile;
        const canonicalTarget = await realpath(targetPath);
        if (canonicalRoot === canonicalTarget || !pathWithin(canonicalRoot, canonicalTarget)) {
          throw new ExtensionServiceError(
            "extension-source-unavailable",
            "The extension deletion target is outside its source root.",
            { name: extension.name },
          );
        }

        await this.dependencies.removeExtensionPath(canonicalTarget);
        await host.session.reload?.();
        return { name: extension.name, filePath: extension.filePath, removed: true };
      });
    } catch (error) {
      if (error instanceof ExtensionServiceError) throw error;
      throw new ExtensionServiceError(
        "extension-remove-failed",
        "The extension could not be removed.",
        { name: identity.name },
        { cause: error },
      );
    }
  }
}
