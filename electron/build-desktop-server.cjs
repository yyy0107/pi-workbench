const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { build } = require("esbuild");

const { DESKTOP_RUNTIME_BUDGET } = require("./desktop-runtime-budget.cjs");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, ".desktop-build");
const serverEntry = path.join(outputDirectory, "server.mjs");
const allowlistPath = path.join(outputDirectory, "runtime-allowlist.json");
const WORKSPACE_PACKAGE_PREFIX = "@workbench/";
const DESKTOP_SERVER_EXTERNAL_PACKAGES = Object.freeze([
  ...DESKTOP_RUNTIME_BUDGET.requiredExternalPackages,
]);

function packageNameForSpecifier(specifier) {
  if (specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function externalSpecifiersForPackages(packageNames) {
  return packageNames.flatMap((packageName) => [packageName, `${packageName}/*`]);
}

function createDesktopServerBuildOptions({
  absWorkingDir = projectRoot,
  entryPoint = "server.ts",
  outfile = serverEntry,
} = {}) {
  return {
    absWorkingDir,
    bundle: true,
    entryPoints: [entryPoint],
    external: externalSpecifiersForPackages(DESKTOP_SERVER_EXTERNAL_PACKAGES),
    format: "esm",
    legalComments: "none",
    metafile: true,
    outfile,
    platform: "node",
    sourcemap: false,
    target: "node22",
  };
}

function externalPackagesFromMetafile(metafile) {
  return [
    ...new Set(
      Object.values(metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((item) => item.external)
        .map((item) => packageNameForSpecifier(item.path))
        .filter(Boolean),
    ),
  ].sort();
}

function assertDesktopServerExternalPackages(
  externalPackages,
  requiredExternalPackages = DESKTOP_SERVER_EXTERNAL_PACKAGES,
) {
  const actual = [...new Set(externalPackages)].sort();
  const workspacePackages = actual.filter((packageName) =>
    packageName.startsWith(WORKSPACE_PACKAGE_PREFIX),
  );
  if (workspacePackages.length > 0) {
    throw new Error(
      `Workbench workspace packages must be bundled into server.mjs, not externalized: ${workspacePackages.join(", ")}`,
    );
  }

  const required = [...new Set(requiredExternalPackages)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) {
    throw new Error(
      `Desktop server external package whitelist changed: ${actual.join(", ") || "(empty)"}; expected ${required.join(", ") || "(empty)"}.`,
    );
  }
  return actual;
}

async function buildDesktopServer() {
  rmSync(outputDirectory, { force: true, recursive: true });
  mkdirSync(outputDirectory, { recursive: true });

  const result = await build(createDesktopServerBuildOptions());
  const externalPackages = assertDesktopServerExternalPackages(
    externalPackagesFromMetafile(result.metafile),
  );

  writeFileSync(
    allowlistPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entrypoint: "server.mjs",
        externalPackages,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `[desktop-runtime] Compiled server.ts; external runtime whitelist: ${externalPackages.join(", ")}`,
  );
}

if (require.main === module) {
  void buildDesktopServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DESKTOP_SERVER_EXTERNAL_PACKAGES,
  assertDesktopServerExternalPackages,
  buildDesktopServer,
  createDesktopServerBuildOptions,
  externalPackagesFromMetafile,
  externalSpecifiersForPackages,
  packageNameForSpecifier,
};
