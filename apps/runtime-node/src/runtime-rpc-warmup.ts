import type { RuntimeFetchHandler } from "@workbench/host-server/fetch-request-handler";

export type RuntimeWarmupMethod = "packageCatalog.search" | "session.list";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Warms the installed Runtime graph directly, without creating a loopback or Next route server. */
export async function warmRuntimeRpc(
  handleRequest: RuntimeFetchHandler,
  method: RuntimeWarmupMethod,
  signal?: AbortSignal,
): Promise<void> {
  const rpcId = `startup-${method}-warmup`;
  const response = await handleRequest(
    new Request(`http://127.0.0.1/api/${method}`, {
      method: "POST",
      headers: {
        Host: "127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method,
        payload: {},
      }),
      signal,
    }),
  );
  const body: unknown = await response.json();
  if (
    !response.ok ||
    !isRecord(body) ||
    body.type !== "server-response" ||
    body.rpcId !== rpcId ||
    !isRecord(body.result) ||
    body.result.ok !== true
  ) {
    throw new Error(`${method} warmup failed with HTTP ${response.status}.`);
  }
}
