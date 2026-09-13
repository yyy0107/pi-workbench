import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WorkbenchMain, resolveThreadResponsiveLayout } from "@workbench/shell-context/layout";
import {
  WorkbenchApplicationProviders,
  WorkbenchApplicationShell,
} from "@workbench/shell/application";
import {
  createWorkbenchDraftPersistence,
  createWorkbenchThreadScrollPersistence,
} from "@workbench/shell/browser-session-persistence";
import { truncateConversationTitle } from "@workbench/ui-conversation/title";
import {
  WorkbenchDomIdsProvider,
  resolveWorkbenchShellOwner,
  useWorkbenchDomIds,
} from "@workbench/shell-context/dom";
import {
  DefaultRightWorkspaceController,
  MemoryWorkspaceFeedbackStore,
  RightWorkspaceControllerDisposedError,
  WorkspaceFeedbackStoreDisposedError,
  createRightWorkspacePromptFeedbackPort,
  createRightWorkspaceStore,
  resolveRightWorkspacePresentation,
} from "@workbench/workspace-runtime";
import * as rightWorkspace from "@workbench/workspace-runtime";
import {
  RightWorkspaceProvider,
  WorkspaceSurfaceRuntimeHost,
  useRightWorkspace,
  useWorkspaceDraftStore,
} from "@workbench/workspace-runtime/react";
import * as rightWorkspaceReact from "@workbench/workspace-runtime/react";
import { resolveCollapsibleResizePreview } from "@workbench/ui-resize";
import { WorkbenchStatusbar } from "@workbench/ui-layout/statusbar";
import { createI18n as createServerI18n } from "@workbench/shell/i18n/runtime";
import { createPanelStore } from "@workbench/shell-context/panel-store";
import { createWorkspaceDirectoryStoreInstallation } from "@workbench/workspace-runtime/directory-store";
import { MemoryFileDiffService } from "@workbench/workspace-files";
import {
  createRightWorkspacePersistence,
  type RightWorkspaceLegacyStorage,
} from "@workbench/workspace-runtime/persistence";
import { createRunningIndicatorCatalog } from "@workbench/shell-context/running-indicator";
import type {
  LocalizableTextValidator,
  RightWorkspaceDraftPersistencePort,
  RightWorkspaceController,
  RightWorkspacePersistencePort,
  RightWorkspaceState,
} from "@workbench/workspace-runtime";

type ShellStateMustStayPublic = RightWorkspaceState;
const shellStateTypeCheck: ShellStateMustStayPublic | undefined = undefined;
const controllerTypeCheck: RightWorkspaceController | undefined = undefined;
const persistenceTypeCheck: RightWorkspacePersistencePort | undefined = undefined;
const validatorTypeCheck: LocalizableTextValidator | undefined = undefined;
const legacyStorageTypeCheck: RightWorkspaceLegacyStorage | undefined = undefined;
const draftPersistenceTypeCheck: RightWorkspaceDraftPersistencePort | undefined = undefined;

test("public Shell subpaths expose the finite Shell contracts", () => {
  assert.equal(typeof WorkbenchMain, "function");
  assert.equal(typeof WorkbenchApplicationProviders, "function");
  assert.equal(typeof WorkbenchApplicationShell, "function");
  assert.equal(typeof createWorkbenchDraftPersistence, "function");
  assert.equal(typeof createWorkbenchThreadScrollPersistence, "function");
  assert.equal(typeof createWorkspaceDirectoryStoreInstallation, "function");
  assert.equal(typeof MemoryFileDiffService, "function");
  assert.equal(typeof resolveThreadResponsiveLayout, "function");
  assert.equal(typeof truncateConversationTitle, "function");
  assert.equal(typeof WorkbenchDomIdsProvider, "function");
  assert.equal(typeof useWorkbenchDomIds, "function");
  assert.equal(typeof resolveWorkbenchShellOwner, "function");
  assert.equal(typeof createRightWorkspaceStore, "function");
  assert.equal(typeof resolveRightWorkspacePresentation, "function");
  assert.equal(typeof DefaultRightWorkspaceController, "function");
  assert.equal(typeof RightWorkspaceControllerDisposedError, "function");
  assert.equal(typeof MemoryWorkspaceFeedbackStore, "function");
  assert.equal(typeof WorkspaceFeedbackStoreDisposedError, "function");
  assert.equal(typeof createRightWorkspacePromptFeedbackPort, "function");
  assert.equal(typeof RightWorkspaceProvider, "function");
  assert.equal(typeof WorkspaceSurfaceRuntimeHost, "function");
  assert.equal(typeof useRightWorkspace, "function");
  assert.equal(typeof useWorkspaceDraftStore, "function");
  assert.equal(typeof resolveCollapsibleResizePreview, "function");
  assert.equal(typeof WorkbenchStatusbar, "function");
  assert.equal(typeof createServerI18n, "function");
  assert.equal(typeof createPanelStore, "function");
  assert.equal(typeof createRightWorkspacePersistence, "function");
  assert.equal(typeof createRunningIndicatorCatalog, "function");
  assert.equal(shellStateTypeCheck, undefined);
  assert.equal(controllerTypeCheck, undefined);
  assert.equal(persistenceTypeCheck, undefined);
  assert.equal(validatorTypeCheck, undefined);
  assert.equal(legacyStorageTypeCheck, undefined);
  assert.equal(draftPersistenceTypeCheck, undefined);
});

