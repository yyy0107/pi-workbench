import type { Disposable } from "./disposable";
import type {
  OpenSurfaceRequest,
  SurfaceOpenPolicy,
  WorkspaceContext,
  WorkspaceScope,
} from "./workspace-surface";

/** Protocol-like resource identifier passed between independent contributions. */
export interface OpenableResource {
  /** Stable, non-localized resource scheme such as `file`, `https`, or `artifact`. */
  scheme: string;
  /** Scheme-specific resource path or identifier. */
  path: string;
  /** Optional user-visible label supplied by the resource producer. */
  label?: string;
  /** Optional scheme-owned presentation data interpreted only by the selected handler. */
  metadata?: Readonly<Record<string, unknown>>;
}

export interface OpenResourceRequest {
  resource: OpenableResource;
  context: WorkspaceContext;
  scope?: WorkspaceScope;
  policy?: SurfaceOpenPolicy;
}

/** Minimal surface operations injected by the host when an opener executes. */
export interface WorkspaceSurfaceOpenOperations {
  open<P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string;
  reveal<P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string;
}

export interface OpenHandlerContext {
  readonly surfaces: WorkspaceSurfaceOpenOperations;
}

export interface OpenHandlerDefinition {
  /** Globally unique, stable handler id. */
  id: string;
  /** Return zero when unsupported; the highest positive score wins. */
  canOpen(request: OpenResourceRequest): number;
  /** Open the resource using host operations without importing another contribution. */
  open(
    request: OpenResourceRequest,
    context: OpenHandlerContext,
  ): string | void | Promise<string | void>;
}

export interface OpenerRegistry {
  register(handler: OpenHandlerDefinition): Disposable;
  getAll(): readonly OpenHandlerDefinition[];
  subscribe(listener: () => void): () => void;
}

export interface OpenerService {
  open(request: OpenResourceRequest): Promise<string | void>;
  getHandlers(): readonly OpenHandlerDefinition[];
  subscribe(listener: () => void): () => void;
}
