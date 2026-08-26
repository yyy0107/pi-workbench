import { PiApiError } from "../transport/api";

export type PiRequestErrorKind =
  | "empty-prompt"
  | "invalid-working-directory"
  | "invalid-workspace"
  | "model-not-available"
  | "session-busy"
  | "session-not-found";

const ERROR_KIND_BY_CODE = {
  "agent-busy": "session-busy",
  "model-unavailable": "model-not-available",
  "session-not-found": "session-not-found",
  "workspace-attach-failed": "invalid-workspace",
  "workspace-invalid-path": "invalid-workspace",
  "workspace-not-found": "invalid-workspace",
  pi_empty_prompt: "empty-prompt",
  pi_invalid_working_directory: "invalid-working-directory",
  pi_invalid_workspace: "invalid-workspace",
  pi_model_not_available: "model-not-available",
  pi_session_busy: "session-busy",
  pi_session_not_found: "session-not-found",
  pi_workspace_not_directory: "invalid-workspace",
  pi_workspace_not_found: "invalid-workspace",
  pi_workspace_path_required: "invalid-workspace",
} as const satisfies Record<string, PiRequestErrorKind>;

/** Maps current RPC and legacy Pi error codes to user-facing Workbench error categories. */
export function piRequestErrorKind(error: unknown): PiRequestErrorKind | undefined {
  if (!(error instanceof PiApiError)) return undefined;
  return ERROR_KIND_BY_CODE[error.code as keyof typeof ERROR_KIND_BY_CODE];
}
