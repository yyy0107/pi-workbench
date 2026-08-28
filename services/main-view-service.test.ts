import assert from "node:assert/strict";
import test from "node:test";

import { MainViewRegistryImpl } from "@/platform/extensions/registries/main-view-registry";

import { MainViewService } from "./main-view-service";

function ExampleMainView() {
  return null;
}

test("main view service opens registered views and returns to the conversation", () => {
  const registry = new MainViewRegistryImpl();
  registry.register({
    kind: "example",
    component: ExampleMainView,
    chrome: { headerLeft: "hidden" },
  });
  const service = new MainViewService(registry);
  let changes = 0;
  service.subscribe(() => changes++);

  service.open({
    kind: "example",
    title: "Skills",
    breadcrumbs: [{ label: "Toolbox", params: { section: "catalog" } }, { label: "Skills" }],
    params: { section: "skills" },
  });
  const active = service.getSnapshot();

  assert.equal(active?.kind, "example");
  assert.equal(active?.title, "Skills");
  assert.deepEqual(active?.breadcrumbs, [
    { label: "Toolbox", params: { section: "catalog" } },
    { label: "Skills" },
  ]);
  assert.deepEqual(active?.params, { section: "skills" });
  assert.deepEqual(active?.chrome, { headerLeft: "hidden" });
  assert.equal(Object.isFrozen(active?.chrome), true);
  assert.equal(Object.isFrozen(active?.breadcrumbs), true);
  assert.equal(Object.isFrozen(active?.breadcrumbs?.[0]), true);
  assert.equal(Object.isFrozen(active?.breadcrumbs?.[0].params), true);
  assert.equal(Object.isFrozen(active?.params), true);
  assert.equal(changes, 1);

  service.close();
  assert.equal(service.getSnapshot(), null);
  assert.equal(changes, 2);
});

test("main view service rejects unknown contributions", () => {
  const service = new MainViewService(new MainViewRegistryImpl());

  assert.throws(
    () => service.open({ kind: "missing", title: "Missing", params: {} }),
    /Unknown main view/,
  );
});

test("main view service rejects empty header titles", () => {
  const registry = new MainViewRegistryImpl();
  registry.register({ kind: "example", component: ExampleMainView });
  const service = new MainViewService(registry);

  assert.throws(
    () => service.open({ kind: "example", title: " ", params: {} }),
    /non-empty string/,
  );
});

test("main view service rejects empty breadcrumb labels", () => {
  const registry = new MainViewRegistryImpl();
  registry.register({ kind: "example", component: ExampleMainView });
  const service = new MainViewService(registry);

  assert.throws(
    () =>
      service.open({
        kind: "example",
        title: "Example",
        breadcrumbs: [{ label: "Execution" }, { label: " " }],
        params: {},
      }),
    /breadcrumb labels must be non-empty strings/,
  );
});

test("main view service opens an ancestor breadcrumb destination", () => {
  const registry = new MainViewRegistryImpl();
  registry.register({ kind: "example", component: ExampleMainView });
  const service = new MainViewService(registry);
  service.open({
    kind: "example",
    title: "Skills",
    breadcrumbs: [{ label: "Toolbox", params: { section: "catalog" } }, { label: "Skills" }],
    params: { section: "skills" },
  });

  service.openBreadcrumb(0);

  assert.equal(service.getSnapshot()?.title, "Toolbox");
  assert.deepEqual(service.getSnapshot()?.params, { section: "catalog" });
  assert.deepEqual(service.getSnapshot()?.breadcrumbs, [{ label: "Toolbox" }]);
});

test("main view service rejects empty breadcrumb paths from untyped callers", () => {
  const registry = new MainViewRegistryImpl();
  registry.register({ kind: "example", component: ExampleMainView });
  const service = new MainViewService(registry);

  assert.throws(
    () =>
      service.open({
        kind: "example",
        title: "Example",
        breadcrumbs: [],
        params: {},
      } as unknown as Parameters<typeof service.open>[0]),
    /breadcrumbs must contain at least one label/,
  );
});

test("main view service returns to the conversation when a definition is removed", () => {
  const registry = new MainViewRegistryImpl();
  const definition = registry.register({ kind: "example", component: ExampleMainView });
  const service = new MainViewService(registry);
  service.open({ kind: "example", title: "Example", params: {} });

  definition.dispose();

  assert.equal(service.getSnapshot(), null);
  service.dispose();
});
