import { getLoadedSessions } from "../sessions/session-registry";
import { workspaceFromCwd } from "../workspaces/workspace-paths";

export type PiResourceMutationScope =
  | { readonly scope: "user" }
  | { readonly scope: "project"; readonly cwd: string };

export interface PiResourceMutationSessionHost {
  readonly isAlive?: boolean;
  readonly isRunning?: boolean;
  readonly session: {
    readonly sessionManager?: {
      getCwd(): string;
    };
    reload?(): Promise<void>;
  };
}

export interface LoadedPiResourceMutationSessionHost extends PiResourceMutationSessionHost {
  readonly id: string;
}

export interface PiResourceMutationCoordinatorDependencies {
  getLoadedSessions(): readonly LoadedPiResourceMutationSessionHost[];
}

export interface PiResourceMutationResult<Value> {
  readonly value: Value;
  readonly reload: boolean;
}

export class PiResourceMutationBusyError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Pi session ${sessionId} is busy.`);
    this.name = "PiResourceMutationBusyError";
    this.sessionId = sessionId;
  }
}

export class PiResourceMutationSessionUnavailableError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Pi session ${sessionId} is unavailable.`);
    this.name = "PiResourceMutationSessionUnavailableError";
    this.sessionId = sessionId;
  }
}

export class PiResourceMutationScopeChangedError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Pi session ${sessionId} no longer belongs to the locked resource scope.`);
    this.name = "PiResourceMutationScopeChangedError";
    this.sessionId = sessionId;
  }
}

type ReleaseScope = () => void;

interface ScopeWaiter {
  readonly scope: PiResourceMutationScope;
  readonly resolve: (release: ReleaseScope) => void;
}

function projectScopeKey(scope: Extract<PiResourceMutationScope, { scope: "project" }>): string {
  return workspaceFromCwd(scope.cwd).cwd;
}

/**
 * User resources affect every loaded Pi session, so a user mutation is exclusive
 * with every project mutation. Project mutations are serialized per canonical cwd;
 * unrelated projects may still proceed concurrently.
 */
class PiResourceMutationScopeLock {
  private readonly queue: ScopeWaiter[] = [];
  private readonly activeProjects = new Set<string>();
  private userActive = false;

  acquire(scope: PiResourceMutationScope): Promise<ReleaseScope> {
    return new Promise<ReleaseScope>((resolve) => {
      this.queue.push({ scope, resolve });
      this.drain();
    });
  }

  private drain(): void {
    if (this.userActive) return;

    for (let index = 0; index < this.queue.length;) {
      const waiter = this.queue[index];
      if (waiter.scope.scope === "user") break;
      const key = projectScopeKey(waiter.scope);
      if (this.activeProjects.has(key)) {
        index += 1;
        continue;
      }

      this.queue.splice(index, 1);
      this.activeProjects.add(key);
      waiter.resolve(this.releaseProject(key));
    }

    if (this.activeProjects.size > 0 || this.queue[0]?.scope.scope !== "user") return;
    const waiter = this.queue.shift();
    if (!waiter) return;
    this.userActive = true;
    waiter.resolve(this.releaseUser());
  }

  private releaseProject(key: string): ReleaseScope {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeProjects.delete(key);
      this.drain();
    };
  }

  private releaseUser(): ReleaseScope {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.userActive = false;
      this.drain();
    };
  }
}

interface PrimarySession<Host extends PiResourceMutationSessionHost> {
  readonly id: string;
  getSession(): Promise<Host>;
}

interface MutationOptions<Host extends PiResourceMutationSessionHost> {
  readonly scope: PiResourceMutationScope;
  readonly primarySession?: PrimarySession<Host>;
}

interface SessionReference {
  readonly id: string;
  readonly host: PiResourceMutationSessionHost;
}

export class PiResourceMutationCoordinator {
  private readonly dependencies: PiResourceMutationCoordinatorDependencies;
  private readonly scopeLock = new PiResourceMutationScopeLock();

  constructor(dependencies: Partial<PiResourceMutationCoordinatorDependencies> = {}) {
    this.dependencies = {
      getLoadedSessions,
      ...dependencies,
    };
  }

  async mutate<Value>(
    scope: PiResourceMutationScope,
    operation: () => Promise<PiResourceMutationResult<Value>>,
  ): Promise<Value> {
    return this.runMutation({ scope }, async () => operation());
  }

  async mutateForSession<Host extends PiResourceMutationSessionHost, Value>(
    options: {
      readonly scope: PiResourceMutationScope;
      readonly sessionId: string;
      getSession(): Promise<Host>;
    },
    operation: (host: Host) => Promise<PiResourceMutationResult<Value>>,
  ): Promise<Value> {
    return this.runMutation(
      {
        scope: options.scope,
        primarySession: {
          id: options.sessionId,
          getSession: options.getSession,
        },
      },
      async (host) => operation(host as Host),
    );
  }

  private async runMutation<Host extends PiResourceMutationSessionHost, Value>(
    options: MutationOptions<Host>,
    operation: (host: Host | undefined) => Promise<PiResourceMutationResult<Value>>,
  ): Promise<Value> {
    const releaseScope = await this.scopeLock.acquire(options.scope);
    try {
      const primaryHost = await this.loadPrimarySession(options.primarySession);
      if (primaryHost && !this.belongsToScope(primaryHost.host, options.scope)) {
        throw new PiResourceMutationScopeChangedError(primaryHost.id);
      }
      this.assertSessionsIdle(this.affectedSessions(options.scope, primaryHost));

      const result = await operation(primaryHost?.host as Host | undefined);
      if (result.reload) {
        await this.reloadAffectedSessions(options.scope, primaryHost);
      }
      return result.value;
    } finally {
      releaseScope();
    }
  }

  private async loadPrimarySession<Host extends PiResourceMutationSessionHost>(
    primarySession: PrimarySession<Host> | undefined,
  ): Promise<SessionReference | undefined> {
    if (!primarySession) return undefined;
    const host = await primarySession.getSession();
    if (host.isAlive === false) {
      throw new PiResourceMutationSessionUnavailableError(primarySession.id);
    }
    return { id: primarySession.id, host };
  }

  private affectedSessions(
    scope: PiResourceMutationScope,
    primarySession: SessionReference | undefined,
  ): SessionReference[] {
    const sessions = new Map<string, PiResourceMutationSessionHost>();
    for (const host of this.dependencies.getLoadedSessions()) {
      if (host.isAlive === false || !this.belongsToScope(host, scope)) continue;
      sessions.set(host.id, host);
    }
    if (
      primarySession &&
      primarySession.host.isAlive !== false &&
      this.belongsToScope(primarySession.host, scope)
    ) {
      sessions.set(primarySession.id, primarySession.host);
    }
    return [...sessions]
      .map(([id, host]) => ({ id, host }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private belongsToScope(
    host: PiResourceMutationSessionHost,
    scope: PiResourceMutationScope,
  ): boolean {
    if (scope.scope === "user") return true;
    const cwd = host.session.sessionManager?.getCwd();
    return cwd !== undefined && workspaceFromCwd(cwd).cwd === projectScopeKey(scope);
  }

  private assertSessionsIdle(sessions: readonly SessionReference[]): void {
    const busy = sessions.find(({ host }) => host.isRunning);
    if (busy) throw new PiResourceMutationBusyError(busy.id);
  }

  private async reloadAffectedSessions(
    scope: PiResourceMutationScope,
    primarySession: SessionReference | undefined,
  ): Promise<void> {
    const sessions = this.affectedSessions(scope, primarySession).filter(
      ({ host }) => host.session.reload !== undefined,
    );
    const results = await Promise.allSettled(
      sessions.map(({ host }) => host.session.reload?.() ?? Promise.resolve()),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
}

let sharedCoordinator: PiResourceMutationCoordinator | undefined;

export function getPiResourceMutationCoordinator(): PiResourceMutationCoordinator {
  sharedCoordinator ??= new PiResourceMutationCoordinator();
  return sharedCoordinator;
}
