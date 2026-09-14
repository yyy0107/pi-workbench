import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDirectHost,
  createDirectSocketUrl,
  parseAllowedDirectEndpoint,
} from "../src/address-policy.ts";

test("classifies private LAN and Tailscale address forms", () => {
  assert.equal(classifyDirectHost("10.0.0.8"), "local-network");
  assert.equal(classifyDirectHost("172.16.0.8"), "local-network");
  assert.equal(classifyDirectHost("192.168.1.8"), "local-network");
  assert.equal(classifyDirectHost("100.64.0.1"), "tailscale");
  assert.equal(classifyDirectHost("100.127.255.254"), "tailscale");
  assert.equal(classifyDirectHost("fd7a:115c:a1e0::1"), "tailscale");
  assert.equal(classifyDirectHost("fd00::8"), "local-network");
  assert.equal(classifyDirectHost("workbench.local"), "local-network");
  assert.equal(classifyDirectHost("workbench.tailnet.ts.net"), "tailscale");
  assert.equal(classifyDirectHost("workbench"), "tailscale");
});

test("rejects public, wildcard, multicast, unspecified, loopback, link-local, and injected hosts", () => {
  for (const host of [
    "8.8.8.8",
    "0.0.0.0",
    "224.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "::",
    "::1",
    "fe80::1",
    "ff02::1",
    "example.com",
    "https://192.168.1.8",
    "user@workbench.local",
    "workbench.local/path",
    "workbench.local?token=x",
    "workbench.local#fragment",
  ]) {
    assert.equal(classifyDirectHost(host), undefined, host);
  }
});

test("canonicalizes endpoints and derives one credential-free fixed-path URL", () => {
  assert.deepEqual(
    parseAllowedDirectEndpoint({ kind: "tailscale", host: "100.100.10.20", port: 8787 }),
    { kind: "tailscale", host: "100.100.10.20", port: 8787 },
  );
  assert.equal(
    createDirectSocketUrl({ kind: "tailscale", host: "fd7a:115c:a1e0::1", port: 8787 }),
    "ws://[fd7a:115c:a1e0::1]:8787/remote/v1/direct",
  );
  assert.throws(
    () => parseAllowedDirectEndpoint({ kind: "tailscale", host: "192.168.1.20", port: 8787 }),
    /endpoint_kind_mismatch/u,
  );
  assert.throws(
    () => parseAllowedDirectEndpoint({ kind: "local-network", host: "192.168.1.20", port: 0 }),
    /endpoint_not_allowed/u,
  );
  assert.throws(
    () => parseAllowedDirectEndpoint({ kind: "local-network", host: "192.168.1.20", port: 65_536 }),
    /endpoint_not_allowed/u,
  );
});
