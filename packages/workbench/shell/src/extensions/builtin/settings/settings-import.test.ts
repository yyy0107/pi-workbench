import assert from "node:assert/strict";
import test from "node:test";
import { readSettingsImport } from "./settings-import";

test("imports portable preferences without migrating host paths or credentials", () => {
  assert.deepEqual(
    readSettingsImport(
      JSON.stringify({
        version: 1,
        preferences: {
          locale: "zh-CN",
          enhancedSearch: true,
          todoEnabled: false,
          sidebarSelectedThreadId: "old-host",
        },
        workspaces: [{ path: "/other-host" }],
      }),
    ),
    { locale: "zh-CN", enhancedSearch: true, todoEnabled: false },
  );
  assert.throws(() => readSettingsImport('{"version":2,"preferences":{"locale":"zh-CN"}}'));
  assert.throws(() => readSettingsImport('{"apiKey":"secret"}'));
});
