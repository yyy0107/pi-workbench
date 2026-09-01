import assert from "node:assert/strict";
import test from "node:test";

import { CommandRegistryImpl } from "@workbench/extension-sdk/internal";

import { CommandService } from "../src/services/command-service";

test("commands can open and close registered main views through the constrained context", async () => {
  const registry = new CommandRegistryImpl();
  const mainViewOperations: string[] = [];
  registry.register({
    id: "fixture.open-main-view",
    title: "Open fixture",
    run(context) {
      context.mainViews.open({ kind: "fixture", title: "Fixture", params: { section: "general" } });
      context.mainViews.close();
    },
  });
  const service = new CommandService(registry, {
    mainViews: {
      open(request) {
        mainViewOperations.push(`open:${request.kind}:${String(request.params.section)}`);
      },
      close() {
        mainViewOperations.push("close");
      },
    },
    navigation: {
      newThread() {},
      openThread() {},
    },
    panels: {
      open() {},
      close() {},
      toggle() {},
      move() {},
    },
  });

  await service.execute("fixture.open-main-view");

  assert.deepEqual(mainViewOperations, ["open:fixture:general", "close"]);
});
