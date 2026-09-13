import assert from "node:assert/strict";
import test from "node:test";
import { readDesktopSettingsPort } from "../src/settings";

test("an older desktop bridge keeps core settings available without the new sound listener", () => {
  const legacyPort = {
    load() {},
    update() {},
    setUpdateToken() {},
    runUpdate() {},
    subscribe() {},
    syncTasks() {},
    onOpenTask() {},
  };
  assert.equal(readDesktopSettingsPort(legacyPort), legacyPort);
  const currentPort = { ...legacyPort, onNotificationSound() {} };
  assert.equal(readDesktopSettingsPort(currentPort), currentPort);
  assert.equal(readDesktopSettingsPort(undefined), undefined);
  assert.equal(readDesktopSettingsPort({}), undefined);
  assert.equal(readDesktopSettingsPort({ ...legacyPort, load: undefined }), undefined);
  assert.equal(readDesktopSettingsPort({ ...legacyPort, onNotificationSound: true }), undefined);
});
