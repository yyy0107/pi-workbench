import { createHash } from "node:crypto";
import { open, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
  type ResolvedResource,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import mime from "mime";

import type {
  ExtensionSourceOrigin,
  ExtensionSourceScope,
  SkillDescribePayload,
  SkillDescribeValue,
  SkillFileReadPayload,
  SkillFileSnapshotValue,
  SkillFilesListPayload,
  SkillFilesListValue,
  SkillListPayload,
  SkillListValue,
  PiResourceCatalogTarget,
  PiResourceRequest,
  SkillRemovePayload,
  SkillRemoveValue,
  SkillSetEnabledPayload,
  SkillSetEnabledValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import {
  clonePackageSource,
  pathWithin,
  withResourceEnabled,
} from "../resources/resource-mutations";
import {
  getPiResourceMutationCoordinator,
  PiResourceMutationBusyError,
  PiResourceMutationSessionUnavailableError,
  type PiResourceMutationCoordinator,
  type PiResourceMutationResult,
  type PiResourceMutationScope,
} from "../resources/pi-resource-mutation-coordinator";
import { getScopedResourceContextService } from "../resources/scoped-resource-context";
import {
  readResourceTextFile,
  ResourceTextFileTooLargeError,
  ResourceTextFileUnsupportedEncodingError,
} from "../resources/resource-text-file";
import { getOrStartSession } from "../sessions/session-registry";

import { builtinSkillEnabled, withWorkbenchBuiltinSkills } from "./builtin-skills";
import { isWorkbenchBuiltinPackage } from "../packages/builtin-packages";

export const MAX_SKILL_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;
const SKILL_DOCUMENT_READ_CHUNK_BYTES = 64 * 1024;
const SKILL_DIRECTORY_ENTRY_LIMIT = 2_000;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

export interface SkillProtocol {
  list(request: SkillListPayload): Promise<SkillListValue>;
  describe(request: SkillDescribePayload): Promise<SkillDescribeValue>;
  setEnabled(request: SkillSetEnabledPayload): Promise<SkillSetEnabledValue>;
  remove(request: SkillRemovePayload): Promise<SkillRemoveValue>;
  listFiles(request: SkillFilesListPayload): Promise<SkillFilesListValue>;
  readFile(request: SkillFileReadPayload): Promise<SkillFileSnapshotValue>;
}

class SkillDocumentTooLargeError extends Error {}
async function readSkillDocument(filePath: string): Promise<string> {
  const file = await open(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (totalBytes <= MAX_SKILL_DOCUMENT_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(SKILL_DOCUMENT_READ_CHUNK_BYTES, MAX_SKILL_DOCUMENT_BYTES + 1 - totalBytes),
      );
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_SKILL_DOCUMENT_BYTES) throw new SkillDocumentTooLargeError();
      chunks.push(buffer.subarray(0, bytesRead));
    }

    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    await file.close();
  }
}

interface SkillSourceInfo {
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
  baseDir?: string;
}

interface LoadedSkill {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  filePath: string;
  sourceInfo: SkillSourceInfo;
}

interface SkillRecord extends LoadedSkill {
  enabled: boolean;
}

function sameSkillMutationIdentity(left: SkillRecord, right: SkillRecord): boolean {
  return (
    left.filePath === right.filePath &&
    left.sourceInfo.source === right.sourceInfo.source &&
    left.sourceInfo.scope === right.sourceInfo.scope &&
    left.sourceInfo.origin === right.sourceInfo.origin
  );
}

export interface SkillSessionHost {
  readonly isRunning?: boolean;
  session: {
    resourceLoader: {
      getSkills(): { skills: readonly LoadedSkill[] };
    };
    settingsManager?: SettingsManager;
    sessionManager?: { getCwd(): string };
    reload?(): Promise<void>;
  };
}

export interface SkillServiceDependencies {
  agentDir(): string;
  getSession(sessionId: string): Promise<SkillSessionHost>;
  getScopedResourceHost(target: PiResourceCatalogTarget): Promise<SkillSessionHost>;
  readSkillDocument(filePath: string): Promise<string>;
  removeSkillPath(targetPath: string): Promise<void>;
  mutationCoordinator: PiResourceMutationCoordinator;
}