test("RightWorkspace exposes state without re-exporting SDK authoring contracts", async () => {
  assert.equal("WORKSPACE_SCOPE_TYPES" in rightWorkspace, false);
  assert.equal("WORKSPACE_SURFACE_PLACEMENTS" in rightWorkspace, false);
  assert.equal("RIGHT_WORKSPACE_STORAGE_KEY" in rightWorkspace, false);
  assert.equal("PromptFeedbackPort" in rightWorkspace, false);
  assert.equal("RightWorkspaceReactContext" in rightWorkspaceReact, false);
  assert.equal("useRightWorkspaceEnvironment" in rightWorkspaceReact, false);

  const [publicEntry, surfaceTypes] = await Promise.all([
    readFile(new URL("../../../workspace/workspace-runtime/src/index.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../workspace/workspace-runtime/src/surface-types.ts", import.meta.url),
      "utf8",
    ),
  ]);
  const sdkAuthoringTypeNames = [
    "AnyWorkspaceSurfaceDefinition",
    "OpenSurfaceRequest",
    "SurfaceOpenPolicy",
    "WorkspaceContext",
    "WorkspaceScope",
    "WorkspaceScopeType",
    "WorkspaceSurfaceCachePolicy",
    "WorkspaceSurfaceDefinition",
    "WorkspaceSurfaceInstance",
    "WorkspaceSurfaceKind",
    "WorkspaceSurfaceMenuItemProps",
    "WorkspaceSurfacePlacement",
    "WorkspaceSurfacePersistence",
    "WorkspaceSurfaceProps",
    "WorkspaceSurfaceRegistry",
    "WorkspaceSurfaceStatus",
  ];

  assert.doesNotMatch(publicEntry, /@workbench\/extension-sdk/u);
  for (const typeName of sdkAuthoringTypeNames) {
    assert.doesNotMatch(publicEntry, new RegExp(`\\b${typeName}\\b`, "u"));
  }
  assert.equal(surfaceTypes.includes("import type { WorkspaceSurfaceInstance }"), true);
  assert.equal(surfaceTypes.includes("@workbench/extension-sdk"), true);
  assert.equal(surfaceTypes.includes("export {"), false);
  assert.equal(surfaceTypes.includes("export type {"), false);
});

test("Shell manifest exposes only finite public subpaths", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { exports: Record<string, unknown> };

  assert.deepEqual(Object.keys(manifest.exports).sort(), [
    "./application",
    "./browser-session-persistence",
    "./extensions",
    "./i18n",
    "./i18n/runtime",
    "./styles.css",
  ]);
  assert.equal(
    Object.keys(manifest.exports).some((entry) => entry.includes("*")),
    false,
  );
});

async function readServerRuntimeGraph(entry: string): Promise<ReadonlyMap<string, string>> {
  const pending = [entry];
  const sources = new Map<string, string>();

  while (pending.length > 0) {
    const filename = pending.pop();
    if (!filename || sources.has(filename)) continue;
    const source = await readFile(filename, "utf8");
    sources.set(filename, source);

    for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier) continue;
      const target = path.resolve(path.dirname(filename), specifier);
      for (const candidate of [`${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
        try {
          await readFile(candidate, "utf8");
          pending.push(candidate);
          break;
        } catch {
          // Try the next source extension.
        }
      }
    }
  }

  return sources;
}

test("the server-safe i18n runtime graph contains no React client module", async () => {
  const entry = fileURLToPath(new URL("../src/i18n/public-runtime.ts", import.meta.url));
  const sources = await readServerRuntimeGraph(entry);

  assert.ok(sources.size > 1);
  for (const [filename, source] of sources) {
    assert.doesNotMatch(source, /^\s*["']use client["']/mu, filename);
    assert.doesNotMatch(source, /["']react(?:\/[^"']*)?["']/u, filename);
    assert.doesNotMatch(source, /["']\.\/provider["']/u, filename);
  }
});
