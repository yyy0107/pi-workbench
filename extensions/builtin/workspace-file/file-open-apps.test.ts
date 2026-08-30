import assert from "node:assert/strict";
import test from "node:test";

import type { LocalAppView } from "@/workbench/runtime-contributions/pi/protocol/rpc";

import {
  compatibleLocalFileApps,
  compatibleLocalFolderApps,
  localAppFileKindFor,
  localSystemApps,
} from "./file-open-apps";

const apps: LocalAppView[] = [
  {
    id: "vscode",
    name: "VS Code",
    kind: "editor",
    supportedFileKinds: ["text"],
  },
  {
    id: "mpv",
    name: "mpv Media Player",
    kind: "media-player",
    icon: "mpv",
    supportedFileKinds: ["audio", "video"],
  },
  {
    id: "vlc",
    name: "VLC media player",
    kind: "media-player",
    icon: "vlc",
    supportedFileKinds: ["audio", "video"],
  },
  {
    id: "terminal",
    name: "Terminal",
    kind: "terminal",
    supportedFileKinds: [],
  },
  {
    id: "file-manager",
    name: "File Manager",
    kind: "file-manager",
    supportedFileKinds: [],
  },
];

test("classifies text, media, documents, archives, and unknown binary files", () => {
  assert.equal(localAppFileKindFor("index.ts", "text/plain", "utf-8"), "text");
  assert.equal(localAppFileKindFor("photo.svg", "text/plain", "utf-8"), "image");
  assert.equal(localAppFileKindFor("sound.mp3", "application/octet-stream", null), "audio");
  assert.equal(localAppFileKindFor("clip.MKV", "application/octet-stream", null), "video");
  assert.equal(localAppFileKindFor("manual.bin", "application/pdf", null), "pdf");
  assert.equal(localAppFileKindFor("report.xlsx", "application/octet-stream", null), "document");
  assert.equal(localAppFileKindFor("source.tar.gz", "application/gzip", null), "archive");
  assert.equal(localAppFileKindFor("bundle.rar", "application/vnd.rar", null), "archive");
  assert.equal(localAppFileKindFor("payload.bin", "application/octet-stream", null), "other");
});

test("only returns applications that declare support for the selected file type", () => {
  assert.deepEqual(
    compatibleLocalFileApps(apps, "text").map((app) => app.id),
    ["vscode"],
  );
  assert.deepEqual(
    compatibleLocalFileApps(apps, "video").map((app) => app.id),
    ["mpv", "vlc"],
  );
  assert.deepEqual(compatibleLocalFileApps(apps, "image"), []);
  assert.deepEqual(compatibleLocalFileApps(apps, "other"), []);
});

test("keeps terminal and file manager actions separate from file-opening applications", () => {
  assert.deepEqual(
    localSystemApps(apps).map((app) => app.id),
    ["terminal", "file-manager"],
  );
});

test("offers installed editors for a file workspace root folder", () => {
  assert.deepEqual(
    compatibleLocalFolderApps(apps).map((app) => app.id),
    ["vscode"],
  );
});
