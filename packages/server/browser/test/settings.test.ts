import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_BROWSER_SETTINGS } from "@workbench/browser-contracts";
import { BrowserSettingsStore } from "../src/settings";

test("old width settings load without losing preferences and disappear on the next update", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const fitToWidth of [true, false]) {
    const file = path.join(directory, `${fitToWidth}.json`);
    const expected = {
      ...DEFAULT_BROWSER_SETTINGS,
      defaultZoom: 1.25,
      showFullUrl: true,
      permissions: { ...DEFAULT_BROWSER_SETTINGS.permissions, history: "deny" as const },
    };
    await writeFile(file, JSON.stringify({ ...expected, fitToWidth }));
    const store = new BrowserSettingsStore(file);
    assert.deepEqual(await store.get(), expected);
    const unsupported = { defaultZoom: 1.5, fitToWidth };
    await assert.rejects(store.update(unsupported), { code: "browser-invalid" });
    assert.deepEqual(await store.get(), expected);
    await store.update({ defaultZoom: 1.5 });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      ...expected,
      defaultZoom: 1.5,
    });
  }
});

test("legacy width cleanup preserves strict validation of malformed and unknown settings", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-settings-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  for (const stored of [
    { fitToWidth: true, unexpected: true },
    { fitToWidth: "true" },
    { fitToWidth: false, defaultZoom: 99 },
    { permissions: { navigate: "invalid" } },
    { permissions: { navigate: "allow", unknown: "allow" } },
    { sites: [{ origin: "https://example.test", permissions: { navigate: true } }] },
  ]) {
    await writeFile(file, JSON.stringify(stored));
    await assert.rejects(new BrowserSettingsStore(file).get(), {
      code: "browser-operation-failed",
    });
  }
});

test("legacy navigation permissions are removed from global and per-site preferences only on load", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-navigation-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  const expected = {
    ...DEFAULT_BROWSER_SETTINGS,
    defaultZoom: 1.25,
    permissions: { ...DEFAULT_BROWSER_SETTINGS.permissions, history: "deny" as const },
    sites: [{ origin: "https://example.test", permissions: { upload: "deny" as const } }],
  };
  for (const navigate of ["allow", "ask", "deny"]) {
    await writeFile(
      file,
      JSON.stringify({
        ...expected,
        permissions: { ...expected.permissions, navigate },
        sites: [{ ...expected.sites[0], permissions: { upload: "deny", navigate } }],
      }),
    );
    const store = new BrowserSettingsStore(file);
    assert.deepEqual(await store.get(), expected);
    const globalPatch = { permissions: { ...expected.permissions, navigate } };
    const sitePatch = {
      sites: [{ ...expected.sites[0], permissions: { upload: "deny" as const, navigate } }],
    };
    await assert.rejects(store.update(globalPatch), {
      code: "browser-invalid",
    });
    await assert.rejects(store.update(sitePatch), { code: "browser-invalid" });
    await store.update({ showFullUrl: true });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { ...expected, showFullUrl: true });
  }
});
