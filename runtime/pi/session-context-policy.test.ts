import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./rpc-contracts") return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const {
  effectiveSessionContextBudget,
  latestSessionContextPolicyMarker,
  normalizeSessionContextPolicy,
  policyFromSessionEntries,
  SESSION_CONTEXT_POLICY_CUSTOM_TYPE,
  sessionContextPolicyMarker,
} = (await import(
  new URL("./session-context-policy.ts", import.meta.url).href
)) as typeof import("./session-context-policy");
moduleHooks.deregister();

test("normalizes custom policies and clamps their effective budget to model capacity", () => {
  const policy = normalizeSessionContextPolicy({
    mode: "custom",
    desiredContextTokens: 96_000,
    compaction: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 12_000 },
    ignored: true,
  });
  assert.deepEqual(policy, {
    mode: "custom",
    desiredContextTokens: 96_000,
    compaction: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 12_000 },
  });
  assert.equal(effectiveSessionContextBudget(policy!, 128_000), 96_000);
  assert.equal(effectiveSessionContextBudget(policy!, 64_000), 64_000);
  assert.equal(normalizeSessionContextPolicy({ mode: "custom" }), undefined);
});

test("latest policy marker is branch-local and inherit acts as a reset tombstone", () => {
  const custom = sessionContextPolicyMarker({ mode: "custom", desiredContextTokens: 80_000 });
  const entries = [
    { type: "custom", customType: SESSION_CONTEXT_POLICY_CUSTOM_TYPE, data: custom },
    {
      type: "custom",
      customType: SESSION_CONTEXT_POLICY_CUSTOM_TYPE,
      data: sessionContextPolicyMarker({ mode: "inherit" }),
    },
  ];
  assert.deepEqual(latestSessionContextPolicyMarker(entries), { version: 1, policy: null });
  assert.deepEqual(policyFromSessionEntries(entries), { mode: "inherit" });
  assert.deepEqual(policyFromSessionEntries(entries.slice(0, 1)), {
    mode: "custom",
    desiredContextTokens: 80_000,
  });
});
