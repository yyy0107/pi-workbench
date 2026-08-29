import { RpcDomainError } from "@/runtime/server/rpc-domain-error";
import type { WorkflowRunStatus } from "@/runtime/shared/execution";

export interface ExecutionErrorDetails {
  "workflow-not-found": { workflowId: string };
  "agent-not-found": { workflowId: string; agentId: string };
  "workflow-conflict": { workflowId: string; currentDraftRevision: number };
  "revision-conflict": { workflowId: string; publishedRevisionId?: string };
  "workflow-invalid": { workflowId: string; issues: unknown[] };
  "revision-not-found": { workflowId: string; revisionId: string };
  "run-not-found": { runId: string };
  "run-active": { runId: string; status: WorkflowRunStatus };
  "approval-not-found": { runId: string; nodeId: string };
  "workspace-required": { workflowId: string };
  "workspace-not-found": { workspaceId: string };
  "workspace-not-trusted": { workspaceId: string };
  "agent-workspace-not-trusted": { agentId: string };
  "cwd-outside-workspace": { workspaceId: string; relativeCwd: string };
  "workflow-not-published": { workflowId: string };
  "command-rejected": { runId: string; nodeId: string; reason: string };
  "workflow-run-skipped": { workflowId: string; activeRunId: string };
  "prompt-template-not-found": { agentId: string; promptTemplate: string };
  "structured-output-missing": { agentId: string; nodeId: string };
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
