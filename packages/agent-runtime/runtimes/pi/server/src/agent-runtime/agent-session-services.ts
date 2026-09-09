import path from "node:path";

import type { Api, FetchFunction } from "@earendil-works/pi-ai";
import {
  createAgentSessionServices,
  type CreateAgentSessionServicesOptions,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import { ModelConfigStore } from "../models/model-config-store";
import { getSessionContextTrace } from "../sessions/session-context-trace";

// Capture during host module initialization, before any resource loader runs.
// Capturing per session would inherit global fetch overrides from older sessions.
const hostFetch = globalThis.fetch;
const protectedRuntimes = new WeakSet<ModelRuntime>();

// Pi 0.85.1 supports fetch injection for these HTTP adapters. Google rejects it;
// Bedrock owns its HTTP handler. Unknown extension APIs retain their own transport.
const fetchApis = new Set<Api>([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "mistral-conversations",
  "pi-messages",
]);

function requestOptions<T extends { fetch?: FetchFunction }>(api: Api, options?: T) {
  if (!fetchApis.has(api)) return options;
  const fetch = options?.fetch ?? hostFetch;
  const sessionId = options && "sessionId" in options ? options.sessionId : undefined;
  const trace = typeof sessionId === "string" ? getSessionContextTrace(sessionId) : undefined;
  if (!trace) return options?.fetch ? options : { ...options, fetch };
  const measuredFetch: FetchFunction = async (input, init) => {
    const body = init?.body;
    const bodyBytes =
      typeof body === "string"
        ? Buffer.byteLength(body)
        : body instanceof ArrayBuffer || ArrayBuffer.isView(body)
          ? body.byteLength
          : body instanceof Blob
            ? body.size
            : undefined;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const finish = trace.observeProviderHttpRequest(
      bodyBytes,
      headers.get("content-encoding") ?? undefined,
    );
    try {
      const response = await fetch(input, init);
      finish?.(response.status);
      return response;
    } catch (error) {
      finish?.(undefined, error);
      throw error;
    }
  };
  return { ...options, fetch: measuredFetch };
}

/** Keep model HTTP requests independent of tool extensions replacing global fetch. */
export async function createWorkbenchAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
) {
  const services = await createAgentSessionServices(options);
  const runtime = services.modelRuntime;
  if (
    !options.modelRuntime &&
    (await new ModelConfigStore({
      stateFile: path.join(services.agentDir, "models.json"),
    }).migrateBuiltinModelOverrides())
  ) {
    await runtime.refresh({ allowNetwork: false, signal: options.modelRuntimeSignal });
  }
  if (protectedRuntimes.has(runtime)) return services;

  // Keep the SDK runtime and its auth/provider/reload ownership. Both complete
  // variants delegate to these stream methods, including compaction and vision.
  const stream = runtime.stream.bind(runtime);
  const streamSimple = runtime.streamSimple.bind(runtime);
  const fetchDeferred = runtime.fetchDeferred.bind(runtime);
  const cancelDeferred = runtime.cancelDeferred.bind(runtime);
  runtime.stream = (model, context, options) =>
    stream(model, context, requestOptions(model.api, options) as typeof options);
  runtime.streamSimple = (model, context, options) =>
    streamSimple(model, context, requestOptions(model.api, options));
  runtime.fetchDeferred = (model, handle, options) =>
    fetchDeferred(model, handle, requestOptions(model.api, options));
  runtime.cancelDeferred = (model, handle, options) =>
    cancelDeferred(model, handle, requestOptions(model.api, options));
  protectedRuntimes.add(runtime);
  return services;
}
