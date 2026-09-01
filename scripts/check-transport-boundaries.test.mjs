import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { transportBoundaryViolations } from "./check-transport-boundaries.mjs";

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), "workbench-transport-boundary-"));
}

async function source(root, relativeFilename, contents) {
  const filename = path.join(root, relativeFilename);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}

test("rejects direct browser transport, standalone Pi helpers, and a raw workspace media endpoint", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "apps/web/src/extensions/builtin/unsafe.ts",
    [
      'import { callPiRpc } from "@workbench/agent-runtime-pi-client/api";',
      "const socket = new WebSocket(`${window.location.origin}/api/pi/events`);",
      'const preview = "/api/workspace.files.content?workspaceId=one";',
      "void callPiRpc; void socket; void preview;",
    ].join("\n"),
  );

  const violations = await transportBoundaryViolations(root);
  assert.equal(violations.length, 4, JSON.stringify(violations, null, 2));
  assert.ok(violations.some((violation) => violation.includes("construct WebSocket directly")));
  assert.ok(violations.some((violation) => violation.includes("location.origin")));
  assert.ok(violations.some((violation) => violation.includes("workspace.files.content")));
  assert.ok(violations.some((violation) => violation.includes("standalone Pi client helper")));
});

test("Shell leaf rejects host and product ownership imports", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "packages/workbench/shell/src/unsafe.ts",
    [
      'import "@/workbench/shell/main-view-host";',
      'import "next/navigation";',
      'import "node:fs";',
      'import "@workbench/agent-runtime-client/prompt-feedback";',
      'import "@workbench/agent-runtime-contracts/settings";',
      'import "@workbench/agent-runtime-server";',
      'import "@workbench/extension-sdk/internal";',
      'import "@workbench/extension-host/internal";',
      'import "react-i18next";',
      'import "node-pty";',
      'import "@earendil-works/pi-ai";',
      'import "electron";',
      'import "@tauri-apps/api/core";',
      'const endpoint = "/api/terminal";',
      "const socket = new WebSocket(endpoint);",
    ].join("\n"),
  );

  const violations = await transportBoundaryViolations(root);
  for (const detail of [
    "root alias",
    "Agent Runtime implementations",
    "finite Extension Platform public capabilities",
    "product settings or i18n",
    "Next.js",
    "Node production APIs",
    "native packages",
    "Pi",
    "Electron",
    "Tauri",
    "hardcode product endpoints",
    "construct WebSocket directly",
  ]) {
    assert.ok(
      violations.some((violation) => violation.includes(detail)),
      JSON.stringify(violations),
    );
  }
});

test("allows the explicit Pi contribution owner and installation composition seams", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "packages/workbench/shell/src/runtime-connection/runtime-connection.ts",
    "export const origin = window.location.origin;\n",
  );
  await source(
    root,
    "apps/web/src/workbench/providers/installed-agent-runtime.tsx",
    'import { createPiRuntimeInstallation } from "@workbench/agent-runtime-pi-client/installation";\nvoid createPiRuntimeInstallation;\n',
  );
  await source(
    root,
    "packages/workbench/shell/src/safe.tsx",
    [
      'import { ExtensionErrorBoundary } from "@workbench/extension-host/hosts/extension-error-boundary";',
      'import { SlotHost } from "@workbench/extension-host/hosts/slot-host";',
      'import { usePanelRegistry, useSettingsRegistry } from "@workbench/extension-host";',
      'import { readAgentRunTiming } from "@workbench/agent-runtime-client/extras";',
      'import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";',
      "void ExtensionErrorBoundary; void SlotHost; void usePanelRegistry; void useSettingsRegistry; void readAgentRunTiming; void (null as unknown as WorkbenchSettingsPort);",
    ].join("\n"),
  );
  await source(
    root,
    "packages/workbench/shell/src/i18n/runtime.ts",
    [
      'import { createLocalizableMessageDescriptor } from "@workbench/extension-sdk/internal";',
      "void createLocalizableMessageDescriptor;",
    ].join("\n"),
  );
  await source(
    root,
    "packages/agent-runtime/adapters/pi/contributions/src/safe.ts",
    [
      'import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";',
      'import type { PiResourceClient } from "@workbench/agent-runtime-pi-client/resources";',
      'import { type PiWorkspaceId } from "@workbench/agent-runtime-pi-client/workspace";',
      'import { usePiWorkspaceClient, type PiWorkspaceClient } from "@workbench/agent-runtime-pi-client/workspace";',
      'import { PiApiError, usePiHostDescription } from "@workbench/agent-runtime-pi-client/host";',
      'import { usePiWorkspaces } from "@workbench/agent-runtime-pi-client/workspace";',
      'import { useSessionContextPolicy } from "@workbench/agent-runtime-pi-client/configuration";',
      'import { parsePiContextTraceData, WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME } from "@workbench/agent-runtime-pi-client/context-trace";',
      'import { PiBoundThreadRuntimeProvider } from "@workbench/agent-runtime-pi-client/side-chat";',
      'import { createPiPackageUpdatesQuery, IDLE_PI_PACKAGE_UPDATES_SNAPSHOT, piPackageUpdatesTargetKey } from "@workbench/agent-runtime-pi-client/resources";',
      'export type { PiPackageUpdatesQuery } from "@workbench/agent-runtime-pi-client/resources";',
      'import type { PiResourceCatalogTarget } from "@workbench/agent-runtime-pi-protocol/rpc";',
      'import type { PiModelDescriptor } from "@workbench/agent-runtime-pi-shared/models";',
      "// /api/workspace.files.content is forbidden only in executable source.",
      "export function go() { window.location.assign('/settings'); return window.location.pathname; }",
      "void usePiResourceClient; void usePiWorkspaceClient; void usePiHostDescription; void usePiWorkspaces; void useSessionContextPolicy; void PiApiError; void parsePiContextTraceData; void WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME; void PiBoundThreadRuntimeProvider; void createPiPackageUpdatesQuery; void IDLE_PI_PACKAGE_UPDATES_SNAPSHOT; void piPackageUpdatesTargetKey; void (null as unknown as PiResourceClient); void (null as unknown as PiWorkspaceClient); void (null as unknown as PiWorkspaceId); void (null as unknown as PiResourceCatalogTarget); void (null as unknown as PiModelDescriptor);",
    ].join("\n"),
  );

  assert.deepEqual(await transportBoundaryViolations(root), []);
});

