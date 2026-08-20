import type { CompiledComposerRequest } from "@/platform/extensions";
import { WORKBENCH_COMPOSER_RUN_CONFIG_KEY } from "@/runtime/composer-request";

interface ComposerSubmitTarget {
  getState(): {
    canSend: boolean;
    text: string;
    runConfig: { custom?: Record<string, unknown> };
  };
  setText(text: string): void;
  setRunConfig(runConfig: { custom?: Record<string, unknown> }): void;
  send(options?: { steer?: boolean }): void;
}

export interface ComposerSubmitThread {
  getState(): {
    isRunning: boolean;
    capabilities: { queue: boolean };
  };
  composer(): ComposerSubmitTarget;
}

/**
 * Dispatches from the live runtime state instead of a render-time `canSend`
 * snapshot. IME completion and command-token updates can make the composer
 * sendable before React has committed the next render.
 */
export function submitWorkbenchComposer(
  thread: ComposerSubmitThread,
  inputText?: string,
  request?: CompiledComposerRequest,
): boolean {
  const composer = thread.composer();
  if (inputText !== undefined && composer.getState().text !== inputText) {
    composer.setText(inputText);
  }
  const state = composer.getState();
  const currentCustom = state.runConfig.custom ?? {};
  if (request) {
    composer.setRunConfig({
      ...state.runConfig,
      custom: { ...currentCustom, [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: request },
    });
  } else if (WORKBENCH_COMPOSER_RUN_CONFIG_KEY in currentCustom) {
    const { [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: _stale, ...custom } = currentCustom;
    composer.setRunConfig({ ...state.runConfig, custom });
  }
  if (!composer.getState().canSend) return false;

  const threadState = thread.getState();
  composer.send(
    threadState.isRunning && threadState.capabilities.queue ? { steer: false } : undefined,
  );
  return true;
}
