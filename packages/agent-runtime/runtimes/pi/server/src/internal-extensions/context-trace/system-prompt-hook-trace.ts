import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

import { isBuiltinResourceEnabled } from "../../agent-runtime/pi-agent-host-bindings";
import { getSessionContextTrace } from "../../sessions/session-context-trace";

const INSTRUMENTED_HANDLER = Symbol.for("pi-workbench.context-trace.before-agent-start-handler");

type PiExtensionHandler = (...args: unknown[]) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInstrumented(handler: PiExtensionHandler): boolean {
  return Reflect.get(handler, INSTRUMENTED_HANDLER) === true;
}

function sessionId(context: unknown): string | undefined {
  if (!isRecord(context) || !isRecord(context.sessionManager)) return undefined;
  const getSessionId = context.sessionManager.getSessionId;
  if (typeof getSessionId !== "function") return undefined;
  const value = Reflect.apply(getSessionId, context.sessionManager, []);
  return typeof value === "string" ? value : undefined;
}

/**
 * Adds transparent provenance recording around Pi's system-prompt mutation hook. The SDK chains
 * these handlers internally but exposes only the final prompt to downstream observers.
 */
export function instrumentSystemPromptHookTracing(
  result: LoadExtensionsResult,
): LoadExtensionsResult {
  for (const extension of result.extensions) {
    const handlers = extension.handlers.get("before_agent_start");
    if (!handlers || handlers.length === 0) continue;

    extension.handlers.set(
      "before_agent_start",
      handlers.map((handler, handlerIndex) => {
        if (isInstrumented(handler)) return handler;
        const wrapped: PiExtensionHandler = async (...args) => {
          const hookResult = await handler(...args);
          try {
            if (!(await isBuiltinResourceEnabled("contextTraceExtensionEnabled")))
              return hookResult;
            const event = args[0];
            const context = args[1];
            if (
              isRecord(event) &&
              event.type === "before_agent_start" &&
              typeof event.systemPrompt === "string" &&
              isRecord(hookResult) &&
              typeof hookResult.systemPrompt === "string"
            ) {
              const id = sessionId(context);
              if (id) {
                getSessionContextTrace(id)?.observeSystemPromptHookMutation({
                  path: extension.path,
                  scope: extension.sourceInfo.scope,
                  handlerIndex,
                  before: event.systemPrompt,
                  after: hookResult.systemPrompt,
                });
              }
            }
          } catch {
            // Context tracing must never change extension hook behavior or interrupt a model call.
          }
          return hookResult;
        };
        Reflect.defineProperty(wrapped, INSTRUMENTED_HANDLER, { value: true });
        return wrapped;
      }),
    );
  }
  return result;
}