type SkillResourceIdentityDetails =
  | { sessionId: string; target?: never }
  | { target: PiResourceCatalogTarget; sessionId?: never };

export interface SkillServiceErrorDetails {
  "session-not-found": { sessionId: string };
  "session-busy": { sessionId: string };
  "skill-not-found": SkillResourceIdentityDetails & { name: string };
  "skill-document-too-large": { name: string; maxBytes: number };
  "skill-file-unreadable": { name: string; relativePath: string };
  "skill-file-too-large": { name: string; relativePath: string; maxBytes: number };
  "skill-file-unsupported-encoding": { name: string; relativePath: string };
  "skill-read-only": { name: string };
  "skill-package-managed": { name: string; source: string };
  "skill-source-unavailable": { name: string };
  "skill-directory-unreadable": { name: string };
  "skill-update-failed": { name: string };
  "skill-remove-failed": { name: string };
  internal: Record<string, never>;
}

export type SkillServiceErrorCode = keyof SkillServiceErrorDetails;

export class SkillServiceError<
  Code extends SkillServiceErrorCode = SkillServiceErrorCode,
> extends RpcDomainError<Code, SkillServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: SkillServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: SkillServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillServiceError";
    this.code = code;
    this.details = details;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function relativeDisplayPath(rootPath: string, candidatePath: string): string {
  return path.relative(rootPath, candidatePath).split(path.sep).join("/");
}

