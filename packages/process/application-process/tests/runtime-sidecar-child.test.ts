import assert from "node:assert/strict";
import test from "node:test";

import { createStreamingSecretRedactor } from "../src/runtime-sidecar-child";

test("streaming diagnostics preserve UTF-8 and redact credentials across every byte boundary", () => {
  const secret = "令牌-secret";
  const source = Buffer.from(`启动：${secret}\n日志🙂 ${secret} 完成`, "utf8");
  for (let boundary = 0; boundary <= source.length; boundary += 1) {
    let output = "";
    const redactor = createStreamingSecretRedactor([secret], (chunk) => {
      output += chunk;
    });
    redactor.write(source.subarray(0, boundary));
    redactor.write(source.subarray(boundary));
    redactor.end();
    assert.equal(output, "启动：[REDACTED]\n日志🙂 [REDACTED] 完成", `byte ${boundary}`);
  }
});

test("streaming diagnostics flush ordinary trailing text and tolerate a failed diagnostic sink", () => {
  let output = "";
  const redactor = createStreamingSecretRedactor([], (chunk) => {
    output += chunk;
  });
  const source = Buffer.from("普通日志🙂", "utf8");
  for (const byte of source) redactor.write(Uint8Array.of(byte));
  redactor.end();
  assert.equal(output, "普通日志🙂");

  const failedSink = createStreamingSecretRedactor(["secret"], () => {
    throw new Error("diagnostic sink unavailable");
  });
  assert.doesNotThrow(() => {
    failedSink.write(Buffer.from("ordinary secret tail"));
    failedSink.end();
  });
});
