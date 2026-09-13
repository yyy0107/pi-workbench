import type { WorkspaceScope } from "@workbench/extension-sdk";

export type WorkspaceFeedbackKind = string;

export interface WorkspaceFeedback {
  readonly id: string;
  readonly surfaceId: string;
  readonly kind: WorkspaceFeedbackKind;
  readonly target: Readonly<Record<string, unknown>>;
  readonly text: string;
  readonly images?: readonly {
    readonly data: string;
    readonly mimeType: string;
    readonly name?: string;
  }[];
  readonly scope: WorkspaceScope;
  readonly threadId?: string;
  readonly createdAt: number;
}

export type WorkspaceFeedbackDraft = Omit<WorkspaceFeedback, "id" | "createdAt">;

export type WorkspaceFeedbackClaimItem = Pick<
  WorkspaceFeedback,
  "id" | "kind" | "target" | "text" | "images"
>;

/** Opaque ownership token for one immutable snapshot of pending workspace feedback. */
export interface WorkspaceFeedbackClaim {
  readonly token: string;
  readonly items: readonly WorkspaceFeedbackClaimItem[];
}

/** Runtime-neutral claim boundary. Product Agent Runtime adapters remain outside Shell. */
export interface WorkspaceFeedbackClaimPort {
  claimForThreads(threadIds: readonly string[]): WorkspaceFeedbackClaim | undefined;
  commit(token: string): void;
  release(token: string): void;
}
