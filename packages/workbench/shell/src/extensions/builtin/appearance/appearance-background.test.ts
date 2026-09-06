import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyWorkbenchDarkMode,
  snapshotSurfaceColors,
  workbenchAppearanceRoot,
} from "./appearance-background";

class FakeClassList {
  readonly #classes = new Set<string>();

  contains(name: string): boolean {
    return this.#classes.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.#classes.has(name);
    if (enabled) this.#classes.add(name);
    else this.#classes.delete(name);
    return enabled;
  }
}

test("appearance targets and restores only the nearest Workbench Shell root", () => {
  const firstRoot = { classList: new FakeClassList() } as unknown as HTMLElement;
  const secondRoot = { classList: new FakeClassList() } as unknown as HTMLElement;
  const anchor = {
    closest(selector: string) {
      assert.equal(selector, "[data-workbench-shell]");
      return firstRoot;
    },
  } as unknown as Element;

  assert.equal(workbenchAppearanceRoot(anchor), firstRoot);
  const restoreFirst = applyWorkbenchDarkMode(firstRoot, true);
  const restoreSecond = applyWorkbenchDarkMode(secondRoot, false);
  assert.equal(firstRoot.classList.contains("dark"), true);
  assert.equal(secondRoot.classList.contains("dark"), false);

  restoreFirst();
  assert.equal(firstRoot.classList.contains("dark"), false);
  assert.equal(secondRoot.classList.contains("dark"), false);
  restoreSecond();
});

test("appearance production effects and selectors contain no document-root owner", async () => {
  const effectSource = await readFile(
    new URL("./appearance-background.tsx", import.meta.url),
    "utf8",
  );
  const selectorSource = await readFile(
    new URL("./appearance-background.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(effectSource, /document\.documentElement/u);
  assert.doesNotMatch(selectorSource, /:root/u);
  assert.doesNotMatch(selectorSource, /filter:\s*contrast\(/u);
  assert.match(selectorSource, /\[data-workbench-shell\]\[data-workbench-appearance\]/u);
});

test("captures aliased surface colors before applying opacity to their source token", () => {
  const written = new Map<string, string>();
  const style = {
    getPropertyValue(property: string) {
      if (property === "--muted" || property === "--accent" || property === "--sidebar-accent") {
        return written.get("--muted") ?? "#f4f4f5";
      }
      return "#fdfdfd";
    },
  };
  for (const [property, base] of snapshotSurfaceColors(style)) {
    written.set(property, `color-mix(in srgb, ${base} 80%, transparent)`);
  }
  assert.equal(written.get("--muted"), "color-mix(in srgb, #f4f4f5 80%, transparent)");
  assert.equal(written.get("--accent"), written.get("--muted"));
  assert.equal(written.get("--sidebar-accent"), written.get("--muted"));
});
