import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONFIG_DIR_NAME,
  DefaultPackageManager,
  getAgentDir,
  parseFrontmatter,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import type {
  PiResourceCatalogTarget,
  PromptDescribePayload,
  PromptDescribeValue,
  PromptExpandPayload,
  PromptExpandValue,
  PromptListPayload,
  PromptListValue,
  PromptRemovePayload,
  PromptSavePayload,
  PromptSetEnabledPayload,
  PromptTemplateView,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";
import { RpcDomainError, isRpcDomainError } from "@workbench/server-core/rpc-domain-error";
import { expandPromptTemplateContent } from "../commands/prompt-template-expander";
import {
  clonePackageSource,
  pathWithin,
  withResourceEnabled,
} from "../resources/resource-mutations";
import {
  getPiResourceMutationCoordinator,
  PiResourceMutationBusyError,
  type PiResourceMutationCoordinator,
} from "../resources/pi-resource-mutation-coordinator";
import {
  getScopedResourceContextService,
  type ScopedResourceContext,
  type ScopedResourceContextService,
} from "../resources/scoped-resource-context";
import { readResourceTextFile } from "../resources/resource-text-file";
import { getProjectTrustService } from "../trust/project-trust-service";

export const MAX_PROMPT_BYTES = 256 * 1024;
export const PROMPT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/u;

export interface PromptServiceDependencies {
  scopedResources: Pick<ScopedResourceContextService, "get" | "invalidate">;
  mutationCoordinator: PiResourceMutationCoordinator;
  agentDir(): string;
  isProjectTrusted(cwd: string): boolean | Promise<boolean>;
}

export interface PromptCatalogProtocol {
  list(payload: PromptListPayload): Promise<PromptListValue>;
  describe(payload: PromptDescribePayload): Promise<PromptDescribeValue>;
  save(payload: PromptSavePayload): Promise<PromptDescribeValue>;
  remove(payload: PromptRemovePayload): Promise<{ removed: true }>;
  setEnabled(payload: PromptSetEnabledPayload): Promise<{ enabled: boolean }>;
  expand(payload: PromptExpandPayload): Promise<PromptExpandValue>;
}

export class PromptServiceError extends RpcDomainError {
  readonly details = {};
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "PromptServiceError";
  }
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function resourceId(resource: ResolvedResource): string {
  return hash(JSON.stringify([resource.path, resource.metadata]));
}

function promptDocument(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_PROMPT_BYTES || content.includes("\0")) {
    throw new PromptServiceError("prompt-invalid-content");
  }
  let parsed;
  try {
    parsed = parseFrontmatter<Record<string, unknown>>(content);
  } catch {
    throw new PromptServiceError("prompt-invalid-content");
  }
  if (
    typeof parsed.frontmatter !== "object" ||
    parsed.frontmatter === null ||
    Array.isArray(parsed.frontmatter)
  )
    throw new PromptServiceError("prompt-invalid-content");
  for (const field of ["description", "argument-hint"]) {
    if (parsed.frontmatter[field] !== undefined && typeof parsed.frontmatter[field] !== "string") {
      throw new PromptServiceError("prompt-invalid-content");
    }
  }
  return parsed;
}

/** Pi owns discovery and resource filters; this service only manages resolved Markdown files. */
export class PromptService implements PromptCatalogProtocol {
  private readonly dependencies: PromptServiceDependencies;
  constructor(dependencies: Partial<PromptServiceDependencies> = {}) {
    this.dependencies = {
      scopedResources: getScopedResourceContextService(),
      mutationCoordinator: getPiResourceMutationCoordinator(),
      agentDir: getAgentDir,
      isProjectTrusted: (cwd) => getProjectTrustService().isTrusted(cwd),
      ...dependencies,
    };
  }

  private async context(target: PiResourceCatalogTarget): Promise<ScopedResourceContext> {
    const context = await this.dependencies.scopedResources.get(target);
    if (target.scope === "project" && !(await this.dependencies.isProjectTrusted(context.cwd))) {
      throw new PromptServiceError("project-untrusted");
    }
    return context;
  }

  private configDirectory(context: ScopedResourceContext): string {
    return context.target.scope === "project"
      ? path.join(context.cwd, CONFIG_DIR_NAME)
      : this.dependencies.agentDir();
  }

  private async resources(context: ScopedResourceContext): Promise<ResolvedResource[]> {
    await context.settingsManager.reload();
    const manager = new DefaultPackageManager({
      cwd: context.cwd,
      agentDir: this.dependencies.agentDir(),
      settingsManager: context.settingsManager,
    });
    return (await manager.resolve(async () => "skip")).prompts.filter(
      (resource) => resource.metadata.scope === context.target.scope,
    );
  }

