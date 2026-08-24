import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPiPackageCatalogDetailUrl,
  buildPiPackageCatalogUrl,
  parsePiPackageCatalogDetailHtml,
  parsePiPackageCatalogHtml,
  PiPackageCatalogService,
} from "./package-catalog-service";

const catalogHtml = `
  <span class="packages-count">1-2 / 2 (of 5439)</span>
  <article class="surface-panel content-card" data-package-card="true"
    data-package-name="@example/pi-tools" data-package-types="extension skill"
    data-package-downloads="1200" data-package-date="1787000000000">
    <div class="packages-card-body">
      <h3><a href="/packages/@example/pi-tools" data-package-path="/packages/@example/pi-tools">@example/pi-tools</a></h3>
      <p class="packages-desc">Tools &amp; skills for Pi.</p>
      <div class="packages-meta"><span>example</span><span>1.2K/mo</span></div>
      <div class="packages-links">
        <a href="https://www.npmjs.com/package/@example/pi-tools">npm</a>
        <a href="https://github.com/example/pi-tools">repo</a>
        <a href="https://github.com/earendil-works/pi/issues/new?template=package-report.yml&amp;package-version=1.2.3">report</a>
      </div>
    </div>
  </article>
  <article data-package-card="true" data-package-name="pi-theme" data-package-types="theme"
    data-package-downloads="25" data-package-date="1786000000000">
    <p class="packages-desc">A theme.</p>
    <div class="packages-meta"><span>designer</span></div>
    <div class="packages-links">
      <a href="https://www.npmjs.com/package/pi-theme">npm</a>
    </div>
  </article>
`;

const detailHtml = `
  <dl class="definition-grid detail-grid">
    <dt>Package</dt><dd><code>@example/pi-tools</code></dd>
    <dt>Version</dt><dd><code>1.2.3</code></dd>
    <dt>Published</dt><dd>Aug 23, 2026</dd>
    <dt>Downloads</dt><dd>43.7K/mo · 15.6K/wk</dd>
    <dt>Author</dt><dd>example</dd>
    <dt>License</dt><dd>MIT</dd>
    <dt>Types</dt><dd>extension · skill</dd>
    <dt>Size</dt><dd>815.8 KB</dd>
    <dt>Dependencies</dt><dd>1 dependency · 4 peers</dd>
  </dl>
  <details class="disclosure-block">
    <summary>Pi manifest JSON</summary>
    <pre class="raw-data-panel">{
      &quot;extensions&quot;: [&quot;./dist/index.ts&quot;],
      &quot;skills&quot;: [&quot;./skills/review&quot;]
    }</pre>
  </details>
`;

test("builds the official Pi package-catalog query", () => {
  assert.equal(
    buildPiPackageCatalogUrl({
      query: "review",
      type: "skill",
      sort: "recent",
      page: 2,
    }).toString(),
    "https://pi.dev/packages?name=review&type=skill&sort=recent&page=2",
  );
});

test("builds a fixed official package-detail URL", () => {
  assert.equal(
    buildPiPackageCatalogDetailUrl("@example/pi-tools").toString(),
    "https://pi.dev/packages/%40example/pi-tools",
  );
});

test("parses official package-catalog cards into the typed view", () => {
  assert.deepEqual(parsePiPackageCatalogHtml(catalogHtml, 1), {
    sourceUrl: "https://pi.dev/packages",
    page: 1,
    pageSize: 50,
    pageCount: 1,
    filteredTotal: 2,
    total: 5439,
    packages: [
      {
        name: "@example/pi-tools",
        description: "Tools & skills for Pi.",
        author: "example",
        types: ["extension", "skill"],
        monthlyDownloads: 1200,
        publishedAt: 1787000000000,
        catalogUrl: "https://pi.dev/packages/@example/pi-tools",
        npmUrl: "https://www.npmjs.com/package/@example/pi-tools",
        repositoryUrl: "https://github.com/example/pi-tools",
        version: "1.2.3",
        installCommand: "pi install npm:@example/pi-tools",
      },
      {
        name: "pi-theme",
        description: "A theme.",
        author: "designer",
        types: ["theme"],
        monthlyDownloads: 25,
        publishedAt: 1786000000000,
        catalogUrl: "https://pi.dev/packages/pi-theme",
        npmUrl: "https://www.npmjs.com/package/pi-theme",
        installCommand: "pi install npm:pi-theme",
      },
    ],
  });
});

test("parses the official package-detail fields and manifest", () => {
  assert.deepEqual(parsePiPackageCatalogDetailHtml(detailHtml), {
    name: "@example/pi-tools",
    version: "1.2.3",
    publishedAt: Date.parse("Aug 23, 2026"),
    monthlyDownloads: 43_700,
    weeklyDownloads: 15_600,
    author: "example",
    license: "MIT",
    types: ["extension", "skill"],
    packageSizeBytes: 815_800,
    dependencyCount: 1,
    peerDependencyCount: 4,
    manifestJson: `{
  "extensions": [
    "./dist/index.ts"
  ],
  "skills": [
    "./skills/review"
  ]
}`,
  });
});

test("fetches the package catalog only from pi.dev", async () => {
  let requestedUrl = "";
  const service = new PiPackageCatalogService({
    fetch: async (input) => {
      requestedUrl = String(input);
      return new Response(catalogHtml, { status: 200 });
    },
  });

  const result = await service.search({ query: "tools", type: "extension" });
  assert.equal(requestedUrl, "https://pi.dev/packages?name=tools&type=extension");
  assert.equal(result.packages[0]?.name, "@example/pi-tools");
});

test("fetches one package detail only from its fixed pi.dev path", async () => {
  let requestedUrl = "";
  const service = new PiPackageCatalogService({
    fetch: async (input) => {
      requestedUrl = String(input);
      return new Response(detailHtml, { status: 200 });
    },
  });

  const result = await service.describe({ name: "@example/pi-tools" });
  assert.equal(requestedUrl, "https://pi.dev/packages/%40example/pi-tools");
  assert.equal(result.weeklyDownloads, 15_600);
});
