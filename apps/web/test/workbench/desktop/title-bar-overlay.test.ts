import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  readTitleBarOverlay,
  readWorkbenchDesktopTitleBarPort,
} from "@/workbench/desktop/title-bar-overlay";

test("reads only the narrow desktop title-bar port from a bridge", () => {
  const received: unknown[] = [];
  const port = {
    setOverlay(overlay: unknown) {
      received.push(overlay);
    },
  };

  assert.equal(readWorkbenchDesktopTitleBarPort({ titleBar: port }), port);
  readWorkbenchDesktopTitleBarPort({ titleBar: port })?.setOverlay({
    color: "#18181b",
    symbolColor: "#fafafa",
  });
  assert.equal(received.length, 1);
});

test("uses a safe no-op boundary when no desktop bridge is available", () => {
  for (const value of [undefined, null, {}, { titleBar: {} }, { titleBar: { setOverlay: 1 } }]) {
    assert.equal(readWorkbenchDesktopTitleBarPort(value), undefined);
  }
});

test("reads title-bar colors from the exact Workbench installation owner", () => {
  const appended: unknown[] = [];
  const document_ = {
    body: {
      append() {
        throw new Error("title-bar probes must not escape to the document body");
      },
    },
    createElement(tagName: string) {
      if (tagName === "canvas") {
        let fillStyle = "";
        return {
          height: 0,
          width: 0,
          getContext() {
            return {
              clearRect() {},
              fillRect() {},
              get fillStyle() {
                return fillStyle;
              },
              set fillStyle(value: string) {
                fillStyle = value;
              },
              getImageData() {
                return {
                  data: fillStyle === "rgb(17, 34, 51)" ? [17, 34, 51, 255] : [221, 238, 255, 255],
                };
              },
            };
          },
        };
      }
      return {
        remove() {},
        style: { cssText: "" },
      };
    },
  } as unknown as Document;
  const owner = {
    append(node: unknown) {
      appended.push(node);
    },
    ownerDocument: document_,
  } as unknown as HTMLElement;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => ({
    backgroundColor: "rgb(17, 34, 51)",
    color: "rgb(221, 238, 255)",
  })) as unknown as typeof getComputedStyle;

  try {
    assert.deepEqual(readTitleBarOverlay(owner), {
      color: "#112233",
      symbolColor: "#ddeeff",
    });
    assert.equal(appended.length, 1);
  } finally {
    globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test("the live title-bar synchronizer observes only its injected Shell owner", async () => {
  const source = await readFile(
    new URL("../../../src/workbench/desktop/title-bar-overlay-sync.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /observer\.observe\(owner,/u);
  assert.match(source, /readTitleBarOverlay\(owner\)/u);
  assert.doesNotMatch(source, /document\.documentElement|document\.body/u);
});
