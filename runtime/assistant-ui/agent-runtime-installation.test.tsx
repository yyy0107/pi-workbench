import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineWorkbenchAgentRuntimeDescriptor } from "@/runtime/shared/agent-runtime/descriptor";
import {
  WorkbenchAgentRuntimeInstallationHost,
  type WorkbenchAgentRuntimeInstallation,
} from "./agent-runtime-installation";

test("mounts exactly the installation selected by the application composition root", () => {
  const renders: string[] = [];
  const installation: WorkbenchAgentRuntimeInstallation = {
    descriptor: defineWorkbenchAgentRuntimeDescriptor("fixture-runtime"),
    render(children) {
      renders.push("fixture-runtime");
      return createElement("section", { "data-runtime": "fixture-runtime" }, children);
    },
  };

  const markup = renderToStaticMarkup(
    createElement(WorkbenchAgentRuntimeInstallationHost, {
      installation,
      children: createElement("span", null, "Workbench"),
    }),
  );

  assert.equal(markup, '<section data-runtime="fixture-runtime"><span>Workbench</span></section>');
  assert.deepEqual(renders, ["fixture-runtime"]);
});
