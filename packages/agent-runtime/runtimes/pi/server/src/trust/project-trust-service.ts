import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type {
  ProjectTrustDescribePayload,
  ProjectTrustDescribeValue,
  ProjectTrustUpdatePayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import { validateWorkspace } from "../workspaces/workspace-paths";

export interface ProjectTrustServiceErrorDetails {
  "project-trust-invalid-path": { path: string };
  "project-trust-read-failed": { path: string };
  "project-trust-write-failed": { path: string };
}

export type ProjectTrustServiceErrorCode = keyof ProjectTrustServiceErrorDetails;

export class ProjectTrustServiceError<
  Code extends ProjectTrustServiceErrorCode = ProjectTrustServiceErrorCode,
> extends RpcDomainError<Code, ProjectTrustServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: ProjectTrustServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: ProjectTrustServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectTrustServiceError";
    this.code = code;
    this.details = details;
  }
}

export interface ProjectTrustServiceOptions {
  agentDir?: string;
  trustOverride?: () => boolean;
}

/** Project-trust decision capabilities exposed to transport. */
export interface ProjectTrustProtocol {
  describe(payload: ProjectTrustDescribePayload): ProjectTrustDescribeValue;
  update(payload: ProjectTrustUpdatePayload): ProjectTrustDescribeValue;
}

export class ProjectTrustService implements ProjectTrustProtocol {
  private readonly agentDir: string;
  private readonly trustStore: ProjectTrustStore;
  private readonly trustOverride: () => boolean;

  constructor(options: ProjectTrustServiceOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir();
    this.trustStore = new ProjectTrustStore(this.agentDir);
    this.trustOverride =
      options.trustOverride ?? (() => process.env.PI_WORKBENCH_TRUST_PROJECT === "1");
  }

  private canonicalPath(requestedPath: string): string {
    try {
      return validateWorkspace(requestedPath).cwd;
    } catch (error) {
      throw new ProjectTrustServiceError(
        "project-trust-invalid-path",
        "The project trust path is invalid.",
        { path: requestedPath },
        { cause: error },
      );
    }
  }

  describe({ path }: ProjectTrustDescribePayload): ProjectTrustDescribeValue {
    const canonicalPath = this.canonicalPath(path);

    try {
      const requiresTrust = hasTrustRequiringProjectResources(canonicalPath);
      if (this.trustOverride() || !requiresTrust) {
        return {
          path: canonicalPath,
          requiresTrust,
          trusted: true,
          promptRequired: false,
        };
      }

      const saved = this.trustStore.getEntry(canonicalPath);
      if (saved) {
        return {
          path: canonicalPath,
          requiresTrust,
          trusted: saved.decision,
          promptRequired: false,
          decisionPath: saved.path,
        };
      }

      const defaultProjectTrust = SettingsManager.create(canonicalPath, this.agentDir, {
        projectTrusted: false,
      }).getDefaultProjectTrust();
      const trusted =
        defaultProjectTrust === "always" ? true : defaultProjectTrust === "never" ? false : null;
      return {
        path: canonicalPath,
        requiresTrust,
        trusted,
        promptRequired: trusted === null,
      };
    } catch (error) {
      if (error instanceof ProjectTrustServiceError) throw error;
      throw new ProjectTrustServiceError(
        "project-trust-read-failed",
        "The project trust decision could not be read.",
        { path: canonicalPath },
        { cause: error },
      );
    }
  }

  update({ path, trusted }: ProjectTrustUpdatePayload): ProjectTrustDescribeValue {
    const canonicalPath = this.canonicalPath(path);
    try {
      this.trustStore.set(canonicalPath, trusted);
    } catch (error) {
      throw new ProjectTrustServiceError(
        "project-trust-write-failed",
        "The project trust decision could not be saved.",
        { path: canonicalPath },
        { cause: error },
      );
    }
    return this.describe({ path: canonicalPath });
  }

  isTrusted(path: string): boolean {
    return this.describe({ path }).trusted === true;
  }
}

export function getProjectTrustService(): ProjectTrustService {
  return new ProjectTrustService();
}
