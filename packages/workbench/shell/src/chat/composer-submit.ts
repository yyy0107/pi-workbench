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
