import type { CompiledComposerRequest } from "@workbench/extension-sdk";

interface ComposerSubmitSession {
  readonly snapshot: { getSnapshot(): { readonly isRunning: boolean } };
  readonly actions: {
    readonly send?: (input: CompiledComposerRequest) => Promise<void>;
    readonly queue?: (input: CompiledComposerRequest) => Promise<void>;
    readonly steer?: (input: CompiledComposerRequest) => Promise<void>;
  };
}

interface ComposerSubmitOptions {
  readonly steer?: boolean;
}

/** Check host and extension prerequisites before compiling or consuming the draft. */
export function canSubmitWorkbenchComposer(
  hostReady: boolean,
  guards: Iterable<() => boolean>,
): boolean {
  return hostReady && Array.from(guards).every((guard) => guard());
}

export function runningComposerMode(
  actions: ComposerSubmitSession["actions"],
  preferred: "queue" | "steer",
  invert = false,
): "queue" | "steer" {
  const mode = actions[preferred] ? preferred : preferred === "steer" ? "queue" : "steer";
  return invert ? (mode === "queue" ? "steer" : "queue") : mode;
}

/**
 * Select the action from the live Session snapshot so IME completion cannot race React.
 */
export async function submitWorkbenchComposer(
  session: ComposerSubmitSession,
  request: CompiledComposerRequest,
  options?: ComposerSubmitOptions,
): Promise<boolean> {
  const { isRunning } = session.snapshot.getSnapshot();
  const action = isRunning
    ? options?.steer
      ? session.actions.steer
      : session.actions.queue
    : session.actions.send;
  if (!action) return false;
  await action(request);
  return true;
}
