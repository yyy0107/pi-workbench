import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const INSTALLED_PACKAGE_SERVICE = new URL(
  "../../src/packages/installed-package-service.ts",
  import.meta.url,
);
const PACKAGE_CATALOG_SERVICE = new URL(
  "../../src/packages/package-catalog-service.ts",
  import.meta.url,
);
const INSTALLED_PACKAGE_ROUTES = new URL(
  "../../src/transport/routes/installed-package-rpc-routes.ts",
  import.meta.url,
);
const PACKAGE_CATALOG_ROUTES = new URL(
  "../../src/transport/routes/package-catalog-rpc-routes.ts",
  import.meta.url,
);
const PACKAGE_VALIDATORS = new URL(
  "../../src/transport/package-rpc-validators.ts",
  import.meta.url,
);
const RPC_ROUTE_COMPOSITION = new URL(
  "../../src/transport/rpc-route-composition.ts",
  import.meta.url,
);

const INSTALLED_PACKAGE_METHODS = [
  "package.list",
  "package.describe",
  "package.updates",
  "package.install",
  "package.update",
  "package.remove",
] as const;
const PACKAGE_CATALOG_METHODS = ["packageCatalog.search", "packageCatalog.describe"] as const;

test("Installed Package transport depends only on its narrow protocol and validators", async () => {
  const source = await readFile(INSTALLED_PACKAGE_ROUTES, "utf8");

  assert.match(source, /import type \{ InstalledPackageProtocol \}/);
  assert.match(source, /from "\.\.\/package-rpc-validators"/);
  assert.match(source, /from "\.\.\/resource-rpc-validators"/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.doesNotMatch(source, /PackageManager|SettingsManager|session-registry/);
  assert.doesNotMatch(source, /pi-resource-mutation-coordinator|project-trust-service/);
  assert.doesNotMatch(source, /node:fs|node:path/);
  assert.equal(source.match(/loopbackOnly: true/g)?.length, 3);
  for (const method of INSTALLED_PACKAGE_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing Installed Package route: ${method}`);
  }
  for (const method of PACKAGE_CATALOG_METHODS) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `Catalog route leaked into Packages: ${method}`,
    );
  }
});

test("Package Catalog transport preserves AbortSignal without owning network policy", async () => {
  const source = await readFile(PACKAGE_CATALOG_ROUTES, "utf8");

  assert.match(source, /import type \{ PackageCatalogProtocol \}/);
  assert.match(source, /service\.search\(payload, context\.signal\)/);
  assert.match(source, /service\.describe\(payload, context\.signal\)/);
  assert.doesNotMatch(source, /fetch\(|PI_PACKAGE_CATALOG_URL|backgroundRefresh/);
  assert.doesNotMatch(source, /@earendil-works\/pi-coding-agent/);
  assert.doesNotMatch(source, /loopbackOnly: true/);
  for (const method of PACKAGE_CATALOG_METHODS) {
    assert.ok(source.includes(`case "${method}":`), `Missing Package Catalog route: ${method}`);
  }
  for (const method of INSTALLED_PACKAGE_METHODS) {
    assert.ok(
      !source.includes(`case "${method}":`),
      `Installed route leaked into Catalog: ${method}`,
    );
  }
});

test("Package validators centralize shared names, sources, and mutation targets", async () => {
  const source = await readFile(PACKAGE_VALIDATORS, "utf8");

  assert.match(source, /export const packageCatalogNameValidator/);
  assert.match(source, /export const packageSourceValidator/);
  assert.match(source, /export const packageMutationTargetValidator/);
  assert.equal(source.match(/name: packageCatalogNameValidator/g)?.length, 2);
  assert.equal(source.match(/source: packageSourceValidator/g)?.length, 2);
  assert.equal(source.match(/target: packageMutationTargetValidator/g)?.length, 2);
  assert.match(source, /target: resourceCatalogTarget/);
  assert.doesNotMatch(source, /PackageManager|SettingsManager|fetch\(/);
});

test("Package services implement narrow protocols while retaining implementation ownership", async () => {
  const [installed, catalog] = await Promise.all([
    readFile(INSTALLED_PACKAGE_SERVICE, "utf8"),
    readFile(PACKAGE_CATALOG_SERVICE, "utf8"),
  ]);

  assert.match(installed, /export interface InstalledPackageProtocol/);
  assert.match(
    installed,
    /export class InstalledPackageService implements InstalledPackageProtocol/,
  );
  assert.match(installed, /DefaultPackageManager/);
  assert.match(installed, /SettingsManager/);
  assert.match(installed, /from "\.\.\/trust\/project-trust-service"/);
  assert.match(installed, /from "\.\.\/resources\/pi-resource-mutation-coordinator"/);
  assert.doesNotMatch(installed, /installed-package-rpc-routes|rpc-transport/);

  assert.match(catalog, /export interface PackageCatalogProtocol/);
  assert.match(catalog, /export class PiPackageCatalogService implements PackageCatalogProtocol/);
  assert.match(catalog, /fetch\(input: string \| URL/);
  assert.match(catalog, /backgroundRefresh/);
  assert.doesNotMatch(catalog, /package-catalog-rpc-routes|rpc-transport/);
});

test("the route composition creates both Package groups without retaining their details", async () => {
  const source = await readFile(RPC_ROUTE_COMPOSITION, "utf8");

  assert.match(source, /createInstalledPackageRpcRoutes\(dependencies\.installedPackage\)/);
  assert.match(source, /createPackageCatalogRpcRoutes\(dependencies\.packageCatalog\)/);
  assert.match(
    source,
    /installedPackage: \{ service: installedPackageService, \.\.\.domainErrors \}/,
  );
  assert.match(source, /packageCatalog: \{ service: packageCatalogService, \.\.\.domainErrors \}/);
  assert.match(source, /projectRpcDomainError/);
  for (const method of [...INSTALLED_PACKAGE_METHODS, ...PACKAGE_CATALOG_METHODS]) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns Package route: ${method}`);
  }
  assert.doesNotMatch(source, /const packageCatalogSearchPayload/);
  assert.doesNotMatch(source, /const packageCatalogDescribePayload/);
  assert.doesNotMatch(source, /const packageInstallPayload/);
  assert.doesNotMatch(source, /const packageDescribePayload/);
  assert.doesNotMatch(source, /const packageSourceMutationPayload/);
});
