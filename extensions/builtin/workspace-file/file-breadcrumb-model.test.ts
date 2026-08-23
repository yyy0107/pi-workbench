import assert from "node:assert/strict";
import test from "node:test";

import { fileBreadcrumbSegments, fileBreadcrumbTreeRootPath } from "./file-breadcrumb-model";

test("builds clickable workspace breadcrumb paths", () => {
  assert.deepEqual(
    fileBreadcrumbSegments(
      "/workspace/pi",
      "server/streams/stream-hub.ts",
      "/workspace/pi/server/streams/stream-hub.ts",
    ),
    [
      { label: "pi", path: "/workspace/pi", kind: "directory", current: false },
      {
        label: "server",
        path: "/workspace/pi/server",
        kind: "directory",
        current: false,
      },
      {
        label: "streams",
        path: "/workspace/pi/server/streams",
        kind: "directory",
        current: false,
      },
      {
        label: "stream-hub.ts",
        path: "/workspace/pi/server/streams/stream-hub.ts",
        kind: "file",
        current: true,
      },
    ],
  );
});

test("uses the selected directory as the tree root and a file's parent for file segments", async (t) => {
  const segments = fileBreadcrumbSegments(
    "/workspace/pi",
    "server/streams/stream-hub.ts",
    "/workspace/pi/server/streams/stream-hub.ts",
  );

  await t.test("directory segment", () => {
    assert.equal(fileBreadcrumbTreeRootPath(segments, 2), "/workspace/pi/server/streams");
  });
  await t.test("file segment", () => {
    assert.equal(fileBreadcrumbTreeRootPath(segments, 3), "/workspace/pi/server/streams");
  });
});

test("preserves Windows workspace separators", () => {
  assert.equal(
    fileBreadcrumbSegments(
      "C:\\workspace\\pi",
      "server\\stream-hub.ts",
      "C:\\workspace\\pi\\server\\stream-hub.ts",
    )[1]?.path,
    "C:\\workspace\\pi\\server",
  );
});
