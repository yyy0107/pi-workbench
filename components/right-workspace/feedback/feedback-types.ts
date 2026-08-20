import type { WorkspaceScope } from "../core/surface-types";

export type WorkspaceFeedbackKind = string;

export interface WorkspaceFeedback {
  id: string;
  surfaceId: string;
  kind: WorkspaceFeedbackKind;
  target: Record<string, unknown>;
  text: string;
  scope: WorkspaceScope;
  threadId?: string;
  createdAt: number;
}

export type WorkspaceFeedbackDraft = Omit<WorkspaceFeedback, "id" | "createdAt">;
