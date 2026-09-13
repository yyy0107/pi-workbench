import { setTimeout as wait } from "node:timers/promises";

import type {
  PiPackageCatalogDescribePayload,
  PiPackageCatalogDetailsView,
  PiPackageCatalogItemView,
  PiPackageCatalogSearchPayload,
  PiPackageCatalogSearchValue,
  PiPackageResourceType,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";

const PI_PACKAGE_CATALOG_URL = "https://pi.dev/packages";
const PI_PACKAGE_CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const CATALOG_REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_REQUEST_MAX_ATTEMPTS = 3;
const CATALOG_SNAPSHOT_MAX_ATTEMPTS = 3;
const CATALOG_RETRY_BASE_DELAY_MS = 250;
const CATALOG_RETRY_MAX_DELAY_MS = 2_000;
const DEFAULT_CATALOG_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_DETAIL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CATALOG_REFRESH_CONCURRENCY = 3;
const MAX_FALLBACK_SEARCH_CACHE_ENTRIES = 128;
const MAX_DETAIL_CACHE_ENTRIES = 256;
const PACKAGE_TYPES = new Set<PiPackageResourceType>([
  "extension",
  "skill",
  "prompt",
  "theme",
  "package",
]);
const RETRYABLE_CATALOG_RESPONSE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface PiPackageCatalogServiceDependencies {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  now(): number;
  sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
  scheduleInterval(task: () => void, intervalMs: number): () => void;
  onBackgroundError(error: unknown): void;
}

export interface PiPackageCatalogServiceOptions {
  backgroundRefresh?: boolean;
  refreshConcurrency?: number;
  refreshIntervalMs?: number;
}

/** Stable transport-facing catalog operations; network and cache policy stay in this service. */
export interface PackageCatalogProtocol {
  search(
    payload: PiPackageCatalogSearchPayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogSearchValue>;
  describe(
    payload: PiPackageCatalogDescribePayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogDetailsView>;
}

interface ParsedPackageCard {
  item: PiPackageCatalogItemView;
  searchText: string;
}

interface ParsedPackageCatalogPage {
  entries: ParsedPackageCard[];
  value: PiPackageCatalogSearchValue;
}

interface PackageCatalogSnapshot {
  entries: ParsedPackageCard[];
  total: number;
}

interface CachedValue<Value> {
  refreshedAt: number;
  value: Value;
}

export interface PiPackageCatalogServiceErrorDetails {
  "catalog-unavailable": { status?: number };
  "catalog-invalid-response": Record<string, never>;
}

export type PiPackageCatalogServiceErrorCode = keyof PiPackageCatalogServiceErrorDetails;

export class PiPackageCatalogServiceError<
  Code extends PiPackageCatalogServiceErrorCode = PiPackageCatalogServiceErrorCode,
> extends RpcDomainError<Code, PiPackageCatalogServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: PiPackageCatalogServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: PiPackageCatalogServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PiPackageCatalogServiceError";
    this.code = code;
    this.details = details;
  }
}

function catalogUnavailable(options: { cause?: unknown; status?: number } = {}) {
  return new PiPackageCatalogServiceError(
    "catalog-unavailable",
    "The official Pi package catalog is unavailable.",
    options.status === undefined ? {} : { status: options.status },
    options.cause === undefined ? undefined : { cause: options.cause },
  );
}

function nestedErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && code.length > 0) return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

function reportBackgroundCatalogError(error: unknown): void {
  if (error instanceof PiPackageCatalogServiceError && error.code === "catalog-unavailable") {
    const status = "status" in error.details ? error.details.status : undefined;
    const reason = status ? `HTTP ${status}` : nestedErrorCode(error.cause);
    console.warn(
      `[workbench-pi] Pi package catalog background refresh deferred${reason ? ` (${reason})` : ""}; it will retry automatically.`,
    );
    return;
  }
  console.warn("Pi package catalog background refresh failed.", error);
}

function retryAfterDelayMs(response: Response, now: number): number | undefined {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  const delayMs = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  if (!Number.isFinite(delayMs)) return undefined;
  return Math.min(Math.max(0, delayMs), CATALOG_RETRY_MAX_DELAY_MS);
}