test("Shell permits only the exact branded descriptor constructor boundary", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "packages/workbench/shell/src/i18n/runtime.ts",
    'import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";\nvoid WorkspaceSurfaceRegistryImpl;\n',
  );
  await source(
    root,
    "packages/workbench/shell/src/not-catalog.ts",
    'import { createLocalizableMessageDescriptor } from "@workbench/extension-sdk/internal";\nvoid createLocalizableMessageDescriptor;\n',
  );

  const violations = await transportBoundaryViolations(root);
  assert.equal(violations.length, 2, JSON.stringify(violations, null, 2));
  assert.ok(
    violations.every((violation) =>
      violation.includes("finite Extension Platform public capabilities"),
    ),
  );
});

test("Shell keeps product compatibility literals in one private source file", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "packages/workbench/shell/src/legacy-pi-compat.ts",
    'export const legacy = "pi-command";\n',
  );
  await source(
    root,
    "packages/workbench/shell/src/product-copy.ts",
    'export const productName = "Pi Workbench";\n',
  );

  const violations = await transportBoundaryViolations(root);
  assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
  assert.match(violations[0], /legacy-pi-compat\.ts/u);
});

test("rejects standalone Pi client helpers outside the Pi contribution leaf", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "apps/web/src/extensions/builtin/pi-client-bypass.ts",
    [
      'import { describePiSettings } from "@workbench/agent-runtime-pi-client/configuration";',
      'import * as PiWorkspace from "@workbench/agent-runtime-pi-client/workspace";',
      'export { updatePiSettings } from "@workbench/agent-runtime-pi-client/external-import";',
      'void import("@workbench/agent-runtime-pi-client/resources");',
      'require("@workbench/agent-runtime-pi-client/host");',
      'import { listPiRpcSessionContextTrace } from "@workbench/agent-runtime-pi-client/context-trace";',
      "void describePiSettings; void PiWorkspace;",
    ].join("\n"),
  );

  const violations = await transportBoundaryViolations(root);
  assert.equal(violations.length, 6, JSON.stringify(violations, null, 2));
  assert.ok(violations.every((violation) => violation.includes("standalone Pi client helper")));
});

test("rejects root, Next, host-internal, server, and SDK imports from Pi contributions", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "packages/agent-runtime/adapters/pi/contributions/src/unsafe.ts",
    [
      'import "@/components/ui/button";',
      'import "next/navigation";',
      'import "@workbench/extension-host/internal";',
      'import "@workbench/agent-runtime-pi-server/installation";',
      'import "@earendil-works/pi-coding-agent";',
    ].join("\n"),
  );

  const violations = await transportBoundaryViolations(root);
  for (const detail of [
    "must not import the root alias",
    "must not import Next.js",
    "must use Extension Platform public APIs",
    "must not import the Pi server",
    "must use the Pi client seam",
  ]) {
    assert.ok(
      violations.some((violation) => violation.includes(detail)),
      JSON.stringify(violations),
    );
  }
});

test("allows only the narrow Workbench settings composition factory", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "apps/web/src/workbench/providers/installed-workbench-settings.ts",
    [
      'import { createPiWorkbenchSettingsClient, type PiWorkbenchSettingsClientOptions } from "@workbench/agent-runtime-pi-client/workbench-settings";',
      "void createPiWorkbenchSettingsClient; void (null as unknown as PiWorkbenchSettingsClientOptions);",
    ].join("\n"),
  );
  await source(
    root,
    "apps/web/src/workbench/providers/not-a-composition-root.ts",
    'import { createPiWorkbenchSettingsClient } from "@workbench/agent-runtime-pi-client/workbench-settings";\nvoid createPiWorkbenchSettingsClient;\n',
  );

  const violations = await transportBoundaryViolations(root);
  assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
  assert.ok(violations[0].includes("not-a-composition-root"));
});

test("rejects re-export, dynamic import, and require bypasses of a standalone Pi helper", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await source(
    root,
    "apps/web/src/services/unsafe.ts",
    [
      'export { callPiRpc } from "@workbench/agent-runtime-pi-client/api";',
      'void import("@workbench/agent-runtime-pi-client/host");',
      'require("@workbench/agent-runtime-pi-client/resources");',
    ].join("\n"),
  );

  const violations = await transportBoundaryViolations(root);
  assert.equal(violations.length, 3, JSON.stringify(violations, null, 2));
});
