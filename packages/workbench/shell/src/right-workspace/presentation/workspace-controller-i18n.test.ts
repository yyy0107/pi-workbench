import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceSurfaceDefinition } from "@workbench/extension-sdk";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import {
  DefaultRightWorkspaceController,
  createRightWorkspaceStore,
  type RightWorkspacePersistencePort,
} from "../../right-workspace";

import { createI18n, defineMessage, isLocalizableText, resolveText } from "../../i18n";

const FixtureIcon = (() => null) as unknown as WorkspaceSurfaceDefinition["icon"];

test("the product catalog validator restores localizable titles across locale changes", async () => {
  let serialized: string | null = null;
  const persistence: RightWorkspacePersistencePort = {
    async read() {
      return serialized;
    },
    async write(value) {
      serialized = value;
    },
  };
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register({
    kind: "file",
    icon: FixtureIcon,
    cachePolicy: "keep-alive",
    getResourceKey: (params) => String(params.absolutePath),
    render: () => null,
  });
  const firstController = new DefaultRightWorkspaceController(
    createRightWorkspaceStore(),
    registry,
    { validateLocalizableText: isLocalizableText, persistence },
  );
  await firstController.initialize();
  const localizedId = firstController.open({
    kind: "file",
    title: defineMessage("extensions.workspaceBrowser.title"),
    params: { absolutePath: "/workspace/review" },
    context: { applicationId: "app" },
    status: "error",
    statusMessage: defineMessage("extensions.workspaceBrowser.navigateFailed"),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const restoredStore = createRightWorkspaceStore();
  await new DefaultRightWorkspaceController(restoredStore, registry, {
    validateLocalizableText: isLocalizableText,
    persistence,
  }).initialize();
  const localized = restoredStore.getState().surfaces[localizedId];
  assert.ok(localized);
  assert.deepEqual(localized.title, { key: "extensions.workspaceBrowser.title" });
  assert.deepEqual(localized.statusMessage, {
    key: "extensions.workspaceBrowser.navigateFailed",
  });

  const enUS = createI18n("en-US");
  const zhCN = createI18n("zh-CN");
  assert.equal(resolveText(enUS.t, localized.title), "Browser");
  assert.equal(resolveText(zhCN.t, localized.title), "浏览器");
  assert.equal(
    resolveText(enUS.t, localized.statusMessage!),
    "The browser could not navigate to that address. Try again.",
  );
  assert.equal(resolveText(zhCN.t, localized.statusMessage!), "浏览器无法前往该地址，请重试。");
});
