import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
} from "@workbench/host-contracts";

import { shouldUseNativeDirectoryPicker } from "./directory-picker-capability";

test("derives native directory picker capability from the immutable Runtime connection", () => {
  const sameOrigin = (httpOrigin: string) =>
    defineRuntimeConnection({
      kind: "same-origin",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      httpOrigin,
    });

  assert.equal(shouldUseNativeDirectoryPicker(sameOrigin("http://localhost:3000")), true);
  assert.equal(shouldUseNativeDirectoryPicker(sameOrigin("http://127.42.0.8:3000")), true);
  assert.equal(shouldUseNativeDirectoryPicker(sameOrigin("http://[::1]:3000")), true);
  assert.equal(shouldUseNativeDirectoryPicker(sameOrigin("https://workbench.example.test")), false);
  assert.equal(
    shouldUseNativeDirectoryPicker(
      defineRuntimeConnection({
        kind: "desktop-sidecar",
        protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
        httpOrigin: "http://127.0.0.1:43127",
        instanceId: "runtime-one",
        accessToken: "token-one",
      }),
    ),
    true,
  );
});
