const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES,
  DESKTOP_RENDERER_DEVELOPMENT_MARKER,
  DESKTOP_RENDERER_ORIGIN,
  assertDesktopRendererDevelopmentResponse,
  createDesktopRendererProtocolHandler,
  rendererResourcePath,
} = require("../src/desktop-renderer-protocol.cjs");

const artifact = Object.freeze({
  artifactRoot: path.resolve("/admitted/renderer"),
  manifest: Object.freeze({
    entrypoint: "index.html",
    files: Object.freeze([
      { path: "index.html" },
      { path: "assets/app.js" },
      { path: "secret.txt" },
    ]),
  }),
});

function developmentResponse(body, { contentType = "text/html; charset=utf-8" } = {}) {
  return new Response(body, { headers: { "Content-Type": contentType } });
}

test("admits only bounded canonical development renderer HTML with the stable identity marker", async () => {
  const responseWithoutReliableUrl = developmentResponse(
    `<body ${DESKTOP_RENDERER_DEVELOPMENT_MARKER}></body>`,
  );
  assert.equal(responseWithoutReliableUrl.url, "");
  await assert.doesNotReject(assertDesktopRendererDevelopmentResponse(responseWithoutReliableUrl));
  await assert.rejects(
    assertDesktopRendererDevelopmentResponse(developmentResponse("<body></body>")),
    /identity marker was missing/u,
  );
  await assert.rejects(
    assertDesktopRendererDevelopmentResponse(
      developmentResponse(`<body ${DESKTOP_RENDERER_DEVELOPMENT_MARKER}></body>`, {
        contentType: "application/json",
      }),
    ),
    /canonical HTML entrypoint/u,
  );
  await assert.rejects(
    assertDesktopRendererDevelopmentResponse(
      developmentResponse("x".repeat(DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES + 1)),
    ),
    /exceeded its size limit/u,
  );
});

test("maps only exact manifest-owned custom-origin resources", () => {
  assert.equal(
    rendererResourcePath(`${DESKTOP_RENDERER_ORIGIN}/?route=home`, artifact),
    path.join(artifact.artifactRoot, "index.html"),
  );
  assert.equal(
    rendererResourcePath(`${DESKTOP_RENDERER_ORIGIN}/assets/app.js`, artifact),
    path.join(artifact.artifactRoot, "assets", "app.js"),
  );
  for (const url of [
    "workbench://other/assets/app.js",
    "workbench://app/unknown.js",
    "workbench://app/assets/../secret.txt",
    "workbench://app/%2e%2e/secret",
    "workbench://app/%2e%2e/secret.txt",
    "workbench://app/assets%2fapp.js",
  ]) {
    assert.equal(rendererResourcePath(url, artifact), undefined);
  }
});

test("serves admitted files with strict exact-origin CSP and fails closed", async () => {
  const requested = [];
  const handler = createDesktopRendererProtocolHandler(artifact, {
    runtimeOrigin: "http://127.0.0.1:43102",
    async fetchFile(url) {
      requested.push(url);
      return new Response("ok", { headers: { "Content-Type": "text/html" } });
    },
  });
  const response = await handler({ method: "GET", url: `${DESKTOP_RENDERER_ORIGIN}/` });
  assert.equal(await response.text(), "ok");
  assert.equal(requested.length, 1);
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/u);
  assert.match(csp, /style-src 'self'/u);
  assert.match(csp, /connect-src http:\/\/127\.0\.0\.1:43102 ws:\/\/127\.0\.0\.1:43102/u);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/u);
  assert.equal(
    (await handler({ method: "GET", url: `${DESKTOP_RENDERER_ORIGIN}/missing` })).status,
    404,
  );
  assert.equal((await handler({ method: "POST", url: `${DESKTOP_RENDERER_ORIGIN}/` })).status, 405);
});
