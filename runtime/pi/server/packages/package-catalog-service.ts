import type {
  PiPackageCatalogDescribePayload,
  PiPackageCatalogDetailsView,
  PiPackageCatalogItemView,
  PiPackageCatalogSearchPayload,
  PiPackageCatalogSearchValue,
  PiPackageResourceType,
} from "../../rpc-contracts";

const PI_PACKAGE_CATALOG_URL = "https://pi.dev/packages";
const PI_PACKAGE_CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const PACKAGE_TYPES = new Set<PiPackageResourceType>([
  "extension",
  "skill",
  "prompt",
  "theme",
  "package",
]);

export interface PiPackageCatalogServiceDependencies {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface PiPackageCatalogServiceErrorDetails {
  "catalog-unavailable": { status?: number };
  "catalog-invalid-response": Record<string, never>;
}

export type PiPackageCatalogServiceErrorCode = keyof PiPackageCatalogServiceErrorDetails;

export class PiPackageCatalogServiceError<
  Code extends PiPackageCatalogServiceErrorCode = PiPackageCatalogServiceErrorCode,
> extends Error {
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

function parsePackageCard(attributesMarkup: string, body: string): PiPackageCatalogItemView | null {
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

  return {
    name,
    description,
    author,
    types: parsePackageTypes(attributes["data-package-types"] ?? ""),
    monthlyDownloads: Number.isFinite(monthlyDownloads) ? monthlyDownloads : 0,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
    catalogUrl: packageCatalogUrl(name, body),
    npmUrl,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(version ? { version } : {}),
    installCommand: `pi install npm:${name}`,
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

export function parsePiPackageCatalogHtml(html: string, page = 1): PiPackageCatalogSearchValue {
  const counts = parseCatalogCounts(html);
  if (!counts) {
    throw new PiPackageCatalogServiceError(
      "catalog-invalid-response",
      "The Pi package catalog response could not be read.",
      {},
    );
  }

  const packages: PiPackageCatalogItemView[] = [];
  for (const match of html.matchAll(
    /<article\b([^>]*\bdata-package-card="true"[^>]*)>([\s\S]*?)<\/article>/gi,
  )) {
    const item = parsePackageCard(match[1] ?? "", match[2] ?? "");
    if (item) packages.push(item);
  }

  return {
    sourceUrl: PI_PACKAGE_CATALOG_URL,
    page,
    pageSize: PI_PACKAGE_CATALOG_PAGE_SIZE,
    pageCount: Math.ceil(counts.filteredTotal / PI_PACKAGE_CATALOG_PAGE_SIZE),
    filteredTotal: counts.filteredTotal,
    total: counts.total,
    packages,
  };
}

export class PiPackageCatalogService {
  private readonly dependencies: PiPackageCatalogServiceDependencies;

  constructor(dependencies: Partial<PiPackageCatalogServiceDependencies> = {}) {
    this.dependencies = { fetch: globalThis.fetch, ...dependencies };
  }

  private async fetchHtml(url: URL, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(url, {
        headers: { Accept: "text/html", "User-Agent": "Pi-Workbench/0.1" },
        redirect: "follow",
        signal,
      });
    } catch (error) {
      throw new PiPackageCatalogServiceError(
        "catalog-unavailable",
        "The official Pi package catalog is unavailable.",
        {},
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new PiPackageCatalogServiceError(
        "catalog-unavailable",
        "The official Pi package catalog is unavailable.",
        { status: response.status },
      );
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MAX_CATALOG_RESPONSE_BYTES) {
      throw new PiPackageCatalogServiceError(
        "catalog-invalid-response",
        "The Pi package catalog response was unexpectedly large.",
        {},
      );
    }
    return html;
  }

  async search(
    payload: PiPackageCatalogSearchPayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogSearchValue> {
    const url = buildPiPackageCatalogUrl(payload);
    const html = await this.fetchHtml(url, signal);
    return parsePiPackageCatalogHtml(html, payload.page ?? 1);
  }

  async describe(
    payload: PiPackageCatalogDescribePayload,
    signal?: AbortSignal,
  ): Promise<PiPackageCatalogDetailsView> {
    const html = await this.fetchHtml(buildPiPackageCatalogDetailUrl(payload.name), signal);
    const details = parsePiPackageCatalogDetailHtml(html);
    if (details.name !== payload.name) {
      throw new PiPackageCatalogServiceError(
        "catalog-invalid-response",
        "The Pi package detail response did not match the requested package.",
        {},
      );
    }
    return details;
  }
}
