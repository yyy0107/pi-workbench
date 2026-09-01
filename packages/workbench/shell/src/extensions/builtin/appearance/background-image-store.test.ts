import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchSettingsPort, WorkbenchSettingsPreferences } from "../../../settings";

import { createBackgroundImageStore } from "./background-image-store";

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

test("background stores revoke owned URLs and ignore hydration completion after disposal", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      atob: globalThis.atob.bind(globalThis),
      indexedDB: {
        open() {
          throw new Error("No legacy IndexedDB fixture");
        },
      },
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value() {
      const url = `blob:workbench-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value(url: string) {
      revokedUrls.push(url);
    },
  });

  const backgroundImage = {
    name: "background.png",
    mimeType: "image/png",
    data: "AA==",
  } as const;
  const immediateSettings: WorkbenchSettingsPort = {
    async load() {
      return { backgroundImage };
    },
    async update() {},
  };

  try {
    const immediateStore = createBackgroundImageStore(immediateSettings);
    await immediateStore.hydrate();
    assert.equal(immediateStore.getSnapshot().url, "blob:workbench-1");
    immediateStore.dispose();
    immediateStore.dispose();
    assert.deepEqual(revokedUrls, ["blob:workbench-1"]);
    assert.equal(immediateStore.getSnapshot().status, "idle");

    let resolveLoad!: (preferences: WorkbenchSettingsPreferences) => void;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const deferredPreferences = new Promise<WorkbenchSettingsPreferences>((resolve) => {
      resolveLoad = resolve;
    });
    const deferredSettings: WorkbenchSettingsPort = {
      load() {
        markLoadStarted();
        return deferredPreferences;
      },
      async update() {},
    };
    const deferredStore = createBackgroundImageStore(deferredSettings);
    const hydration = deferredStore.hydrate();
    await loadStarted;
    deferredStore.dispose();
    resolveLoad({ backgroundImage });
    await hydration;

    assert.deepEqual(createdUrls, ["blob:workbench-1"]);
    assert.deepEqual(revokedUrls, ["blob:workbench-1"]);
    assert.equal(deferredStore.getSnapshot().status, "idle");
  } finally {
    restoreProperty(globalThis, "window", originalWindow);
    restoreProperty(URL, "createObjectURL", originalCreateObjectUrl);
    restoreProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  }
});