function normalizeSkillRelativePath(name: string, input: string): string {
  const invalid =
    !input ||
    input.length > 16_384 ||
    input.includes("\0") ||
    input.includes("\\") ||
    path.isAbsolute(input) ||
    WINDOWS_ABSOLUTE_PATH.test(input);
  const segments = input.split("/");
  if (invalid || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new SkillServiceError(
      "skill-file-unreadable",
      "The requested file is outside the Skill root.",
      { name, relativePath: input },
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

export class SkillService implements SkillProtocol {
  private readonly dependencies: SkillServiceDependencies;

  constructor(dependencies: Partial<SkillServiceDependencies> = {}) {
    this.dependencies = {
      agentDir: getAgentDir,
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        return {
          isRunning: false,
          session: {
            resourceLoader: context.resourceLoader,
            settingsManager: context.settingsManager,
            sessionManager: { getCwd: () => context.cwd },
            reload: () => context.reload(),
          },
        };
      },
      readSkillDocument,
      removeSkillPath: (targetPath) => rm(targetPath, { recursive: true }),
      mutationCoordinator: getPiResourceMutationCoordinator(),
      ...dependencies,
    };
  }

  private async getResourceHost(request: PiResourceRequest): Promise<SkillSessionHost> {
    return "target" in request && request.target
      ? this.dependencies.getScopedResourceHost(request.target)
      : this.getSessionHost(request.sessionId);
  }

  private resourceIdentityDetails(request: PiResourceRequest): SkillResourceIdentityDetails {
    return "target" in request && request.target
      ? { target: request.target }
      : { sessionId: request.sessionId };
  }

  private async mutateResourceHost<Value>(
    request: PiResourceRequest,
    scope: PiResourceMutationScope,
    operation: (host: SkillSessionHost) => Promise<PiResourceMutationResult<Value>>,
  ): Promise<Value> {
    if (!("target" in request) || !request.target) {
      return this.dependencies.mutationCoordinator.mutateForSession(
        {
          scope,
          sessionId: request.sessionId,
          getSession: () => this.getSessionHost(request.sessionId),
        },
        operation,
      );
    }

    return this.dependencies.mutationCoordinator.mutate(scope, async () => {
      const host = await this.dependencies.getScopedResourceHost(request.target);
      const result = await operation(host);
      if (!result.reload) return result;
      return {
        ...result,
        afterReload: async () => {
          await result.afterReload?.();
          await host.session.reload?.();
        },
      };
    });
  }

  private async getSessionHost(sessionId: string): Promise<SkillSessionHost> {
    let host: SkillSessionHost;
    try {
      host = await this.dependencies.getSession(sessionId);
    } catch (error) {
      if (errorCode(error) === "pi_session_not_found") {
        throw new SkillServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId },
          { cause: error },
        );
      }
      throw new SkillServiceError(
        "internal",
        "The session skills could not be loaded.",
        {},
        { cause: error },
      );
    }
    return host;
  }

  private async resolvedResources(host: SkillSessionHost): Promise<ResolvedResource[]> {
    const loaded = host.session.resourceLoader.getSkills().skills;
    const settingsManager = host.session.settingsManager;
    const cwd = host.session.sessionManager?.getCwd();
    if (!settingsManager || !cwd) {
      return loaded.map((skill) => ({
        path: skill.filePath,
        enabled: true,
        metadata: skill.sourceInfo,
      }));
    }

    const packageManager = new DefaultPackageManager({
      cwd,
      agentDir: getAgentDir(),
      settingsManager,
    });
    return (await packageManager.resolve(async () => "skip")).skills;
  }

  private parseResolvedSkill(resource: ResolvedResource, cwd: string): LoadedSkill | undefined {
    const parsed = loadSkills({
      cwd,
      agentDir: getAgentDir(),
      skillPaths: [resource.path],
      includeDefaults: false,
    }).skills.at(0);
    if (!parsed) return undefined;
    return {
      name: parsed.name,
      description: parsed.description,
      disableModelInvocation: parsed.disableModelInvocation,
      filePath: parsed.filePath,
      sourceInfo: resource.metadata,
    };
  }

  private async records(host: SkillSessionHost): Promise<SkillRecord[]> {
    const loaded = [...host.session.resourceLoader.getSkills().skills];
    const resolved = await this.resolvedResources(host);
    const resolvedByPath = new Map(resolved.map((resource) => [resource.path, resource]));
    const seenPaths = new Set<string>();
    const records: SkillRecord[] = loaded.map((skill) => {
      const resource = resolvedByPath.get(skill.filePath);
      seenPaths.add(skill.filePath);
      return {
        ...skill,
        enabled: resource?.enabled ?? true,
        sourceInfo: resource?.metadata ?? skill.sourceInfo,
      };
    });
    const cwd = host.session.sessionManager?.getCwd() ?? process.cwd();

    for (const resource of resolved) {
      if (seenPaths.has(resource.path)) continue;
      const skill = this.parseResolvedSkill(resource, cwd);
      if (!skill || records.some((candidate) => candidate.name === skill.name)) continue;
      records.push({ ...skill, enabled: resource.enabled });
    }
    const agentDir = this.dependencies.agentDir();
    const patterns = host.session.settingsManager?.getGlobalSettings().skills ?? [];
    const builtins = withWorkbenchBuiltinSkills(
      { skills: [], diagnostics: [] },
      agentDir,
      patterns,
      true,
    ).skills;
    for (const skill of builtins) {
      const existing = records.find((record) => record.name === skill.name);
      if (existing && existing.filePath !== skill.filePath) continue;
      const record = { ...skill, enabled: builtinSkillEnabled(skill.filePath, agentDir, patterns) };
      if (existing) Object.assign(existing, record);
      else records.push(record);
    }
    return records;
  }

  private async findSkill(
    host: SkillSessionHost,
    request: PiResourceRequest,
    name: string,
  ): Promise<SkillRecord> {
    const requestedScope = "target" in request ? request.target?.scope : undefined;
    const skill = (await this.records(host)).find(
      (candidate) =>
        candidate.name === name &&
        (requestedScope === undefined || candidate.sourceInfo.scope === requestedScope),
    );
    if (skill) return skill;
    throw new SkillServiceError(
      "skill-not-found",
      "The skill is unavailable in this resource scope.",
      {
        ...this.resourceIdentityDetails(request),
        name,
      },
    );
  }

  private mutationScope(
    host: SkillSessionHost,
    scope: ExtensionSourceScope,
    name: string,
  ): PiResourceMutationScope {
    if (scope !== "project") return { scope: "user" };
    const cwd = host.session.sessionManager?.getCwd();
    if (cwd) return { scope: "project", cwd };
    throw new SkillServiceError(
      "skill-source-unavailable",
      "The skill source cannot be updated safely.",
      { name },
    );
  }

  private async persistSkillEnabled(
    host: SkillSessionHost,
    skill: SkillRecord,
    enabled: boolean,
  ): Promise<void> {
    const settingsManager = host.session.settingsManager;
    const cwd = host.session.sessionManager?.getCwd();
    const baseDir =
      skill.sourceInfo.baseDir ??
      (skill.sourceInfo.origin === "top-level" && cwd
        ? skill.sourceInfo.scope === "project"
          ? path.join(cwd, ".pi")
          : getAgentDir()
        : undefined);
    if (!settingsManager || !baseDir) {
      throw new SkillServiceError(
        "skill-source-unavailable",
        "The skill source cannot be updated safely.",
        { name: skill.name },
      );
    }
    if (skill.sourceInfo.scope === "temporary") {
      throw new SkillServiceError("skill-read-only", "Temporary skills are read-only.", {
        name: skill.name,
      });
    }

    const resourcePath = path.relative(baseDir, skill.filePath);
    if (!resourcePath || resourcePath === ".." || resourcePath.startsWith(`..${path.sep}`)) {
      throw new SkillServiceError(
        "skill-source-unavailable",
        "The skill source cannot be updated safely.",
        { name: skill.name },
      );
    }

    if (skill.sourceInfo.origin === "package") {
      const settings =
        skill.sourceInfo.scope === "project"
          ? settingsManager.getProjectSettings()
          : settingsManager.getGlobalSettings();
      const packages = (settings.packages ?? []).map(clonePackageSource);
      const packageIndex = packages.findIndex((entry) =>
        typeof entry === "string"
          ? entry === skill.sourceInfo.source
          : entry.source === skill.sourceInfo.source,
      );
      if (packageIndex < 0) {
        throw new SkillServiceError(
          "skill-source-unavailable",
          "The skill package configuration is unavailable.",
          { name: skill.name },
        );
      }
      const current = packages[packageIndex];
      const packageEntry = typeof current === "string" ? { source: current } : { ...current };
      packageEntry.skills = withResourceEnabled(packageEntry.skills ?? [], resourcePath, enabled);
      packages[packageIndex] = packageEntry;
      if (skill.sourceInfo.scope === "project") settingsManager.setProjectPackages(packages);
      else settingsManager.setPackages(packages);
    } else {
      const settings =
        skill.sourceInfo.scope === "project"
          ? settingsManager.getProjectSettings()
          : settingsManager.getGlobalSettings();
      const skills = withResourceEnabled(settings.skills ?? [], resourcePath, enabled);
      // Builtins are injected separately; enabling restores that default without duplicate discovery.
      if (skill.sourceInfo.source === "builtin" && enabled) skills.pop();
      if (skill.sourceInfo.scope === "project") settingsManager.setProjectSkillPaths(skills);
      else settingsManager.setSkillPaths(skills);
    }

    await settingsManager.flush();
    const settingsError = settingsManager.drainErrors()[0];
    if (settingsError) throw settingsError.error;
  }

  async list(request: SkillListPayload): Promise<SkillListValue> {
    const host = await this.getResourceHost(request);
    try {
      const records = await this.records(host);
      return {
        skills: records
          .filter(
            (skill) =>
              !("target" in request) ||
              !request.target ||
              skill.sourceInfo.scope === request.target.scope,
          )
          .map((skill) => ({
            name: skill.name,
            description: skill.description,
            enabled: skill.enabled,
            modelInvocable: !skill.disableModelInvocation,
            source: skill.sourceInfo.source,
            scope: skill.sourceInfo.scope,
            origin: skill.sourceInfo.origin,
            ...(skill.sourceInfo.origin === "package" &&
            isWorkbenchBuiltinPackage(skill.sourceInfo.source, skill.sourceInfo.scope)
              ? { packageBuiltin: true }
              : {}),
          })),
      };
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      throw new SkillServiceError(
        "internal",
        "The Skill resource catalog could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async describe(request: SkillDescribePayload): Promise<SkillDescribeValue> {
    const { name } = request;
    const host = await this.getResourceHost(request);
    const skill = await this.findSkill(host, request, name);

    try {
      const content = await this.dependencies.readSkillDocument(skill.filePath);
      if (Buffer.byteLength(content, "utf8") > MAX_SKILL_DOCUMENT_BYTES) {
        throw new SkillDocumentTooLargeError();
      }
      return { name: skill.name, content, filePath: skill.filePath };
    } catch (error) {
      if (error instanceof SkillDocumentTooLargeError) {
        throw new SkillServiceError(
          "skill-document-too-large",
          "The skill document is too large to display.",
          { name, maxBytes: MAX_SKILL_DOCUMENT_BYTES },
          { cause: error },
        );
      }
      throw new SkillServiceError(
        "internal",
        "The Skill document could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async setEnabled(request: SkillSetEnabledPayload): Promise<SkillSetEnabledValue> {
    const { name, enabled } = request;
    const initialHost = await this.getResourceHost(request);

    try {
      const skill = await this.findSkill(initialHost, request, name);
      const scope = this.mutationScope(initialHost, skill.sourceInfo.scope, name);
      return await this.mutateResourceHost(request, scope, async (host) => {
        const currentSkill = await this.findSkill(host, request, name);
        if (!sameSkillMutationIdentity(currentSkill, skill)) {
          throw new SkillServiceError("skill-not-found", "The skill identity changed.", {
            ...this.resourceIdentityDetails(request),
            name,
          });
        }
        if (currentSkill.enabled === enabled) {
          return { value: { name, enabled }, reload: false };
        }
        await this.persistSkillEnabled(host, currentSkill, enabled);
        return { value: { name, enabled }, reload: true };
      });
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      if (error instanceof PiResourceMutationBusyError) {
        throw new SkillServiceError(
          "session-busy",
          "A related session is currently running.",
          { sessionId: error.sessionId },
          { cause: error },
        );
      }
      if (error instanceof PiResourceMutationSessionUnavailableError) {
        throw new SkillServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: error.sessionId },
          { cause: error },
        );
      }
      throw new SkillServiceError(
        "skill-update-failed",
        "The skill state could not be updated.",
        { name },
        { cause: error },
      );
    }
  }

  async remove(request: SkillRemovePayload): Promise<SkillRemoveValue> {
    const { name } = request;
    const initialHost = await this.getResourceHost(request);

    try {
      const skill = await this.findSkill(initialHost, request, name);
      const scope = this.mutationScope(initialHost, skill.sourceInfo.scope, name);
      return await this.mutateResourceHost(request, scope, async (host) => {
        const currentSkill = await this.findSkill(host, request, name);
        if (!sameSkillMutationIdentity(currentSkill, skill)) {
          throw new SkillServiceError("skill-not-found", "The skill identity changed.", {
            ...this.resourceIdentityDetails(request),
            name,
          });
        }
        if (currentSkill.sourceInfo.origin === "package") {
          throw new SkillServiceError(
            "skill-package-managed",
            "Package-provided skills must be removed through the package manager.",
            { name, source: currentSkill.sourceInfo.source },
          );
        }
        if (
          currentSkill.sourceInfo.scope === "temporary" ||
          currentSkill.sourceInfo.source !== "auto" ||
          !currentSkill.sourceInfo.baseDir
        ) {
          throw new SkillServiceError("skill-read-only", "This skill source is read-only.", {
            name,
          });
        }
        const targetPath =
          path.basename(currentSkill.filePath).toLowerCase() === "skill.md"
            ? path.dirname(currentSkill.filePath)
            : currentSkill.filePath;
        const [canonicalBase, canonicalTarget] = await Promise.all([
          realpath(currentSkill.sourceInfo.baseDir),
          realpath(targetPath),
        ]);
        if (canonicalBase === canonicalTarget || !pathWithin(canonicalBase, canonicalTarget)) {
          throw new SkillServiceError(
            "skill-source-unavailable",
            "The skill deletion target is outside its source root.",
            { name },
          );
        }
        await this.dependencies.removeSkillPath(canonicalTarget);
        return { value: { name, removed: true }, reload: true };
      });
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      if (error instanceof PiResourceMutationBusyError) {
        throw new SkillServiceError(
          "session-busy",
          "A related session is currently running.",
          { sessionId: error.sessionId },
          { cause: error },
        );
      }
      if (error instanceof PiResourceMutationSessionUnavailableError) {
        throw new SkillServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: error.sessionId },
          { cause: error },
        );
      }
      throw new SkillServiceError(
        "skill-remove-failed",
        "The skill could not be removed.",
        { name },
        { cause: error },
      );
    }
  }

  async listFiles(request: SkillFilesListPayload): Promise<SkillFilesListValue> {
    const { name, relativePath = "" } = request;
    const host = await this.getResourceHost(request);
    const skill = await this.findSkill(host, request, name);

    try {
      const rootPath = await realpath(path.dirname(skill.filePath));
      const requestedPath = path.resolve(rootPath, relativePath);
      if (!pathWithin(rootPath, requestedPath)) {
        throw new SkillServiceError(
          "skill-directory-unreadable",
          "The requested directory is outside the skill root.",
          { name },
        );
      }
      const canonicalPath = await realpath(requestedPath);
      if (!pathWithin(rootPath, canonicalPath) || !(await stat(canonicalPath)).isDirectory()) {
        throw new Error("The requested path is not a readable skill directory.");
      }
      const directoryEntries = await readdir(canonicalPath, { withFileTypes: true });
      const entries: SkillFilesListValue["entries"] = [];
      for (const entry of directoryEntries) {
        const entryPath = path.join(canonicalPath, entry.name);
        const symbolicLink = entry.isSymbolicLink();
        let kind: "file" | "directory";
        if (symbolicLink) {
          const canonicalEntry = await realpath(entryPath);
          if (!pathWithin(rootPath, canonicalEntry)) continue;
          kind = (await stat(canonicalEntry)).isDirectory() ? "directory" : "file";
        } else if (entry.isDirectory()) kind = "directory";
        else if (entry.isFile()) kind = "file";
        else continue;
        entries.push({
          name: entry.name,
          relativePath: relativeDisplayPath(rootPath, entryPath),
          kind,
          hidden: entry.name.startsWith("."),
          ...(symbolicLink ? { symbolicLink: true } : {}),
        });
        if (entries.length > SKILL_DIRECTORY_ENTRY_LIMIT) break;
      }
      entries.sort(compareDirectoryEntries);
      return {
        name: skill.name,
        rootPath,
        relativePath: relativeDisplayPath(rootPath, canonicalPath),
        entries: entries.slice(0, SKILL_DIRECTORY_ENTRY_LIMIT),
        truncated: entries.length > SKILL_DIRECTORY_ENTRY_LIMIT,
      };
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      throw new SkillServiceError(
        "skill-directory-unreadable",
        "The skill directory could not be read.",
        { name },
        { cause: error },
      );
    }
  }

  async readFile(request: SkillFileReadPayload): Promise<SkillFileSnapshotValue> {
    const { name, relativePath: requestedRelativePath } = request;
    const host = await this.getResourceHost(request);
    const skill = await this.findSkill(host, request, name);
    const relativePath = normalizeSkillRelativePath(name, requestedRelativePath);

    try {
      const rootPath = await realpath(path.dirname(skill.filePath));
      const absolutePath = path.join(rootPath, ...relativePath.split("/"));
      if (!pathWithin(rootPath, absolutePath)) {
        throw new SkillServiceError(
          "skill-file-unreadable",
          "The requested file is outside the Skill root.",
          { name, relativePath },
        );
      }
      const canonicalPath = await realpath(absolutePath);
      if (!pathWithin(rootPath, canonicalPath) || !(await stat(canonicalPath)).isFile()) {
        throw new SkillServiceError(
          "skill-file-unreadable",
          "The requested path is not a readable Skill file.",
          { name, relativePath },
        );
      }
      const file = await readResourceTextFile(canonicalPath, MAX_SKILL_FILE_BYTES);
      return {
        skillName: skill.name,
        rootPath,
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
      if (error instanceof SkillServiceError) throw error;
      if (error instanceof ResourceTextFileTooLargeError) {
        throw new SkillServiceError(
          "skill-file-too-large",
          "The Skill file is too large to display.",
          { name, relativePath, maxBytes: MAX_SKILL_FILE_BYTES },
          { cause: error },
        );
      }
      if (error instanceof ResourceTextFileUnsupportedEncodingError) {
        throw new SkillServiceError(
          "skill-file-unsupported-encoding",
          "The Skill file is not supported as UTF-8 text.",
          { name, relativePath },
          { cause: error },
        );
      }
      throw new SkillServiceError(
        "skill-file-unreadable",
        "The Skill file could not be read.",
        { name, relativePath },
        { cause: error },
      );
    }
  }
}
