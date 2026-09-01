import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledWebRuntimeConnection } from "@/workbench/providers/installed-web-runtime-connection";

function headers(values: Record<string, string | undefined>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

test("derives the Web Runtime proxy origin from the exact request authority", () => {
  assert.deepEqual(
    createInstalledWebRuntimeConnection(
      headers({ host: "workbench.example:8443", "x-forwarded-proto": "https" }),
    ),
    {
      kind: "same-origin",
      protocolVersion: 1,
      httpOrigin: "https://workbench.example:8443",
    },
  );
});

test("uses the first proxy protocol and rejects missing or malformed authorities", () => {
  assert.equal(
    createInstalledWebRuntimeConnection(
      headers({ host: "127.0.0.1:43123", "x-forwarded-proto": "https, http" }),
    ).httpOrigin,
    "https://127.0.0.1:43123",
  );
  assert.throws(() => createInstalledWebRuntimeConnection(headers({})), /Host header/);
  assert.throws(
    () => createInstalledWebRuntimeConnection(headers({ host: "user@example.test" })),
    /invalid request Host/,
  );
});