function decodeHtml(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: "\u00a0",
    quot: '"',
  };

  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#")) {
      const hexadecimal = body[1]?.toLocaleLowerCase() === "x";
      const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return namedEntities[body.toLocaleLowerCase()] ?? entity;
  });
}

function textContent(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function preformattedText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, "")).trim();
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)) {
    const name = match[1];
    const rawValue = match[2];
    if (name && rawValue !== undefined) attributes[name] = decodeHtml(rawValue);
  }
  return attributes;
}

function classElementContent(markup: string, tag: string, className: string): string | undefined {
  const match = markup.match(
    new RegExp(
      `<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      "i",
    ),
  );
  return match?.[1];
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function packageCatalogUrl(name: string, markup: string): string {
  const path = markup.match(/data-package-path="([^"]+)"/i)?.[1];
  if (path?.startsWith("/packages/"))
    return new URL(decodeHtml(path), PI_PACKAGE_CATALOG_URL).toString();
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  return `${PI_PACKAGE_CATALOG_URL}/${encodedName}`;
}

export function buildPiPackageCatalogDetailUrl(name: string): URL {
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  return new URL(`/packages/${encodedName}`, PI_PACKAGE_CATALOG_URL);
}

function parsePackageTypes(value: string): PiPackageResourceType[] {
  const types = value
    .split(/[\s,·]+/)
    .filter((type): type is PiPackageResourceType =>
      PACKAGE_TYPES.has(type as PiPackageResourceType),
    );
  return types.length > 0 ? types : ["package"];
}

function parseCompactCount(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^([\d,.]+)\s*([kmb])?$/i);
  if (!match) return undefined;
  const numericValue = Number.parseFloat((match[1] ?? "").replaceAll(",", ""));
  if (!Number.isFinite(numericValue)) return undefined;
  const multiplier =
    match[2]?.toLocaleLowerCase() === "k"
      ? 1_000
      : match[2]?.toLocaleLowerCase() === "m"
        ? 1_000_000
        : match[2]?.toLocaleLowerCase() === "b"
          ? 1_000_000_000
          : 1;
  return Math.round(numericValue * multiplier);
}

function parsePackageSize(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^([\d,.]+)\s*(b|kb|mb|gb)$/i);
  if (!match) return undefined;
  const numericValue = Number.parseFloat((match[1] ?? "").replaceAll(",", ""));
  if (!Number.isFinite(numericValue)) return undefined;
  const unit = match[2]?.toLocaleLowerCase();
  const multiplier =
    unit === "gb" ? 1_000_000_000 : unit === "mb" ? 1_000_000 : unit === "kb" ? 1_000 : 1;
  return Math.round(numericValue * multiplier);
}

function parseManifestJson(html: string): string | undefined {
  const rawManifest = classElementContent(html, "pre", "raw-data-panel");
  if (!rawManifest) return undefined;
  const manifest = preformattedText(rawManifest);
  try {
    return JSON.stringify(JSON.parse(manifest) as unknown, null, 2);
  } catch {
    return undefined;
  }
}

export function parsePiPackageCatalogDetailHtml(html: string): PiPackageCatalogDetailsView {
  const detailMarkup = classElementContent(html, "dl", "detail-grid");
  if (!detailMarkup) {
    throw new PiPackageCatalogServiceError(
      "catalog-invalid-response",
      "The Pi package detail response could not be read.",
      {},
    );
  }

  const fields = new Map<string, string>();
  for (const match of detailMarkup.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    const label = textContent(match[1] ?? "").toLocaleLowerCase();
    if (label) fields.set(label, textContent(match[2] ?? ""));
  }

  const name = fields.get("package")?.trim();
  if (!name) {
    throw new PiPackageCatalogServiceError(
      "catalog-invalid-response",
      "The Pi package detail response did not include a package name.",
      {},
    );
  }

  const publishedAt = Date.parse(fields.get("published") ?? "");
  const downloads = fields.get("downloads") ?? "";
  const monthlyDownloads = parseCompactCount(downloads.match(/([\d,.]+\s*[kmb]?)\s*\/mo/i)?.[1]);
  const weeklyDownloads = parseCompactCount(downloads.match(/([\d,.]+\s*[kmb]?)\s*\/wk/i)?.[1]);
  const dependencies = fields.get("dependencies") ?? "";
  const dependencyCount = Number.parseInt(
    dependencies.match(/(\d+)\s+dependenc(?:y|ies)/i)?.[1] ?? "",
    10,
  );
  const peerDependencyCount = Number.parseInt(dependencies.match(/(\d+)\s+peers?/i)?.[1] ?? "", 10);
  const version = fields.get("version")?.trim();
  const author = fields.get("author")?.trim();
  const license = fields.get("license")?.trim();
  const packageSizeBytes = parsePackageSize(fields.get("size"));
  const manifestJson = parseManifestJson(html);

  return {
    name,
    ...(version ? { version } : {}),
    ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
    ...(monthlyDownloads === undefined ? {} : { monthlyDownloads }),
    ...(weeklyDownloads === undefined ? {} : { weeklyDownloads }),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    types: parsePackageTypes(fields.get("types") ?? ""),
    ...(packageSizeBytes === undefined ? {} : { packageSizeBytes }),
    ...(Number.isFinite(dependencyCount) ? { dependencyCount } : {}),
    ...(Number.isFinite(peerDependencyCount) ? { peerDependencyCount } : {}),
    ...(manifestJson ? { manifestJson } : {}),
  };
}

function parseVersion(markup: string): string | undefined {
  for (const match of markup.matchAll(/href="([^"]+)"/gi)) {
    const href = decodeHtml(match[1] ?? "");
    if (!href.includes("package-report")) continue;
    try {
      return new URL(href).searchParams.get("package-version") ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parsePackageCard(attributesMarkup: string, body: string): ParsedPackageCard | null {
  const attributes = parseAttributes(attributesMarkup);
  const name = attributes["data-package-name"]?.trim();
  if (!name) return null;

  const description = textContent(classElementContent(body, "p", "packages-desc") ?? "");
  const meta = classElementContent(body, "div", "packages-meta") ?? "";
  const author = textContent(meta.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const links = classElementContent(body, "div", "packages-links") ?? "";
  const hrefs = [...links.matchAll(/href="([^"]+)"/gi)].map((match) =>
    safeHttpsUrl(decodeHtml(match[1] ?? "")),
  );
  const npmUrl = hrefs.find((url) => url && new URL(url).hostname === "www.npmjs.com");
  if (!npmUrl) return null;
  const repositoryUrl = hrefs.find((url) => url && url !== npmUrl && !url.includes("/issues/new?"));
  const monthlyDownloads = Number.parseInt(attributes["data-package-downloads"] ?? "0", 10);
  const publishedAt = Number.parseInt(attributes["data-package-date"] ?? "0", 10);
  const version = parseVersion(body);

  const types = parsePackageTypes(attributes["data-package-types"] ?? "");
  const item: PiPackageCatalogItemView = {
    name,
    description,
    author,
    types,
    monthlyDownloads: Number.isFinite(monthlyDownloads) ? monthlyDownloads : 0,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
    catalogUrl: packageCatalogUrl(name, body),
    npmUrl,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(version ? { version } : {}),
    installCommand: `pi install npm:${name}`,
  };
  const fallbackSearchText = `${name} ${description} ${author} ${types.join(" ")}`;
  return {
    item,
    searchText: (attributes["data-package-search"] ?? fallbackSearchText).toLowerCase(),
  };
}

function parseCatalogCounts(html: string): { filteredTotal: number; total: number } | null {
  const countMarkup = html.match(
    /class="[^"]*\bpackages-count\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  )?.[1];
  if (!countMarkup) return null;
  const count = textContent(countMarkup);
  const range = count.match(/^\d+\s*-\s*\d+\s*\/\s*(\d+)(?:\s*\(of\s*(\d+)\))?$/i);
  if (range) {
    const filteredTotal = Number.parseInt(range[1] ?? "0", 10);
    const total = Number.parseInt(range[2] ?? range[1] ?? "0", 10);
    return { filteredTotal, total };
  }
  const empty = count.match(/^0\s*\/\s*(\d+)$/);
  if (empty) return { filteredTotal: 0, total: Number.parseInt(empty[1] ?? "0", 10) };
  return null;
}

export function buildPiPackageCatalogUrl(payload: PiPackageCatalogSearchPayload): URL {
  const url = new URL(PI_PACKAGE_CATALOG_URL);
  if (payload.query) url.searchParams.set("name", payload.query);
  if (payload.type) url.searchParams.set("type", payload.type);
  if (payload.sort && payload.sort !== "downloads") url.searchParams.set("sort", payload.sort);
  if (payload.page && payload.page > 1) url.searchParams.set("page", String(payload.page));
  return url;
}

function parsePiPackageCatalogPageHtml(html: string, page = 1): ParsedPackageCatalogPage {
  const counts = parseCatalogCounts(html);
  if (!counts) {
    throw new PiPackageCatalogServiceError(
      "catalog-invalid-response",
      "The Pi package catalog response could not be read.",
      {},
    );
  }

  const entries: ParsedPackageCard[] = [];
  for (const match of html.matchAll(
    /<article\b([^>]*\bdata-package-card="true"[^>]*)>([\s\S]*?)<\/article>/gi,
  )) {
    const entry = parsePackageCard(match[1] ?? "", match[2] ?? "");
    if (entry) entries.push(entry);
  }

  return {
    entries,
    value: {
      sourceUrl: PI_PACKAGE_CATALOG_URL,
      page,
      pageSize: PI_PACKAGE_CATALOG_PAGE_SIZE,
      pageCount: Math.ceil(counts.filteredTotal / PI_PACKAGE_CATALOG_PAGE_SIZE),
      filteredTotal: counts.filteredTotal,
      total: counts.total,
      packages: entries.map(({ item }) => item),
    },
  };
}

export function parsePiPackageCatalogHtml(html: string, page = 1): PiPackageCatalogSearchValue {
  return parsePiPackageCatalogPageHtml(html, page).value;
}

export class PiPackageCatalogService implements PackageCatalogProtocol {
  private readonly dependencies: PiPackageCatalogServiceDependencies;
  private readonly backgroundRefresh: boolean;
  private readonly refreshConcurrency: number;
  private readonly refreshIntervalMs: number;
  private readonly fallbackSearchCache = new Map<
    string,
    CachedValue<PiPackageCatalogSearchValue>
  >();
  private readonly fallbackSearchRefreshes = new Map<
    string,
    Promise<PiPackageCatalogSearchValue>
  >();
  private readonly detailCache = new Map<string, CachedValue<PiPackageCatalogDetailsView>>();
  private readonly detailRefreshes = new Map<string, Promise<PiPackageCatalogDetailsView>>();
  private snapshot?: PackageCatalogSnapshot;
  private snapshotRefresh?: Promise<void>;
  private readonly lifecycleController = new AbortController();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private backgroundRefreshStarted = false;
  private backgroundStartup?: Promise<void>;
  private stopScheduler?: () => void;
  private closed = false;
  private shutdownOperation?: Promise<void>;

  constructor(
    dependencies: Partial<PiPackageCatalogServiceDependencies> = {},
    options: PiPackageCatalogServiceOptions = {},
  ) {
    this.dependencies = {
      fetch: globalThis.fetch,
      now: Date.now,
      onBackgroundError: reportBackgroundCatalogError,
      sleep: async (delayMs, signal) => {
        await wait(delayMs, undefined, { signal });
      },
      scheduleInterval: (task, intervalMs) => {
        const timer = setInterval(task, intervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
      },
      ...dependencies,
    };
    this.backgroundRefresh = options.backgroundRefresh ?? false;
    this.refreshConcurrency = options.refreshConcurrency ?? DEFAULT_CATALOG_REFRESH_CONCURRENCY;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_CATALOG_REFRESH_INTERVAL_MS;
    if (!Number.isSafeInteger(this.refreshConcurrency) || this.refreshConcurrency < 1) {
      throw new RangeError("refreshConcurrency must be a positive integer.");
    }
    if (!Number.isFinite(this.refreshIntervalMs) || this.refreshIntervalMs <= 0) {
      throw new RangeError("refreshIntervalMs must be a positive finite number.");
    }
  }

  private cacheValue<Key, Value>(
    cache: Map<Key, CachedValue<Value>>,
    key: Key,
    value: Value,
    maximumEntries: number,
  ): void {
    cache.delete(key);
    cache.set(key, { refreshedAt: this.dependencies.now(), value });
    while (cache.size > maximumEntries) {
      const oldestKey = cache.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }

  private readCachedValue<Key, Value>(
    cache: Map<Key, CachedValue<Value>>,
    key: Key,
  ): CachedValue<Value> | undefined {
    const cached = cache.get(key);
    if (!cached) return undefined;
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  private operationSignal(signal?: AbortSignal): AbortSignal {
    if (this.closed || this.lifecycleController.signal.aborted || signal?.aborted) {
      throw catalogUnavailable({
        cause: signal?.reason ?? this.lifecycleController.signal.reason,
      });
    }
    return signal
      ? AbortSignal.any([signal, this.lifecycleController.signal])
      : this.lifecycleController.signal;
  }

  private track<Value>(operation: Promise<Value>): Promise<Value> {
    this.activeOperations.add(operation);
    void operation.then(
      () => this.activeOperations.delete(operation),
      () => this.activeOperations.delete(operation),
    );
    return operation;
  }

  private async fetchHtml(url: URL, signal?: AbortSignal, maxAttempts = 1): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted || this.closed) {
        throw catalogUnavailable({ cause: signal?.reason });
      }
      let response: Response;
      try {
        response = await this.dependencies.fetch(url, {
          headers: { Accept: "text/html", "User-Agent": "Pi-Workbench/0.1" },
          redirect: "follow",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(CATALOG_REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(CATALOG_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (signal?.aborted || attempt === maxAttempts) {
          throw catalogUnavailable({ cause: error });
        }
        await this.waitBeforeRetry(attempt, signal);
        continue;
      }

      if (signal?.aborted || this.closed) {
        await response.body?.cancel().catch(() => {});
        throw catalogUnavailable({ cause: signal?.reason });
      }

      if (!response.ok) {
        if (!RETRYABLE_CATALOG_RESPONSE_STATUSES.has(response.status) || attempt === maxAttempts) {
          throw catalogUnavailable({ status: response.status });
        }
        await response.body?.cancel().catch(() => {});
        await this.waitBeforeRetry(attempt, signal, response);
        continue;
      }

      let html: string;
      try {
        html = await response.text();
      } catch (error) {
        if (signal?.aborted || attempt === maxAttempts) {
          throw catalogUnavailable({ cause: error });
        }
        await this.waitBeforeRetry(attempt, signal);
        continue;
      }

      if (Buffer.byteLength(html, "utf8") > MAX_CATALOG_RESPONSE_BYTES) {
        throw new PiPackageCatalogServiceError(
          "catalog-invalid-response",
          "The Pi package catalog response was unexpectedly large.",
          {},
        );
      }
      if (signal?.aborted || this.closed) {
        throw catalogUnavailable({ cause: signal?.reason });
      }
      return html;
    }
    throw new Error("The package catalog retry loop ended unexpectedly.");
  }

  private async waitBeforeRetry(
    attempt: number,
    signal?: AbortSignal,
    response?: Response,
  ): Promise<void> {
    if (signal?.aborted || this.closed) {
      throw catalogUnavailable({ cause: signal?.reason });
    }
    const delayMs =
      (response && retryAfterDelayMs(response, this.dependencies.now())) ??
      Math.min(CATALOG_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), CATALOG_RETRY_MAX_DELAY_MS);
    try {
      await this.dependencies.sleep(delayMs, signal);
    } catch (error) {
      throw catalogUnavailable({ cause: error });
    }
    if (signal?.aborted || this.closed) {
      throw catalogUnavailable({ cause: signal?.reason });
    }
  }

  private async fetchCatalogPage(
    payload: PiPackageCatalogSearchPayload,
    signal?: AbortSignal,
    maxAttempts?: number,
  ): Promise<ParsedPackageCatalogPage> {
    const html = await this.fetchHtml(buildPiPackageCatalogUrl(payload), signal, maxAttempts);
    return parsePiPackageCatalogPageHtml(html, payload.page ?? 1);
  }

  private async loadCompleteSnapshot(
    signal: AbortSignal,
    attempt = 1,
  ): Promise<PackageCatalogSnapshot> {
    const controller = new AbortController();
    const refreshSignal = AbortSignal.any([signal, controller.signal]);
    const firstPage = await this.fetchCatalogPage(
      { sort: "name", page: 1 },
      refreshSignal,
      CATALOG_REQUEST_MAX_ATTEMPTS,
    );
    if (firstPage.value.filteredTotal !== firstPage.value.total) {
      throw new PiPackageCatalogServiceError(
        "catalog-invalid-response",
        "The Pi package catalog snapshot was unexpectedly filtered.",
        {},
      );
    }

    const pages: Array<ParsedPackageCatalogPage | undefined> = Array.from({
      length: firstPage.value.pageCount,
    });
    pages[0] = firstPage;
    let nextPage = 2;
    const worker = async (): Promise<void> => {
      for (;;) {
        const page = nextPage;
        nextPage += 1;
        if (page > firstPage.value.pageCount) return;
        pages[page - 1] = await this.fetchCatalogPage(
          { sort: "name", page },
          refreshSignal,
          CATALOG_REQUEST_MAX_ATTEMPTS,
        );
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(this.refreshConcurrency, Math.max(0, pages.length - 1)) },
          () => worker(),
        ),
      );
    } catch (error) {
      controller.abort();
      throw error;
    }

    const entries: ParsedPackageCard[] = [];
    const names = new Set<string>();
    for (const page of pages) {
      if (!page) {
        throw new PiPackageCatalogServiceError(
          "catalog-invalid-response",
          "The Pi package catalog snapshot was incomplete.",
          {},
        );
      }
      for (const entry of page.entries) {
        if (names.has(entry.item.name)) continue;
        names.add(entry.item.name);
        entries.push(entry);
      }
    }
    if (
      entries.length !== firstPage.value.total ||
      pages.some(
        (page) =>
          page?.value.total !== firstPage.value.total ||
          page.value.filteredTotal !== firstPage.value.total,
      )
    ) {
      // Offset pagination can shift during a crawl; retry from page one before publishing.
      if (attempt < CATALOG_SNAPSHOT_MAX_ATTEMPTS) {
        await this.waitBeforeRetry(attempt, signal);
        return this.loadCompleteSnapshot(signal, attempt + 1);
      }
      throw catalogUnavailable({
        cause: new PiPackageCatalogServiceError(
          "catalog-invalid-response",
          "The Pi package catalog changed while its snapshot was being refreshed.",
          {},
        ),
      });
    }
    return { entries, total: entries.length };
  }

  refreshCatalog(signal?: AbortSignal): Promise<void> {
    const refreshSignal = this.operationSignal(signal);
    if (this.snapshotRefresh) return this.snapshotRefresh;
    const refresh = this.loadCompleteSnapshot(refreshSignal)
      .then((snapshot) => {
        if (refreshSignal.aborted || this.closed) {
          throw catalogUnavailable({ cause: refreshSignal.reason });
        }
        this.snapshot = snapshot;
        this.fallbackSearchCache.clear();
      })
      .finally(() => {
        if (this.snapshotRefresh === refresh) this.snapshotRefresh = undefined;
      });
    this.snapshotRefresh = this.track(refresh);
    return refresh;
  }

  private searchSnapshot(
    snapshot: PackageCatalogSnapshot,
    payload: PiPackageCatalogSearchPayload,
  ): PiPackageCatalogSearchValue {
    const query = payload.query?.trim().toLowerCase();
    let entries = snapshot.entries.filter(
      ({ item, searchText }) =>
        (!query || searchText.includes(query)) &&
        (!payload.type || item.types.includes(payload.type)),
    );
    const sort = payload.sort ?? "downloads";
    if (sort === "downloads") {
      entries = entries.toSorted(
        (left, right) => right.item.monthlyDownloads - left.item.monthlyDownloads,
      );
    } else if (sort === "recent") {
      entries = entries.toSorted((left, right) => right.item.publishedAt - left.item.publishedAt);
    }

    const page = payload.page ?? 1;
    const filteredTotal = entries.length;
    const offset = (page - 1) * PI_PACKAGE_CATALOG_PAGE_SIZE;
    return {
      sourceUrl: PI_PACKAGE_CATALOG_URL,
      page,
      pageSize: PI_PACKAGE_CATALOG_PAGE_SIZE,
      pageCount: Math.ceil(filteredTotal / PI_PACKAGE_CATALOG_PAGE_SIZE),
      filteredTotal,
      total: snapshot.total,
      packages: entries
        .slice(offset, offset + PI_PACKAGE_CATALOG_PAGE_SIZE)
        .map(({ item }) => item),
    };
  }

  private refreshFallbackSearch(
    payload: PiPackageCatalogSearchPayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogSearchValue> {
    const refreshSignal = this.operationSignal(signal);
    const key = buildPiPackageCatalogUrl(payload).toString();
    const active = this.fallbackSearchRefreshes.get(key);
    if (active) return active;
    const refresh = this.fetchCatalogPage(payload, refreshSignal)
      .then(({ value }) => {
        if (refreshSignal.aborted || this.closed) {
          throw catalogUnavailable({ cause: refreshSignal.reason });
        }
        this.cacheValue(this.fallbackSearchCache, key, value, MAX_FALLBACK_SEARCH_CACHE_ENTRIES);
        return value;
      })
      .finally(() => {
        if (this.fallbackSearchRefreshes.get(key) === refresh) {
          this.fallbackSearchRefreshes.delete(key);
        }
      });
    this.fallbackSearchRefreshes.set(key, this.track(refresh));
    return refresh;
  }

  private refreshDetail(
    payload: PiPackageCatalogDescribePayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogDetailsView> {
    const refreshSignal = this.operationSignal(signal);
    const active = this.detailRefreshes.get(payload.name);
    if (active) return active;
    const refresh = this.fetchHtml(buildPiPackageCatalogDetailUrl(payload.name), refreshSignal)
      .then((html) => parsePiPackageCatalogDetailHtml(html))
      .then((details) => {
        if (refreshSignal.aborted || this.closed) {
          throw catalogUnavailable({ cause: refreshSignal.reason });
        }
        if (details.name !== payload.name) {
          throw new PiPackageCatalogServiceError(
            "catalog-invalid-response",
            "The Pi package detail response did not match the requested package.",
            {},
          );
        }
        this.cacheValue(this.detailCache, payload.name, details, MAX_DETAIL_CACHE_ENTRIES);
        return details;
      })
      .finally(() => {
        if (this.detailRefreshes.get(payload.name) === refresh) {
          this.detailRefreshes.delete(payload.name);
        }
      });
    this.detailRefreshes.set(payload.name, this.track(refresh));
    return refresh;
  }

  private async refreshObservedFallbackSearches(signal: AbortSignal): Promise<void> {
    if (this.snapshot || this.fallbackSearchCache.size === 0) return;
    const payloads = [...this.fallbackSearchCache.keys()].map((url) => {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") as PiPackageCatalogSearchPayload["type"];
      const sort = parsed.searchParams.get("sort") as PiPackageCatalogSearchPayload["sort"];
      const page = Number(parsed.searchParams.get("page") ?? "1");
      return {
        ...(parsed.searchParams.get("name")
          ? { query: parsed.searchParams.get("name") ?? undefined }
          : {}),
        ...(type ? { type } : {}),
        ...(sort ? { sort } : {}),
        ...(page > 1 ? { page } : {}),
      } satisfies PiPackageCatalogSearchPayload;
    });
    await Promise.allSettled(
      payloads.map((payload) => this.refreshFallbackSearch(payload, signal)),
    );
  }

  private async refreshObservedDetails(signal: AbortSignal): Promise<void> {
    const threshold = this.dependencies.now() - DEFAULT_DETAIL_REFRESH_INTERVAL_MS;
    const names = [...this.detailCache]
      .filter(([, cached]) => cached.refreshedAt <= threshold)
      .map(([name]) => name);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const name = names[index];
        if (!name) return;
        await this.refreshDetail({ name }, signal).catch((error: unknown) => {
          if (!signal.aborted && !this.closed) this.dependencies.onBackgroundError(error);
        });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.refreshConcurrency, names.length) }, () => worker()),
    );
  }

  private async runBackgroundRefresh(signal: AbortSignal): Promise<void> {
    try {
      await this.refreshCatalog(signal);
    } catch (error) {
      if (signal.aborted || this.closed) return;
      this.dependencies.onBackgroundError(error);
      await this.refreshObservedFallbackSearches(signal);
    }
    if (signal.aborted || this.closed) return;
    await this.refreshObservedDetails(signal);
  }

  start(): Promise<void> {
    if (!this.backgroundRefresh || this.closed || this.lifecycleController.signal.aborted) {
      return Promise.resolve();
    }
    if (this.backgroundRefreshStarted) return this.backgroundStartup ?? Promise.resolve();
    this.backgroundRefreshStarted = true;
    this.stopScheduler = this.dependencies.scheduleInterval(() => {
      if (this.closed || this.lifecycleController.signal.aborted) return;
      void this.track(this.runBackgroundRefresh(this.lifecycleController.signal)).catch(
        (error: unknown) => {
          if (!this.closed && !this.lifecycleController.signal.aborted) {
            this.dependencies.onBackgroundError(error);
          }
        },
      );
    }, this.refreshIntervalMs);
    const startup = this.runBackgroundRefresh(this.lifecycleController.signal).finally(() => {
      if (this.backgroundStartup === startup) this.backgroundStartup = undefined;
    });
    this.backgroundStartup = this.track(startup);
    return this.backgroundStartup;
  }

  shutdown(): Promise<void> {
    if (this.shutdownOperation) return this.shutdownOperation;
    let resolveShutdown!: () => void;
    let rejectShutdown!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveShutdown = resolve;
      rejectShutdown = reject;
    });
    this.shutdownOperation = operation;
    this.closed = true;
    let schedulerFailure: unknown;
    try {
      this.stopScheduler?.();
    } catch (error) {
      schedulerFailure = error;
    }
    this.stopScheduler = undefined;
    this.lifecycleController.abort(new Error("Pi package catalog service shut down."));
    const pending = [...this.activeOperations];
    void Promise.allSettled(pending).then(() => {
      if (schedulerFailure !== undefined) rejectShutdown(schedulerFailure);
      else resolveShutdown();
    });
    return operation;
  }

  async search(
    payload: PiPackageCatalogSearchPayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogSearchValue> {
    const operationSignal = this.operationSignal(signal);
    try {
      if (this.snapshot) return this.searchSnapshot(this.snapshot, payload);
      const key = buildPiPackageCatalogUrl(payload).toString();
      const cached = this.readCachedValue(this.fallbackSearchCache, key);
      if (cached) return cached.value;
      return await this.refreshFallbackSearch(payload, operationSignal);
    } finally {
      if (!operationSignal.aborted && !this.closed) void this.start();
    }
  }

  async describe(
    payload: PiPackageCatalogDescribePayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogDetailsView> {
    const operationSignal = this.operationSignal(signal);
    try {
      const cached = this.readCachedValue(this.detailCache, payload.name);
      if (cached) {
        if (
          this.backgroundRefresh &&
          cached.refreshedAt <= this.dependencies.now() - DEFAULT_DETAIL_REFRESH_INTERVAL_MS
        ) {
          void this.refreshDetail(payload, this.lifecycleController.signal).catch(
            (error: unknown) => {
              if (!this.closed && !this.lifecycleController.signal.aborted) {
                this.dependencies.onBackgroundError(error);
              }
            },
          );
        }
        return cached.value;
      }
      return await this.refreshDetail(payload, operationSignal);
    } finally {
      if (!operationSignal.aborted && !this.closed) void this.start();
    }
  }
}

const packageCatalogServiceKey = Symbol.for("pi-workbench.package-catalog-service.v1");
const packageCatalogGlobal = globalThis as typeof globalThis & {
  [packageCatalogServiceKey]?: PiPackageCatalogService;
};

export function getPiPackageCatalogService(): PiPackageCatalogService {
  return (packageCatalogGlobal[packageCatalogServiceKey] ??= new PiPackageCatalogService(
    {},
    { backgroundRefresh: true },
  ));
}

const absentPackageCatalogShutdown = Promise.resolve();

/** Closes the process-global catalog owner without constructing it during shutdown. */
export function shutdownPiPackageCatalogService(): Promise<void> {
  return packageCatalogGlobal[packageCatalogServiceKey]?.shutdown() ?? absentPackageCatalogShutdown;
}
