import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { WorkbenchMessageSourceBlock } from "./message-blocks";

test("renders a Workbench SourceBlock without provider-specific Part state", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchMessageSourceBlock
      block={{
        key: "source-1",
        kind: "source",
        title: "Workbench guide",
        url: "https://example.com/guide",
      }}
      fallbackLabel="Source"
      variant="chip"
    />,
  );

  assert.match(markup, /Workbench guide/);
  assert.match(markup, /href="https:\/\/example\.com\/guide"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});
