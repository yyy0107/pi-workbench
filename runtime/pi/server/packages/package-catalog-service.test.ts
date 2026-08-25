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
    data-package-search="@example/pi-tools tools skills review example extension skill"
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
    data-package-search="pi-theme theme designer"
    data-package-downloads="25" data-package-date="1786000000000">
    <p class="packages-desc">A theme.</p>
    <div class="packages-meta"><span>designer</span></div>
    <div class="packages-links">
      <a href="https://www.npmjs.com/package/pi-theme">npm</a>
    </div>
  </article>
`;

const completeCatalogHtml = catalogHtml.replace("1-2 / 2 (of 5439)", "1-2 / 2");

function generatedCatalogPage(start: number, end: number, total: number): string {
  const cards = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    .map(
      (item) => `
        <article data-package-card="true" data-package-name="pi-cache-${String(item).padStart(3, "0")}"
          data-package-search="pi-cache-${item} cached package ${item}"
          data-package-types="extension" data-package-downloads="${item}"
          data-package-date="${1_780_000_000_000 + item}">
          <p class="packages-desc">Cached package ${item}.</p>
          <div class="packages-meta"><span>cache-author</span></div>
          <div class="packages-links">
            <a href="https://www.npmjs.com/package/pi-cache-${String(item).padStart(3, "0")}">npm</a>
          </div>
        </article>`,
    )
    .join("\n");
  return `<span class="packages-count">${start}-${end} / ${total}</span>${cards}`;
}

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
  let requestCount = 0;
  const service = new PiPackageCatalogService({
    fetch: async (input) => {
      requestCount += 1;
      requestedUrl = String(input);
      return new Response(catalogHtml, { status: 200 });
    },
  });

  const result = await service.search({ query: "tools", type: "extension" });
  await service.search({ query: "tools", type: "extension" });
  assert.equal(requestedUrl, "https://pi.dev/packages?name=tools&type=extension");
  assert.equal(requestCount, 1);
  assert.equal(result.packages[0]?.name, "@example/pi-tools");
});

test("coalesces concurrent cold requests for the same catalog query", async () => {
  let requestCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new PiPackageCatalogService({
    fetch: async () => {
      requestCount += 1;
      await gate;
      return new Response(catalogHtml, { status: 200 });
    },
  });

  const first = service.search({ query: "review" });
  const second = service.search({ query: "review" });
  assert.equal(requestCount, 1);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(requestCount, 1);
});

test("fetches one package detail only from its fixed pi.dev path", async () => {
  let requestedUrl = "";
  let requestCount = 0;
  const service = new PiPackageCatalogService({
    fetch: async (input) => {
      requestCount += 1;
      requestedUrl = String(input);
      return new Response(detailHtml, { status: 200 });
    },
  });

  const result = await service.describe({ name: "@example/pi-tools" });
  await service.describe({ name: "@example/pi-tools" });
  assert.equal(requestedUrl, "https://pi.dev/packages/%40example/pi-tools");
  assert.equal(requestCount, 1);
  assert.equal(result.weeklyDownloads, 15_600);
});

test("periodically builds one complete snapshot and searches it without another upstream request", async () => {
  const requestedUrls: string[] = [];
  let scheduledTask: (() => void) | undefined;
  let stopped = false;
  const service = new PiPackageCatalogService(
    {
      fetch: async (input) => {
        requestedUrls.push(String(input));
        return new Response(completeCatalogHtml, { status: 200 });
      },
      scheduleInterval: (task, intervalMs) => {
        assert.equal(intervalMs, 30 * 60 * 1000);
        scheduledTask = task;
        return () => {
          stopped = true;
        };
      },
    },
    { backgroundRefresh: true },
  );

  const warm = await service.search({});
  assert.equal(warm.total, 2);
  await service.start();
  assert.equal(typeof scheduledTask, "function");
  assert.deepEqual(requestedUrls, ["https://pi.dev/packages", "https://pi.dev/packages?sort=name"]);

  const result = await service.search({ query: "review", type: "extension", sort: "downloads" });
  assert.equal(result.filteredTotal, 1);
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.packages.map(({ name }) => name),
    ["@example/pi-tools"],
  );
  assert.equal(requestedUrls.length, 2);

  service.dispose();
  assert.equal(stopped, true);
});

test("keeps serving the previous complete snapshot when a scheduled refresh fails", async () => {
  let fail = false;
  const service = new PiPackageCatalogService({
    fetch: async () =>
      fail
        ? new Response("unavailable", { status: 503 })
        : new Response(completeCatalogHtml, { status: 200 }),
  });

  await service.refreshCatalog();
  fail = true;
  await assert.rejects(service.refreshCatalog(), { name: "PiPackageCatalogServiceError" });

  const cached = await service.search({ sort: "name" });
  assert.equal(cached.total, 2);
  assert.deepEqual(
    cached.packages.map(({ name }) => name),
    ["@example/pi-tools", "pi-theme"],
  );
});

test("crawls every official page once and paginates the cached snapshot locally", async () => {
  const requestedUrls: string[] = [];
  const service = new PiPackageCatalogService(
    {
      fetch: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url.toString());
        return new Response(
          url.searchParams.get("page") === "2"
            ? generatedCatalogPage(51, 51, 51)
            : generatedCatalogPage(1, 50, 51),
          { status: 200 },
        );
      },
    },
    { refreshConcurrency: 2 },
  );

  await service.refreshCatalog();
  assert.deepEqual(requestedUrls, [
    "https://pi.dev/packages?sort=name",
    "https://pi.dev/packages?sort=name&page=2",
  ]);

  const secondPage = await service.search({ sort: "name", page: 2 });
  assert.equal(secondPage.total, 51);
  assert.equal(secondPage.pageCount, 2);
  assert.deepEqual(
    secondPage.packages.map(({ name }) => name),
    ["pi-cache-051"],
  );
  assert.equal(requestedUrls.length, 2);
});
