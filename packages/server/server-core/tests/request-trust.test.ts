import assert from "node:assert/strict";
import test from "node:test";

const {
  assertTrustedAuthority,
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
  isTrustedLocalApiRequest,
} = (await import(
  new URL("../src/request-trust.ts", import.meta.url).href
)) as typeof import("../src/request-trust");

function request(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

test("accepts a same-origin request using the real Host authority", () => {
  assert.equal(
    isTrustedLocalApiRequest(
      request({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      }),
    ),
    true,
  );
  assert.equal(
    inspectApiRequestTrust(
      request({ host: "workbench.example:80", origin: "https://workbench.example" }),
      { trustedHosts: ["workbench.example:80"] },
    ).trusted,
    true,
  );
});

test("accepts supported loopback authorities", () => {
  assert.equal(isTrustedLocalApiRequest(request({ host: "localhost:3000" })), true);
  assert.equal(isTrustedLocalApiRequest(request({ host: "[::1]:3000" })), true);
  assert.equal(isTrustedLocalApiRequest(request({ host: "127.8.9.10:3000" })), true);
});

test("rejects cross-site requests even when they target loopback", () => {
  assert.equal(
    isTrustedLocalApiRequest(
      request({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "cross-site",
      }),
    ),
    false,
  );
});

test("rejects non-loopback, mismatched, and malformed authorities", () => {
  assert.equal(isTrustedLocalApiRequest(request({ host: "example.com:3000" })), false);
  assert.equal(
    isTrustedLocalApiRequest(request({ host: "127.0.0.1:3000", origin: "http://localhost:3000" })),
    false,
  );
  assert.equal(isTrustedLocalApiRequest(request({ host: "not a host" })), false);
  assert.equal(isTrustedLocalApiRequest(request({})), false);
});

test("rejects opaque or malformed origins", () => {
  assert.equal(
    isTrustedLocalApiRequest(request({ host: "127.0.0.1:3000", origin: "null" })),
    false,
  );
  assert.equal(isTrustedLocalApiRequest(request({ host: "127.0.0.1:3000", origin: "://" })), false);
});

test("accepts configured trusted hosts while preserving loopback classification", () => {
  assert.deepEqual(
    inspectApiRequestTrust(
      request({
        host: "workbench.example:8443",
        origin: "https://workbench.example:8443",
      }),
      { trustedHosts: ["workbench.example:8443"] },
    ),
    { trusted: true, loopback: false },
  );
  assert.deepEqual(
    inspectApiRequestTrust(request({ host: "workbench.example:3000" }), {
      trustedHosts: ["workbench.example"],
    }),
    { trusted: true, loopback: false },
  );
});

test("requires exact ports and same-origin authorities for trusted hosts", () => {
  assert.equal(
    inspectApiRequestTrust(request({ host: "workbench.example:3000" }), {
      trustedHosts: ["workbench.example:8443"],
    }).trusted,
    false,
  );
  assert.equal(
    inspectApiRequestTrust(
      request({
        host: "workbench.example:8443",
        origin: "https://workbench.example:3000",
      }),
      { trustedHosts: ["workbench.example:8443"] },
    ).trusted,
    false,
  );
  assert.equal(
    inspectApiRequestTrust(request({ host: "workbench.example:3000" }), {
      trustedHosts: ["workbench.example:80"],
    }).trusted,
    false,
  );
  assert.equal(
    inspectApiRequestTrust(request({ host: "workbench.example:80" }), {
      trustedHosts: ["workbench.example:80"],
    }).trusted,
    true,
  );
  assert.equal(
    inspectApiRequestTrust(request({ host: "workbench.example" }), {
      trustedHosts: ["WORKBENCH.example:80"],
    }).trusted,
    true,
  );
  assert.equal(
    inspectApiRequestTrust(request({ host: "workbench.example:65535" }), {
      trustedHosts: ["workbench.example:80"],
    }).trusted,
    false,
  );
});

test("rejects malformed configured authorities before they can broaden trust", (t) => {
  for (const authority of ["workbench.example", "WORKBENCH.example:80", "[::1]:3000"]) {
    assert.doesNotThrow(() => assertTrustedAuthority(authority));
  }
  for (const authority of [
    "workbench.example:",
    "workbench.example:0080",
    "user@workbench.example",
    "workbench.example/path",
  ]) {
    assert.throws(() => assertTrustedAuthority(authority), /bare host\[:port\] authority/);
  }

  const previous = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previous;
  });
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example, workbench.example:0080";
  assert.throws(() => configuredApiTrustedHosts(), /workbench\.example:0080/);
});
