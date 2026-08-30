export type WorkbenchShutdownHook = () => void | Promise<void>;

const SHUTDOWN_HOOKS_KEY = Symbol.for("pi-workbench.shutdown-hooks.v1");

interface ShutdownHookRegistry {
  hooks: Map<string, WorkbenchShutdownHook>;
}

function registry(): ShutdownHookRegistry {
  const globals = globalThis as typeof globalThis & {
    [SHUTDOWN_HOOKS_KEY]?: ShutdownHookRegistry;
  };
  return (globals[SHUTDOWN_HOOKS_KEY] ??= { hooks: new Map() });
}

/**
 * Register a named server-owned resource cleanup. Re-registering the same name
 * replaces the previous hook so development HMR does not accumulate handlers.
 */
export function registerWorkbenchShutdownHook(
  name: string,
  hook: WorkbenchShutdownHook,
): () => void {
  if (!name.trim()) throw new TypeError("A Workbench shutdown hook requires a name.");
  const hooks = registry().hooks;
  hooks.set(name, hook);
  return () => {
    if (hooks.get(name) === hook) hooks.delete(name);
  };
}

/** Run every currently registered cleanup once and return all failures. */
export async function runWorkbenchShutdownHooks(): Promise<unknown[]> {
  const hooks = [...registry().hooks.values()];
  registry().hooks.clear();
  const results = await Promise.allSettled(hooks.map((hook) => Promise.resolve().then(hook)));
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}