  private async find(context: ScopedResourceContext, id: string): Promise<ResolvedResource> {
    const resource = (await this.resources(context)).find((item) => resourceId(item) === id);
    if (!resource) throw new PromptServiceError("prompt-not-found");
    return resource;
  }

  private async canonicalFile(resource: ResolvedResource): Promise<string> {
    const base = resource.metadata.baseDir;
    if (!base) throw new PromptServiceError("prompt-read-only");
    const [root, file] = await Promise.all([realpath(base), realpath(resource.path)]);
    if (file === root || !pathWithin(root, file)) throw new PromptServiceError("prompt-read-only");
    return file;
  }

  private async editable(
    context: ScopedResourceContext,
    resource: ResolvedResource,
  ): Promise<boolean> {
    if (resource.metadata.origin !== "top-level" || resource.metadata.source !== "auto")
      return false;
    try {
      if ((await lstat(resource.path)).isSymbolicLink()) return false;
      const config = await realpath(this.configDirectory(context));
      const root = await realpath(path.join(config, "prompts"));
      const file = await this.canonicalFile(resource);
      return (
        pathWithin(config, root) &&
        file !== root &&
        pathWithin(root, file) &&
        (context.target.scope !== "project" || pathWithin(await realpath(context.cwd), config))
      );
    } catch {
      return false;
    }
  }

  private async snapshot(
    context: ScopedResourceContext,
    resource: ResolvedResource,
  ): Promise<PromptDescribeValue> {
    const filePath = await this.canonicalFile(resource);
    const { content } = await readResourceTextFile(filePath, MAX_PROMPT_BYTES);
    const { frontmatter, body } = promptDocument(content);
    const name = path.basename(resource.path, ".md");
    const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : firstLine.slice(0, 60) + (firstLine.length > 60 ? "..." : "");
    return {
      id: resourceId(resource),
      kind: "prompt",
      name,
      invocationName: name,
      effect: "prompt-transform",
      exclusive: false,
      description,
      ...(typeof frontmatter["argument-hint"] === "string"
        ? { argumentHint: frontmatter["argument-hint"] }
        : {}),
      source: resource.metadata.source,
      scope: resource.metadata.scope,
      origin: resource.metadata.origin,
      enabled: resource.enabled,
      editable: await this.editable(context, resource),
      content,
      filePath,
      version: hash(content),
    };
  }

  async list({ target }: PromptListPayload): Promise<PromptListValue> {
    const context = await this.context(target);
    const prompts: PromptTemplateView[] = [];
    for (const resource of await this.resources(context)) {
      try {
        const {
          content: _content,
          filePath: _filePath,
          version: _version,
          ...view
        } = await this.snapshot(context, resource);
        prompts.push(view);
      } catch {
        // Match Pi discovery: unreadable or invalid Markdown is not an available template.
      }
    }
    return { prompts };
  }

  async describe({ target, id }: PromptDescribePayload): Promise<PromptDescribeValue> {
    const context = await this.context(target);
    return this.snapshot(context, await this.find(context, id));
  }

  async expand(payload: PromptExpandPayload): Promise<PromptExpandValue> {
    const template = await this.describe(payload);
    if (!template.enabled) throw new PromptServiceError("prompt-disabled");
    try {
      return {
        content: expandPromptTemplateContent(
          promptDocument(template.content).body,
          payload.arguments,
          1024 * 1024,
        ),
      };
    } catch {
      throw new PromptServiceError("prompt-invalid-content");
    }
  }

  private async mutate<Value>(
    target: PiResourceCatalogTarget,
    operation: (context: ScopedResourceContext) => Promise<Value>,
  ): Promise<Value> {
    const initial = await this.context(target);
    const scope =
      target.scope === "user"
        ? { scope: "user" as const }
        : { scope: "project" as const, cwd: initial.cwd };
    try {
      return await this.dependencies.mutationCoordinator.mutate(scope, async () => {
        const context = await this.context(target);
        const config = this.configDirectory(context);
        await mkdir(config, { recursive: true });
        const canonical = await realpath(config);
        if (target.scope === "project" && !pathWithin(await realpath(context.cwd), canonical)) {
          throw new PromptServiceError("prompt-read-only");
        }
        const value = await withCrossProcessFileLock(
          { lockDirectory: path.join(canonical, ".workbench-prompts-lock") },
          () => operation(context),
        );
        // Invalidate even if a later live-session reload fails: disk remains authoritative.
        this.dependencies.scopedResources.invalidate(target.scope === "user" ? undefined : target);
        return { value, reload: true };
      });
    } catch (error) {
      if (isRpcDomainError(error)) throw error;
      if (error instanceof PiResourceMutationBusyError)
        throw new PromptServiceError("session-busy");
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
        throw new PromptServiceError("prompt-name-exists");
      throw new PromptServiceError("prompt-update-failed");
    }
  }

