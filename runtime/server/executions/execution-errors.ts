import { RpcDomainError } from "@/runtime/server/rpc-domain-error";

export interface ExecutionErrorDetails {
  "workflow-not-found": { workflowId: string };
  "workflow-conflict": { workflowId: string; currentDraftRevision: number };
  "revision-conflict": { workflowId: string; publishedRevisionId?: string };
  "workflow-invalid": { workflowId: string; issues: unknown[] };
  "revision-not-found": { workflowId: string; revisionId: string };
  "run-not-found": { runId: string };
  "approval-not-found": { runId: string; nodeId: string };
  "workspace-required": { workflowId: string };
  "workspace-not-found": { workspaceId: string };
  "workspace-not-trusted": { workspaceId: string };
  "cwd-outside-workspace": { workspaceId: string; relativeCwd: string };
  "workflow-not-published": { workflowId: string };
  "trigger-not-found": { workflowId: string; triggerId: string };
  "trigger-invalid": { workflowId: string; triggerId: string; reason: string };
  "command-rejected": { runId: string; nodeId: string; reason: string };
  "workflow-run-skipped": { workflowId: string; activeRunId: string };
}

export type ExecutionErrorCode = keyof ExecutionErrorDetails;

export class ExecutionError<
  Code extends ExecutionErrorCode = ExecutionErrorCode,
> extends RpcDomainError<Code, ExecutionErrorDetails[Code]> {
  readonly code: Code;
  readonly details: ExecutionErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: ExecutionErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExecutionError";
    this.code = code;
    this.details = details;
  }
}
