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

test("classifies recoverable attachment admission failures for the composer", () => {
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, {
        reason: "MODEL_DOES_NOT_SUPPORT_IMAGES",
      }),
    ),
    "model-attachment-unsupported",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "TOO_MANY_INLINE_IMAGES" }),
    ),
    "too-many-attachments",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "INLINE_IMAGE_TOO_LARGE" }),
    ),
    "attachment-too-large",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, {
        reason: "INLINE_IMAGES_TOTAL_TOO_LARGE",
      }),
    ),
    "attachment-too-large",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "IMAGE_MEDIA_TYPE_MISMATCH" }),
    ),
    "attachment-invalid",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "INLINE_DOCUMENT_TOO_LARGE" }),
    ),
    "attachment-too-large",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "UNRECOGNIZED_DOCUMENT_FORMAT" }),
    ),
    "attachment-invalid",
  );
  assert.equal(
    piComposerSendError(
      new PiApiError("attachment-error", 200, { reason: "FUTURE_ATTACHMENT_REASON" }),
    ),
    "attachment-invalid",
  );
});

test("does not turn transport or unrelated business failures into composer admission errors", () => {
  assert.equal(piComposerSendError(new PiApiError("pi_rpc_transport_failed", 500)), undefined);
  assert.equal(piComposerSendError(new Error("offline")), undefined);
});