  async save(payload: PromptSavePayload): Promise<PromptDescribeValue> {
    if (
      !PROMPT_NAME_PATTERN.test(payload.name) ||
      !payload.content.trim() ||
      Boolean(payload.id) !== Boolean(payload.version)
    ) {
      throw new PromptServiceError("prompt-invalid-content");
    }
    promptDocument(payload.content);
    const resource = await this.mutate(payload.target, async (context) => {
      if (payload.id) {
        const existing = await this.find(context, payload.id);
        const snapshot = await this.snapshot(context, existing);
        if (!snapshot.editable) throw new PromptServiceError("prompt-read-only");
        if (snapshot.version !== payload.version) throw new PromptServiceError("prompt-conflict");
        if (snapshot.name !== payload.name) throw new PromptServiceError("prompt-invalid-content");
        await atomicReplaceFile(snapshot.filePath, payload.content);
        return existing;
      }
      if (
        (await this.resources(context)).some(
          (item) => path.basename(item.path, ".md") === payload.name,
        )
      ) {
        throw new PromptServiceError("prompt-name-exists");
      }
      const config = await realpath(this.configDirectory(context));
      const root = path.join(config, "prompts");
      await mkdir(root, { recursive: true });
      const canonical = await realpath(root);
      if (!pathWithin(config, canonical)) throw new PromptServiceError("prompt-read-only");
      const file = path.join(canonical, `${payload.name}.md`);
      await writeFile(file, payload.content, { flag: "wx", mode: 0o600 });
      const created = (await this.resources(context)).find(
        (item) =>
          item.path === path.join(this.configDirectory(context), "prompts", `${payload.name}.md`),
      );
      if (!created) throw new PromptServiceError("prompt-update-failed");
      await this.persistEnabled(context, created, true);
      return created;
    });
    return this.describe({ target: payload.target, id: resourceId(resource) });
  }

  async remove(payload: PromptRemovePayload): Promise<{ removed: true }> {
    return this.mutate(payload.target, async (context) => {
      const resource = await this.find(context, payload.id);
      const template = await this.snapshot(context, resource);
      if (!template.editable) throw new PromptServiceError("prompt-read-only");
      if (template.version !== payload.version) throw new PromptServiceError("prompt-conflict");
      await unlink(template.filePath);
      return { removed: true };
    });
  }

  private async persistEnabled(
    context: ScopedResourceContext,
    resource: ResolvedResource,
    enabled: boolean,
  ): Promise<void> {
    const { settingsManager, target } = context;
    const base = resource.metadata.baseDir;
    if (!base || !pathWithin(base, resource.path)) throw new PromptServiceError("prompt-read-only");
    const relative = path.relative(base, resource.path).split(path.sep).join("/");
    const settings =
      target.scope === "project"
        ? settingsManager.getProjectSettings()
        : settingsManager.getGlobalSettings();
    if (resource.metadata.origin === "package") {
      const packages = (settings.packages ?? []).map(clonePackageSource);
      const index = packages.findIndex(
        (entry) => (typeof entry === "string" ? entry : entry.source) === resource.metadata.source,
      );
      if (index < 0) throw new PromptServiceError("prompt-not-found");
      const current = packages[index];
      const entry = typeof current === "string" ? { source: current } : current;
      entry.prompts = withResourceEnabled(entry.prompts ?? [], relative, enabled);
      packages[index] = entry;
      if (target.scope === "project") settingsManager.setProjectPackages(packages);
      else settingsManager.setPackages(packages);
    } else {
      const prompts = withResourceEnabled(settings.prompts ?? [], relative, enabled);
      if (target.scope === "project") settingsManager.setProjectPromptTemplatePaths(prompts);
      else settingsManager.setPromptTemplatePaths(prompts);
    }
    await settingsManager.flush();
    const failure = settingsManager.drainErrors()[0];
    if (failure) throw failure.error;
  }

  async setEnabled(payload: PromptSetEnabledPayload): Promise<{ enabled: boolean }> {
    return this.mutate(payload.target, async (context) => {
      const resource = await this.find(context, payload.id);
      await this.canonicalFile(resource);
      await this.persistEnabled(context, resource, payload.enabled);
      return { enabled: payload.enabled };
    });
  }
}
