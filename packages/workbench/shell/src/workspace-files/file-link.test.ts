import assert from "node:assert/strict";
import test from "node:test";
import { fileLinkResource, parseLocalFileHref } from "./file-link";

test("resolves local file links, encoded filenames and editor locations", () => {
  for (const [href, expected] of [
    ["/tmp/notes.md:12:3", "/tmp/notes.md"],
    ["file:///tmp/a%20b.md#L12", "/tmp/a b.md"],
    ["file://localhost/tmp/a.md", "/tmp/a.md"],
    ["../other/index.ts#L4", "/other/index.ts"],
    ["index.ts:12", "/project/index.ts"],
    ["./a%23b%25c%3A12.md", "/project/a#b%c:12.md"],
    ["/tmp/name%3A12", "/tmp/name:12"],
    ["~/notes.md", "~/notes.md"],
    [String.raw`C:\Users\me\notes.md:4`, "C:/Users/me/notes.md"],
    ["file:///C:/Users/me/a%20b.md", "C:/Users/me/a b.md"],
  ])
    assert.deepEqual(fileLinkResource(href, "/project"), { scheme: "file", path: expected }, href);
  assert.deepEqual(fileLinkResource("../notes.md", "C:\\Users\\me"), {
    scheme: "file",
    path: "C:/Users/notes.md",
  });
  assert.deepEqual(fileLinkResource("/tmp/a.md"), { scheme: "file", path: "/tmp/a.md" });
  assert.throws(() => fileLinkResource("notes.md"), /requires a workspace root/);
});

test("excludes remote URLs, anchors, UNC paths and malformed local links", () => {
  for (const href of [
    "",
    "#details",
    "?query",
    "https://example.com/a.md",
    "//example.com/a.md",
    "mailto:123",
    "javascript:alert(1)",
    "data:text/html,test",
    "sandbox:/mnt/a.md",
    "file://server/share/a.md",
    String.raw`\\server\share\a.md`,
    "/tmp/%00bad",
    "/tmp/%ZZ",
    "file:///%2Fserver/a.md",
  ]) {
    assert.equal(parseLocalFileHref(href), undefined, href);
  }
});
