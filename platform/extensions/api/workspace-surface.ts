import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

export const WORKSPACE_SCOPE_TYPES = ["thread", "worktree", "project", "application"] as const;

export type WorkspaceScopeType = (typeof WORKSPACE_SCOPE_TYPES)[number];

export interface WorkspaceScope {
  type: WorkspaceScopeType;
  key: string;
}

export interface WorkspaceContext {
  applicationId: string;
  threadId?: string;
  worktreeId?: string;
  projectId?: string;
  rootPath?: string;
}

export type WorkspaceSurfaceStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "disconnected"
  | "permission-required"
  | "resource-changed";

export type WorkspaceSurfaceKind = string;

export interface WorkspaceSurfaceInstance<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  kind: WorkspaceSurfaceKind;
  title: string;
  resourceKey: string;
  scope: WorkspaceScope;
  params: P;
  status: WorkspaceSurfaceStatus;
  statusMessage?: string;
  dirty?: boolean;
  pinned?: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface WorkspaceSurfaceProps<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  surface: WorkspaceSurfaceInstance<P>;
  context: WorkspaceContext;
}

export interface WorkspaceSurfaceMenuItemProps {
  closeMenu(): void;
}

export type WorkspaceSurfaceCachePolicy = "unmount" | "keep-alive" | "persistent";

export interface WorkspaceSurfaceDefinition<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Stable, globally unique capability id such as `review` or `browser`. */
  kind: WorkspaceSurfaceKind;
  /** Icon rendered by the core tab host. */
  icon: LucideIcon;
  cachePolicy: WorkspaceSurfaceCachePolicy;
  allowDuplicateResources?: boolean;
  getResourceKey(params: P, context: WorkspaceContext): string;
  getDefaultScope?(params: P, context: WorkspaceContext): WorkspaceScope;
  render: ComponentType<WorkspaceSurfaceProps<P>>;
  /** Optional feature-owned entry rendered in the core add-surface menu. */
  menuItem?: ComponentType<WorkspaceSurfaceMenuItemProps>;
  /** Optional feature-owned runtime bridge mounted once while the extension is active. */
  runtime?: ComponentType;
}

export type AnyWorkspaceSurfaceDefinition = WorkspaceSurfaceDefinition<Record<string, unknown>>;

export interface WorkspaceSurfaceRegistry {
  register<P extends Record<string, unknown>>(
    definition: WorkspaceSurfaceDefinition<P>,
  ): Disposable;
  get(kind: WorkspaceSurfaceKind): AnyWorkspaceSurfaceDefinition | undefined;
  getAll(): readonly AnyWorkspaceSurfaceDefinition[];
  subscribe(listener: () => void): () => void;
}

export type SurfaceOpenPolicy = "background" | "reveal" | "force-focus";

export interface OpenSurfaceRequest<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: WorkspaceSurfaceKind;
  title: string;
  params: P;
  context: WorkspaceContext;
  scope?: WorkspaceScope;
  status?: WorkspaceSurfaceStatus;
  statusMessage?: string;
  dirty?: boolean;
  pinned?: boolean;
  policy?: SurfaceOpenPolicy;
}
