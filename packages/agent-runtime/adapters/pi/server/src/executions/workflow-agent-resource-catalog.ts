import path from "node:path";

import {
  DefaultPackageManager,
  getAgentDir,
  loadSkills,
  SettingsManager,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";

import type {
  WorkflowAgentResourceCatalog,
  WorkflowAgentSkillResource,
} from "@workbench/execution-contracts";

export interface PiWorkflowAgentResourceCatalogOptions {
  agentDir?: string;
  isWorkspaceTrusted(workspacePath: string): boolean | Promise<boolean>;
}

export interface PiWorkflowAgentResourceCatalogInput {
  workflowId: string;
  agentId: string;
  workspacePath: string;
}

function extensionName(filePath: string): string {
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return stem === "index" ? path.basename(path.dirname(filePath)) : stem;
}

function compareResourceNames(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" });
}

function displaySource(resource: ResolvedResource): string {
  const source = resource.metadata.source;
  if (resource.metadata.origin === "top-level" || source === "auto" || source === "local") {
    return source;
  }
  if (
    path.isAbsolute(source) ||
    source.startsWith(".") ||
    source.startsWith("~") ||
    source.startsWith("file:")
  ) {
    const localPath = source.replace(/^file:/u, "");
    return path.basename(localPath) || "local";
  }
  return source;
}

function readSkill(
  resource: ResolvedResource,
  workspacePath: string,
  agentDir: string,
): WorkflowAgentSkillResource | undefined {
  const skill = loadSkills({
    cwd: workspacePath,
    agentDir,
    skillPaths: [resource.path],
    includeDefaults: false,
  }).skills.at(0);
  if (!skill) return undefined;
  return {
    name: skill.name,
    description: skill.description,
    modelInvocable: !skill.disableModelInvocation,
    source: displaySource(resource),
    scope: resource.metadata.scope,
    origin: resource.metadata.origin,
  };
}

/**
 * Projects the effective Pi resources for one Workflow Agent without creating an AgentSession or
 * executing extension modules. The catalog follows Pi's package/settings filters and exposes only
 * serializable display metadata to the browser.
 */
export class PiWorkflowAgentResourceCatalog {
  private readonly agentDir: string;
  private readonly isWorkspaceTrusted: PiWorkflowAgentResourceCatalogOptions["isWorkspaceTrusted"];

  constructor(options: PiWorkflowAgentResourceCatalogOptions) {
    this.agentDir = options.agentDir ?? getAgentDir();
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
  }

  async read(input: PiWorkflowAgentResourceCatalogInput): Promise<WorkflowAgentResourceCatalog> {
    const projectResourcesTrusted = await this.isWorkspaceTrusted(input.workspacePath);
    try {
      const settingsManager = SettingsManager.create(input.workspacePath, this.agentDir, {
        projectTrusted: projectResourcesTrusted,
      });
      const packageManager = new DefaultPackageManager({
        cwd: input.workspacePath,
        agentDir: this.agentDir,
        settingsManager,
      });
      const resources = await packageManager.resolve(async () => "skip");
      const skillNames = new Set<string>();
      const skills: WorkflowAgentSkillResource[] = [];
      for (const resource of resources.skills) {
        if (!resource.enabled) continue;
        const skill = readSkill(resource, input.workspacePath, this.agentDir);
        if (!skill || skillNames.has(skill.name)) continue;
        skillNames.add(skill.name);
        skills.push(skill);
      }

      const extensions = resources.extensions
        .filter((resource) => resource.enabled)
        .map((resource) => ({
          name: extensionName(resource.path),
          source: displaySource(resource),
          scope: resource.metadata.scope,
          origin: resource.metadata.origin,
        }))
        .sort(compareResourceNames);

      return {
        skills: skills.sort(compareResourceNames),
        extensions,
        catalogAvailable: true,
        projectResourcesTrusted,
      };
    } catch (error) {
      console.error("[workbench-pi] workflow Agent resource catalog failed", {
        workflowId: input.workflowId,
        agentId: input.agentId,
        error,
      });
      return {
        skills: [],
        extensions: [],
        catalogAvailable: false,
        projectResourcesTrusted,
      };
    }
  }
}
