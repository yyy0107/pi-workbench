import assert from "node:assert/strict";
import test from "node:test";

import {
  readDesktopRuntimeBootstrapPort,
  readDesktopRuntimeLifecyclePort,
} from "../src/runtime-bootstrap";

test("accepts only an object exposing the narrow Runtime bootstrap capability", () => {
  const port = { bootstrap: () => undefined };
  assert.equal(readDesktopRuntimeBootstrapPort(port), port);
  assert.equal(readDesktopRuntimeBootstrapPort(null), undefined);
  assert.equal(readDesktopRuntimeBootstrapPort([]), undefined);
  assert.equal(readDesktopRuntimeBootstrapPort({ bootstrap: "not-a-function" }), undefined);
  assert.equal(
    readDesktopRuntimeBootstrapPort({ bootstrap: () => undefined, extra: true }),
    undefined,
  );
});

test("accepts only the narrow Runtime lifecycle capability", () => {
  const port = { restartRuntime: () => undefined };
  assert.equal(readDesktopRuntimeLifecyclePort(port), port);
  assert.equal(readDesktopRuntimeLifecyclePort({ restartRuntime: "not-a-function" }), undefined);
  assert.equal(
    readDesktopRuntimeLifecyclePort({ restartRuntime: () => undefined, extra: true }),
    undefined,
  );
});
