import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ToolCall, ToolCallDetails } from "./tool-call";

function renderStatus(status: "running" | "complete" | "error" | "requires-action"): string {
  return renderToStaticMarkup(
    <ToolCall
      label="Used"
      activeLabel="Using"
      query="search"
      request="{}"
      result=""
      requestLabel="Request"
      resultLabel="Result"
      running={status === "running"}
      requiresAction={status === "requires-action"}
      failed={status === "error"}
      expandable={false}
      open={false}
      onOpenChange={() => undefined}
    />,
  );
}

test("renders Workbench tool statuses without treating requires-action as complete", () => {
  for (const status of ["running", "complete", "error", "requires-action"] as const) {
    assert.match(renderStatus(status), new RegExp(`data-status="${status}"`));
  }
  assert.doesNotMatch(renderStatus("requires-action"), /data-lucide="check"/);
});

test("keeps partial tool arguments visible in the native detail component", () => {
  const markup = renderToStaticMarkup(
    <ToolCallDetails
      request={'{"query":"hel'}
      result=""
      requestLabel="Request"
      resultLabel="Result"
    />,
  );

  assert.match(markup, /\{&quot;query&quot;:&quot;hel/);
});
