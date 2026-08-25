import { createHash } from "node:crypto";
import { open, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
  type PackageSource,
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
  SkillRemovePayload,
  SkillRemoveValue,
  SkillSetEnabledPayload,
  SkillSetEnabledValue,
} from "../../rpc-contracts";
import { getOrStartSession } from "../sessions/session-registry";

export const MAX_SKILL_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;
const SKILL_DOCUMENT_READ_CHUNK_BYTES = 64 * 1024;
const SKILL_DIRECTORY_ENTRY_LIMIT = 2_000;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

class SkillDocumentTooLargeError extends Error {}
class SkillFileTooLargeError extends Error {}
class SkillFileUnsupportedEncodingError extends Error {}

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

async function readSkillFileContent(filePath: string): Promise<{
  content: string;
  bytes: Buffer;
  modifiedAt: number;
}> {
  const file = await open(filePath, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("The requested Skill path is not a regular file.");
    if (metadata.size > MAX_SKILL_FILE_BYTES) throw new SkillFileTooLargeError();

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_SKILL_FILE_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(SKILL_DOCUMENT_READ_CHUNK_BYTES, MAX_SKILL_FILE_BYTES + 1 - totalBytes),
      );
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_SKILL_FILE_BYTES) throw new SkillFileTooLargeError();
      chunks.push(buffer.subarray(0, bytesRead));
    }

    const bytes = Buffer.concat(chunks, totalBytes);
    if (bytes.includes(0)) throw new SkillFileUnsupportedEncodingError();
    try {
      return {
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        bytes,
        modifiedAt: metadata.mtimeMs,
      };
    } catch {
      throw new SkillFileUnsupportedEncodingError();
    }
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
  getSession(sessionId: string): Promise<SkillSessionHost>;
  readSkillDocument(filePath: string): Promise<string>;
  removeSkillPath(targetPath: string): Promise<void>;
}

export interface SkillServiceErrorDetails {
  "session-not-found": { sessionId: string };
  "session-busy": { sessionId: string };
  "skill-not-found": { sessionId: string; name: string };
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
> extends Error {
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

function patternTarget(pattern: string): string {
  return /^[!+-]/.test(pattern) ? pattern.slice(1) : pattern;
}

function withResourceEnabled(
  current: readonly string[],
  resourcePath: string,
  enabled: boolean,
): string[] {
  return [
    ...current.filter((pattern) => patternTarget(pattern) !== resourcePath),
    `${enabled ? "+" : "-"}${resourcePath}`,
  ];
}

function clonePackageSource(source: PackageSource): PackageSource {
  if (typeof source === "string") return source;
  return {
    ...source,
    ...(source.extensions ? { extensions: [...source.extensions] } : {}),
    ...(source.skills ? { skills: [...source.skills] } : {}),
    ...(source.prompts ? { prompts: [...source.prompts] } : {}),
    ...(source.themes ? { themes: [...source.themes] } : {}),
  };
}

function pathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
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

export class SkillService {
  private readonly dependencies: SkillServiceDependencies;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: Partial<SkillServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      readSkillDocument,
      removeSkillPath: (targetPath) => rm(targetPath, { recursive: true }),
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
    return records;
  }

  private async findSkill(
    host: SkillSessionHost,
    sessionId: string,
    name: string,
  ): Promise<SkillRecord> {
    const skill = (await this.records(host)).find((candidate) => candidate.name === name);
    if (skill) return skill;
    throw new SkillServiceError("skill-not-found", "The skill is unavailable in this session.", {
      sessionId,
      name,
    });
  }

  private assertMutableSession(host: SkillSessionHost, sessionId: string): void {
    if (!host.isRunning) return;
    throw new SkillServiceError("session-busy", "The session is currently running.", {
      sessionId,
    });
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
      if (skill.sourceInfo.scope === "project") settingsManager.setProjectSkillPaths(skills);
      else settingsManager.setSkillPaths(skills);
    }

    await settingsManager.flush();
    const settingsError = settingsManager.drainErrors()[0];
    if (settingsError) throw settingsError.error;
    await host.session.reload?.();
  }

