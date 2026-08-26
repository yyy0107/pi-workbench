import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { LocalizableText } from "@/i18n";

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

export const WORKSPACE_SURFACE_PLACEMENTS = ["primary", "auxiliary"] as const;

export type WorkspaceSurfacePlacement = (typeof WORKSPACE_SURFACE_PLACEMENTS)[number];

export interface WorkspaceSurfaceInstance<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  kind: WorkspaceSurfaceKind;
  placement: WorkspaceSurfacePlacement;
  /** Render-time localizable title. Literal strings remain valid for resource and user labels. */
  title: LocalizableText;
  resourceKey: string;
  scope: WorkspaceScope;
  params: P;
  status: WorkspaceSurfaceStatus;
  /** Optional render-time localizable, user-safe status detail. */
  statusMessage?: LocalizableText;
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
  /** True only while this instance is the visible Surface in an open host pane. */
  isVisible: boolean;
  /** Increments when the host asks an error state to retry its last resource operation. */
  retryToken?: number;
}

export interface WorkspaceSurfaceMenuItemProps {
  closeMenu(): void;
}

export const WORKSPACE_SURFACE_CACHE_POLICIES = [
  "unmount",
  "keep-alive",
  "preserve-dirty",
] as const;

export type WorkspaceSurfaceCachePolicy = (typeof WORKSPACE_SURFACE_CACHE_POLICIES)[number];
export type WorkspaceSurfacePersistence = "persistent" | "session";

export type WorkspaceSurfaceRenderer<P extends Record<string, unknown> = Record<string, unknown>> =
  ComponentType<WorkspaceSurfaceProps<P>>;

export interface WorkspaceSurfaceDefinition<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Stable, globally unique capability id such as `review` or `browser`. */
  kind: WorkspaceSurfaceKind;
  /** Icon rendered by the core tab host. */
  icon: LucideIcon;
  cachePolicy: WorkspaceSurfaceCachePolicy;
  /** Session surfaces depend on in-memory resources and are not restored after a reload. */
  persistence?: WorkspaceSurfacePersistence;
  /** Default host pane. Omitted definitions render in the primary tabbed pane. */
  defaultPlacement?: WorkspaceSurfacePlacement;
  allowDuplicateResources?: boolean;
  getResourceKey(params: P, context: WorkspaceContext): string;
  getDefaultScope?(params: P, context: WorkspaceContext): WorkspaceScope;
  /** Optional active-primary chrome rendered by the core host above every workspace pane. */
  header?: WorkspaceSurfaceRenderer<P>;
  /** Renderer component. Use createLazyWorkspaceSurface() for retryable code splitting. */
  render: WorkspaceSurfaceRenderer<P>;
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
  /** Built-in product copy should use defineMessage(); resource and user labels stay literal. */
  title: LocalizableText;
  params: P;
  context: WorkspaceContext;
  placement?: WorkspaceSurfacePlacement;
  scope?: WorkspaceScope;
  status?: WorkspaceSurfaceStatus;
  /** Never pass raw Error.message; report diagnostics and provide a user-safe descriptor. */
  statusMessage?: LocalizableText;
  dirty?: boolean;
  pinned?: boolean;
  policy?: SurfaceOpenPolicy;
}
