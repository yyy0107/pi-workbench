import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatPathEllipsis, PathEllipsis } from "./path-ellipsis";

test("formatPathEllipsis keeps the requested path ends", () => {
  assert.equal(
    formatPathEllipsis("/workspace/packages/workbench/src/path-ellipsis.tsx", 11, 14),
    "/workspace/…h-ellipsis.tsx",
  );
});

test("formatPathEllipsis handles Unicode code points and zero-length ends", () => {
  assert.equal(formatPathEllipsis("😀abc", 1, 1), "😀…c");
  assert.equal(formatPathEllipsis("/tmp/😀/文件.ts", 0, 5), "…文件.ts");
  assert.equal(formatPathEllipsis("/workspace/src/index.ts", 0, 0), "…");
  assert.equal(formatPathEllipsis("short", 2, 3), "short");
});

test("PathEllipsis exposes the complete path and forwards layout props", () => {
  const html = renderToStaticMarkup(
    <PathEllipsis
      text="/workspace/packages/workbench/src/path-ellipsis.tsx"
      width="100%"
      prefixChars={0}
      suffixChars={14}
      className="font-mono"
    />,
  );

  assert.match(html, /data-slot="path-ellipsis"/u);
  assert.match(html, /style="[^"]*text-align:left[^"]*width:100%"/u);
  assert.match(html, /aria-hidden="true"[^>]*>…<\/span><span[^>]*direction:rtl/u);
  assert.match(html, /aria-label="\/workspace\/packages\/workbench\/src\/path-ellipsis\.tsx"/u);
  assert.match(html, /title="\/workspace\/packages\/workbench\/src\/path-ellipsis\.tsx"/u);
  assert.match(
    html,
    />…<\/span><span[^>]*direction:rtl[^>]*><span[^>]*direction:ltr[^>]*>h-ellipsis\.tsx<\/span>/u,
  );
  assert.match(html, /font-mono/u);
});