  async list({ sessionId }: SkillListPayload): Promise<SkillListValue> {
    const host = await this.getSessionHost(sessionId);
    try {
      return {
        skills: (await this.records(host)).map((skill) => ({
          name: skill.name,
          description: skill.description,
          enabled: skill.enabled,
          modelInvocable: !skill.disableModelInvocation,
          source: skill.sourceInfo.source,
          scope: skill.sourceInfo.scope,
          origin: skill.sourceInfo.origin,
        })),
      };
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      throw new SkillServiceError(
        "internal",
        "The session skills could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async describe({ sessionId, name }: SkillDescribePayload): Promise<SkillDescribeValue> {
    const host = await this.getSessionHost(sessionId);
    const skill = await this.findSkill(host, sessionId, name);

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
        "The session skill document could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async setEnabled({
    sessionId,
    name,
    enabled,
  }: SkillSetEnabledPayload): Promise<SkillSetEnabledValue> {
    const host = await this.getSessionHost(sessionId);

    try {
      return await this.serializeMutation(async () => {
        this.assertMutableSession(host, sessionId);
        const skill = await this.findSkill(host, sessionId, name);
        if (skill.enabled === enabled) return { name, enabled };
        await this.persistSkillEnabled(host, skill, enabled);
        return { name, enabled };
      });
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      throw new SkillServiceError(
        "skill-update-failed",
        "The skill state could not be updated.",
        { name },
        { cause: error },
      );
    }
  }

  async remove({ sessionId, name }: SkillRemovePayload): Promise<SkillRemoveValue> {
    const host = await this.getSessionHost(sessionId);

    try {
      return await this.serializeMutation(async () => {
        this.assertMutableSession(host, sessionId);
        const skill = await this.findSkill(host, sessionId, name);
        if (skill.sourceInfo.origin === "package") {
          throw new SkillServiceError(
            "skill-package-managed",
            "Package-provided skills must be removed through the package manager.",
            { name, source: skill.sourceInfo.source },
          );
        }
        if (
          skill.sourceInfo.scope === "temporary" ||
          skill.sourceInfo.source !== "auto" ||
          !skill.sourceInfo.baseDir
        ) {
          throw new SkillServiceError("skill-read-only", "This skill source is read-only.", {
            name,
          });
        }
        const targetPath =
          path.basename(skill.filePath).toLowerCase() === "skill.md"
            ? path.dirname(skill.filePath)
            : skill.filePath;
        const [canonicalBase, canonicalTarget] = await Promise.all([
          realpath(skill.sourceInfo.baseDir!),
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
        await host.session.reload?.();
        return { name, removed: true };
      });
    } catch (error) {
      if (error instanceof SkillServiceError) throw error;
      throw new SkillServiceError(
        "skill-remove-failed",
        "The skill could not be removed.",
        { name },
        { cause: error },
      );
    }
  }

  async listFiles({
    sessionId,
    name,
    relativePath = "",
  }: SkillFilesListPayload): Promise<SkillFilesListValue> {
    const host = await this.getSessionHost(sessionId);
    const skill = await this.findSkill(host, sessionId, name);

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

  async readFile({
    sessionId,
    name,
    relativePath: requestedRelativePath,
  }: SkillFileReadPayload): Promise<SkillFileSnapshotValue> {
    const host = await this.getSessionHost(sessionId);
    const skill = await this.findSkill(host, sessionId, name);
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
      const file = await readSkillFileContent(canonicalPath);
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
      if (error instanceof SkillFileTooLargeError) {
        throw new SkillServiceError(
          "skill-file-too-large",
          "The Skill file is too large to display.",
          { name, relativePath, maxBytes: MAX_SKILL_FILE_BYTES },
          { cause: error },
        );
      }
      if (error instanceof SkillFileUnsupportedEncodingError) {
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
