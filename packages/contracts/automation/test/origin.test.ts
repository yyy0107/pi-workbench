import assert from "node:assert/strict";
import test from "node:test";

import { parseAutomationSessionOrigin } from "@workbench/automation-contracts";

const VALID_ORIGIN = {
  version: 1,
  origin: "automation",
  automationId: "automation-1",
  automationName: "Daily summary",
  source: "manual",
  triggeredAt: 1_725_000_000_000,
} as const;

test("parseAutomationSessionOrigin accepts manual and scheduled provenance", () => {
  assert.deepEqual(parseAutomationSessionOrigin(VALID_ORIGIN), VALID_ORIGIN);

  const scheduled = { ...VALID_ORIGIN, source: "schedule" } as const;
  assert.deepEqual(parseAutomationSessionOrigin(scheduled), scheduled);
});

test("parseAutomationSessionOrigin preserves finite timestamps accepted by the wire contract", () => {
  const epoch = { ...VALID_ORIGIN, triggeredAt: 0 };
  const beforeEpoch = { ...VALID_ORIGIN, triggeredAt: -1 };

  assert.deepEqual(parseAutomationSessionOrigin(epoch), epoch);
  assert.deepEqual(parseAutomationSessionOrigin(beforeEpoch), beforeEpoch);
});

test("parseAutomationSessionOrigin rejects malformed provenance", () => {
  const invalidValues = [
    undefined,
    null,
    [],
    { ...VALID_ORIGIN, version: 2 },
    { ...VALID_ORIGIN, origin: "execution" },
    { ...VALID_ORIGIN, automationId: "" },
    { ...VALID_ORIGIN, automationName: "" },
    { ...VALID_ORIGIN, source: "event" },
    { ...VALID_ORIGIN, triggeredAt: "1725000000000" },
    { ...VALID_ORIGIN, triggeredAt: Number.NaN },
    { ...VALID_ORIGIN, triggeredAt: Number.POSITIVE_INFINITY },
  ];

  for (const value of invalidValues) {
    assert.equal(parseAutomationSessionOrigin(value), undefined);
  }
});
