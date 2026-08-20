import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../transport/api") {
      return nextResolve(new URL("../transport/api.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { PiApiError } = (await import(
  new URL("../transport/api.ts", import.meta.url).href
)) as typeof import("../transport/api");
const { piComposerSendError } = (await import(
  new URL("./send-error.ts", import.meta.url).href
)) as typeof import("./send-error");
moduleHooks.deregister();

test("classifies recoverable image admission failures for the composer", () => {
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, {
        reason: "MODEL_DOES_NOT_SUPPORT_IMAGES",
      }),
    ),
    "model-image-unsupported",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "TOO_MANY_INLINE_IMAGES" }),
    ),
    "too-many-images",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "IMAGE_TOTAL_TOO_LARGE" }),
    ),
    "image-too-large",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "IMAGE_MEDIA_TYPE_MISMATCH" }),
    ),
    "image-invalid",
  );
});

test("does not turn transport or unrelated business failures into composer admission errors", () => {
  assert.equal(piComposerSendError(new PiApiError("pi_rpc_transport_failed", 500)), undefined);
  assert.equal(piComposerSendError(new Error("offline")), undefined);
});
