const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { build } = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, ".desktop-build");
const serverEntry = path.join(outputDirectory, "server.mjs");
const allowlistPath = path.join(outputDirectory, "runtime-allowlist.json");

function packageNameForSpecifier(specifier) {
  if (specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

async function buildDesktopServer() {
  rmSync(outputDirectory, { force: true, recursive: true });
  mkdirSync(outputDirectory, { recursive: true });

  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: ["server.ts"],
    format: "esm",
    legalComments: "none",
    metafile: true,
    outfile: serverEntry,
    packages: "external",
    platform: "node",
    sourcemap: false,
    target: "node22",
  });
  const externalPackages = [
    ...new Set(
      Object.values(result.metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((item) => item.external)
        .map((item) => packageNameForSpecifier(item.path))
        .filter(Boolean),
    ),
  ].sort();

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

module.exports = { buildDesktopServer, packageNameForSpecifier };
