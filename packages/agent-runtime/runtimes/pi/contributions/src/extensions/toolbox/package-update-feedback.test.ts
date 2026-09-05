import assert from "node:assert/strict";
import test from "node:test";

import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import type { PiPackageUpdatePayload } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  packageUpdateErrorMessageKey,
  updatePackageWithFeedback,
  type PackageUpdateFeedback,
} from "./package-update-feedback";

test("package updates preserve the exact source and target and report success only after completion", async () => {
  for (const target of [
    { scope: "user" },
    { scope: "project", workspaceId: "project-a" },
  ] as const) {
    const payload: PiPackageUpdatePayload = { source: "npm:@example/package@^1.0.0", target };
    const feedback: PackageUpdateFeedback[] = [];
    let finish!: () => void;
    const operation = updatePackageWithFeedback(
      {
        updatePackage: async (received) => {
          assert.deepEqual(received, payload);
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { source: received.source, ...target, reloadRequired: false };
        },
      },
      payload,
      (next) => feedback.push(next),
    );
    assert.deepEqual(feedback, [{ status: "updating" }]);
    finish();
    assert.equal(await operation, true);
    assert.deepEqual(feedback, [{ status: "updating" }, { status: "updated" }]);
  }
});

test("failed updates retain actionable errors, allow retry, and never report success", async () => {
  const payload = { source: "git:example/package", target: { scope: "user" as const } };
  const expected = {
    "project-untrusted": "updateProjectUntrusted",
    "workspace-not-found": "updateWorkspaceMissing",
    "package-not-installed": "updateAlreadyMissing",
    "session-not-found": "updateSessionMissing",
    "session-busy": "mutationSessionBusy",
    "update-failed": "updateFailed",
  };
  for (const [code, key] of Object.entries(expected)) {
    const feedback: PackageUpdateFeedback[] = [];
    const updated = await updatePackageWithFeedback(
      {
        updatePackage: async () => {
          throw new PiApiError(code, 409);
        },
      },
      payload,
      (next) => feedback.push(next),
    );
    assert.equal(updated, false);
    assert.deepEqual(feedback, [{ status: "updating" }, { status: "failed", errorCode: code }]);
    assert.equal(packageUpdateErrorMessageKey(code), `extensions.toolbox.packages.${key}`);
  }
  const feedback: PackageUpdateFeedback[] = [];
  let attempts = 0;
  const client = {
    updatePackage: async () => {
      if (++attempts === 1) throw new Error("network disconnected");
      return { source: payload.source, scope: "user" as const, reloadRequired: false as const };
    },
  };
  assert.equal(
    await updatePackageWithFeedback(client, payload, (next) => feedback.push(next)),
    false,
  );
  assert.equal(
    await updatePackageWithFeedback(client, payload, (next) => feedback.push(next)),
    true,
  );
  assert.deepEqual(
    feedback.map((entry) => entry.status),
    ["updating", "failed", "updating", "updated"],
  );
  assert.equal(packageUpdateErrorMessageKey(), "extensions.toolbox.packages.updateFailed");
});
