import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";

export interface AutomationErrorDetails {
  "automation-not-found": { automationId: string };
  "automation-conflict": { automationId: string; currentRevision: number };
  "automation-invalid": { field: string; reason: string };
  "automation-workspace-not-found": { workspaceId: string };
  "automation-workspace-not-trusted": { workspaceId: string };
  "automation-launch-failed": { automationId: string; reason: string };
  "automation-session-active": { automationId: string; sessionId: string };
}

export type AutomationErrorCode = keyof AutomationErrorDetails;

export class AutomationError<
  Code extends AutomationErrorCode = AutomationErrorCode,
> extends RpcDomainError<Code, AutomationErrorDetails[Code]> {
  readonly code: Code;
  readonly details: AutomationErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: AutomationErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutomationError";
    this.code = code;
    this.details = details;
  }
}
