import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchLocalApp } from "@workbench/host-contracts/runtime-capabilities";

import {
  compatibleLocalFileApps,
  compatibleLocalFolderApps,
  localAppFileKindFor,
  localSystemApps,
  fileOpenPreferenceKey,
  preferredLocalApp,
  SYSTEM_DEFAULT_APP_ID,
  fileOpenSelectors,
} from "./file-open-apps";

const apps: WorkbenchLocalApp[] = [
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
    id: "chrome",
    name: "Google Chrome",
    kind: "browser",
    supportedFileKinds: ["html", "pdf"],
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

test("offers browsers for HTML and PDF while retaining HTML editors", () => {
  for (const filename of ["index.html", "page.HTM", "document.xhtml", "C:\\site\\INDEX.HTML"]) {
    assert.equal(localAppFileKindFor(filename, "text/plain", "utf-8"), "html");
  }
  assert.equal(localAppFileKindFor("page", "text/HTML; charset=utf-8", "utf-8"), "html");
  assert.equal(localAppFileKindFor("page", "application/xhtml+xml", "utf-8"), "html");
  assert.equal(localAppFileKindFor("template.html.ts", "text/plain", "utf-8"), "text");
  assert.equal(localAppFileKindFor("/site.html/README.md", "text/plain", "utf-8"), "text");
  assert.equal(localAppFileKindFor(undefined, undefined, undefined), "other");
  assert.deepEqual(
    compatibleLocalFileApps(apps, "html").map((app) => app.id),
    ["vscode", "chrome"],
  );
  assert.deepEqual(
    compatibleLocalFileApps(apps, "pdf").map((app) => app.id),
    ["chrome"],
  );
  assert.deepEqual(
    compatibleLocalFileApps(apps, "text").map((app) => app.id),
    ["vscode"],
  );
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

test("matches Office and image applications by extension, including uppercase Windows paths", () => {
  const choices: WorkbenchLocalApp[] = [
    {
      id: "word",
      name: "Word",
      kind: "office",
      supportedFileKinds: ["document"],
      supportedFileExtensions: ["docx"],
    },
    {
      id: "excel",
      name: "Excel",
      kind: "office",
      supportedFileKinds: ["document", "text"],
      supportedFileExtensions: ["xlsx", "csv"],
    },
    {
      id: "powerpoint",
      name: "PowerPoint",
      kind: "office",
      supportedFileKinds: ["document"],
      supportedFileExtensions: ["pptx"],
    },
    {
      id: "inkscape",
      name: "Inkscape",
      kind: "image-editor",
      supportedFileKinds: ["image"],
      supportedFileExtensions: ["svg"],
    },
    { id: "gimp", name: "GIMP", kind: "image-editor", supportedFileKinds: ["image"] },
  ];
  for (const [filename, expected] of [
    ["letter.docx", ["word"]],
    ["C:\\work\\table.XLSX", ["excel"]],
    ["data.csv", ["excel"]],
    ["slides.pptx", ["powerpoint"]],
    ["image.svg", ["inkscape", "gimp"]],
    ["image.png", ["gimp"]],
    ["script.ts", []],
  ] as const) {
    const kind = localAppFileKindFor(
      filename,
      undefined,
      filename.endsWith("csv") ? "utf-8" : null,
    );
    assert.deepEqual(
      compatibleLocalFileApps(choices, kind, filename).map((app) => app.id),
      expected,
    );
  }
  assert.deepEqual(compatibleLocalFileApps(choices, "document"), []);
});

test("resolves remembered choices only from compatible installed apps and falls back by type", () => {
  const htmlApps = compatibleLocalFileApps(apps, "html", "index.html");
  assert.equal(preferredLocalApp(htmlApps, "html", undefined)?.id, "vscode");
  assert.equal(preferredLocalApp(htmlApps, "html", "vscode")?.id, "vscode");
  assert.equal(preferredLocalApp(htmlApps, "html", "removed-browser")?.id, "vscode");
  assert.equal(preferredLocalApp(htmlApps, "html", "mpv")?.id, "vscode");
  assert.equal(preferredLocalApp(htmlApps, "html", SYSTEM_DEFAULT_APP_ID), undefined);
  assert.equal(preferredLocalApp([], "html", "chrome"), undefined);
  const reader: WorkbenchLocalApp = {
    id: "acrobat",
    name: "Acrobat",
    kind: "pdf-reader",
    supportedFileKinds: ["pdf"],
  };
  const pdfApps = compatibleLocalFileApps([...apps, reader], "pdf", "file.pdf");
  assert.equal(preferredLocalApp(pdfApps, "pdf", undefined)?.id, "acrobat");
  assert.equal(preferredLocalApp(pdfApps, "pdf", "chrome")?.id, "chrome");
  assert.equal(fileOpenPreferenceKey("C:\\site\\PAGE.HTML", "html"), "extension:html");
  assert.notEqual(
    fileOpenPreferenceKey("file.docx", "document"),
    fileOpenPreferenceKey("file.xlsx", "document"),
  );
  assert.equal(fileOpenPreferenceKey("README", "text"), "kind:text");
  assert.equal(fileOpenPreferenceKey(undefined, "other"), "folder");
});

test("gives HTML separate editor and browser selectors with independent remembered choices", () => {
  const choices: WorkbenchLocalApp[] = [
    ...apps,
    { id: "cursor", name: "Cursor", kind: "editor", supportedFileKinds: ["text"] },
    { id: "firefox", name: "Firefox", kind: "browser", supportedFileKinds: ["html", "pdf"] },
  ];
  const selectors = fileOpenSelectors(choices, "index.html", "html", {
    "extension:html": "cursor",
    "browser:extension:html": "firefox",
  });
  assert.deepEqual(
    selectors.map((selector) => ({
      id: selector.id,
      apps: selector.apps.map((app) => app.id),
      primary: selector.primaryApp?.id,
      key: selector.preferenceKey,
      allowSystemDefault: selector.allowSystemDefault,
    })),
    [
      {
        id: "file",
        apps: ["vscode", "cursor"],
        primary: "cursor",
        key: "extension:html",
        allowSystemDefault: false,
      },
      {
        id: "browser",
        apps: ["chrome", "firefox"],
        primary: "firefox",
        key: "browser:extension:html",
        allowSystemDefault: false,
      },
    ],
  );
  const legacy = fileOpenSelectors(choices, "index.html", "html", { "extension:html": "firefox" });
  assert.deepEqual(
    legacy.map((selector) => selector.primaryApp?.id),
    ["vscode", "firefox"],
  );
  const defaults = fileOpenSelectors(choices, "index.html", "html", {
    "extension:html": SYSTEM_DEFAULT_APP_ID,
  });
  assert.deepEqual(
    defaults.map((selector) => selector.primaryApp?.id),
    ["vscode", "chrome"],
  );
  const missingEditor = fileOpenSelectors([choices.at(-1)!], "index.html", "html", {});
  assert.equal(missingEditor[0]?.primaryApp, undefined);
  assert.equal(missingEditor[0]?.allowSystemDefault, false);
  assert.equal(fileOpenSelectors([], "index.html", "html", {}).length, 1);
  assert.deepEqual(
    fileOpenSelectors(choices, "index.ts", "text", {}).map((selector) => selector.id),
    ["file"],
  );
  assert.deepEqual(
    fileOpenSelectors(choices, "doc.pdf", "pdf", {}).map((selector) =>
      selector.apps.map((app) => app.kind),
    ),
    [[], ["browser", "browser"]],
  );
  assert.equal(fileOpenSelectors(choices, undefined, "other", {}).length, 1);
});
