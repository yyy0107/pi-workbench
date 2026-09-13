import { realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleSpecifiers, parseWorkspaceSource } from "./workspace-source.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASELINE = "scripts/package-structure-baseline.json";
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;
const SKIP = new Set(["node_modules", "dist", "build", "coverage"]);

// A package may have barrel entries, but a whole source root cannot be a barrel.
// This is a structural floor; capability/helper ownership still requires review.
function hasOwnDeclaration(program) {
  return program.body.some((statement) => {
    if (statement.type === "ExportNamedDeclaration") return !!statement.declaration;
    if (statement.type === "ExportDefaultDeclaration")
      return statement.declaration.type !== "Identifier";
    return ![
      "ImportDeclaration",
      "TSImportEqualsDeclaration",
      "ExportAllDeclaration",
      "EmptyStatement",
      "ExpressionStatement",
      "TSExportAssignment",
    ].includes(statement.type);
  });
}

async function files(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(target)));
    else if (entry.isFile()) result.push(target);
  }
  return result.sort();
}

export async function packageStructureInventory(repositoryRoot = REPOSITORY_ROOT) {
  const relative = (file) => path.relative(repositoryRoot, file).split(path.sep).join("/");
  const allFiles = await files(path.join(repositoryRoot, "packages"));
  // Fixture manifests describe synthetic projects, not production library packages.
  const manifests = allFiles.filter(
    (file) =>
      path.basename(file) === "package.json" &&
      !/(?:^|[/\\])(?:test|tests|fixtures)(?:[/\\])/u.test(relative(file)),
  );
  const packageRoots = manifests.map(path.dirname).sort((a, b) => b.length - a.length);
  const violations = [];
  const tests = [];
  const add = (rule, file, detail) => violations.push({ rule, path: relative(file), detail });
  for (const manifest of manifests) {
    const root = path.dirname(manifest);
    if (relative(root).split("/").length !== 3)
      add("package-root", manifest, "expected packages/<domain>/<capability>/package.json");
    if (packageRoots.some((other) => other !== root && root.startsWith(`${other}${path.sep}`)))
      add("nested-package", manifest, "a library must not contain another library package");
    const inspectExport = (value) => {
      if (typeof value === "string") {
        if (SOURCE_EXTENSION.test(value) && !value.startsWith("./src/"))
          add("public-source-entry", manifest, `public source entry must be in src/: ${value}`);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(inspectExport);
      }
    };
    inspectExport(JSON.parse(await readFile(manifest, "utf8")).exports);
    for (const sourceRoot of ["src", "lib"]) {
      const candidates = allFiles.filter(
        (file) =>
          file.startsWith(`${root}${path.sep}${sourceRoot}${path.sep}`) &&
          SOURCE_EXTENSION.test(file) &&
          !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file) &&
          packageRoots.find((candidate) => file.startsWith(`${candidate}${path.sep}`)) === root,
      );
      let containsSource = false;
      let containsOwnDeclaration = false;
      for (const candidate of candidates) {
        const program = parseWorkspaceSource(await readFile(candidate, "utf8"), candidate);
        containsSource ||= program.body.some(
          (statement) =>
            statement.type !== "EmptyStatement" &&
            !(
              statement.type === "ExpressionStatement" &&
              typeof statement.expression.value === "string"
            ) &&
            !(
              statement.type === "ExportNamedDeclaration" &&
              !statement.declaration &&
              !statement.source &&
              !statement.specifiers.length
            ),
        );
        containsOwnDeclaration ||= hasOwnDeclaration(program);
        if (containsSource && containsOwnDeclaration) break;
      }
      if (!containsSource)
        add("source-layout", manifest, `${sourceRoot}/ must contain actual package source`);
      else if (!containsOwnDeclaration)
        add(
          "source-role",
          manifest,
          `${sourceRoot}/ must contain implementation or contracts, not only forwarding entries`,
        );
    }
  }
  for (const filename of allFiles) {
    const owner = packageRoots.find((root) => filename.startsWith(`${root}${path.sep}`));
    if (!owner) continue;
    const local = path.relative(owner, filename).split(path.sep);
    if (!["src", "lib", "test", "tests"].includes(local[0])) continue;
    if (["src", "lib"].includes(local[0]) && local.length > 3)
      add(`${local[0]}-depth`, filename, `${local[0]} permits at most one subdirectory`);
    if (!SOURCE_EXTENSION.test(filename)) continue;
    // Existing CommonJS artifact policy remains build tooling; no application TS is converted to JS.
    const legacyBuildTool =
      (relative(owner) === "packages/host/artifact-policy" && filename.endsWith(".cjs")) ||
      [
        "packages/host/server/src/host-probe.cjs",
        "packages/host/server/src/windows-process-census.cjs",
      ].includes(relative(filename));
    if (["src", "lib"].includes(local[0]) && /\.[cm]?jsx?$/u.test(filename) && !legacyBuildTool)
      add("source-language", filename, "capability and helper source must use TypeScript");
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(filename)) {
      tests.push(relative(filename));
      if (local[0] !== "tests")
        add("test-location", filename, "library tests belong in package-root tests/");
    }
    const source = await readFile(filename, "utf8");
    for (const specifier of new Set(moduleSpecifiers(source, filename))) {
      const parents = specifier.match(/^(?:\.\.\/)+/u)?.[0].split("/").length - 1 || 0;
      if (parents > 2) add("relative-import", filename, specifier);
    }
  }
  return {
    packages: manifests.map(relative).sort(),
    tests: tests.sort(),
    violations: violations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

const identity = (entry) => JSON.stringify([entry.rule, entry.path, entry.detail]);

export function compareStructureBaseline(violations, baseline = []) {
  const current = new Map(violations.map((entry) => [identity(entry), entry]));
  const previous = new Map(baseline.map((entry) => [identity(entry), entry]));
  if (previous.size !== baseline.length)
    throw new Error("Package structure baseline contains duplicate entries");
  return {
    added: [...current].filter(([key]) => !previous.has(key)).map(([, entry]) => entry),
    stale: [...previous].filter(([key]) => !current.has(key)).map(([, entry]) => entry),
    retained: [...previous].filter(([key]) => current.has(key)).map(([, entry]) => entry),
  };
}

export async function checkPackageStructure(repositoryRoot = REPOSITORY_ROOT, options = {}) {
  const inventory = await packageStructureInventory(repositoryRoot);
  const baselinePath = path.join(repositoryRoot, BASELINE);
  let baseline = [];
  if (options.strict === false || options.writeBaseline || options.pruneBaseline) {
    try {
      const saved = JSON.parse(await readFile(baselinePath, "utf8"));
      if (saved.version !== 1 || !Array.isArray(saved.violations))
        throw new Error("Unsupported package structure baseline format");
      baseline = saved.violations;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (options.writeBaseline) {
    await writeFile(
      baselinePath,
      `${JSON.stringify({ version: 1, violations: inventory.violations }, null, 2)}\n`,
      { flag: "wx" },
    );
    return inventory;
  }
  const comparison = compareStructureBaseline(inventory.violations, baseline);
  if (options.pruneBaseline && comparison.added.length === 0) {
    await writeFile(
      baselinePath,
      `${JSON.stringify({ version: 1, violations: comparison.retained }, null, 2)}\n`,
    );
    comparison.stale = [];
  }
  if (comparison.added.length || comparison.stale.length) {
    const lines = [
      ...comparison.added.map((entry) => `${entry.rule}: ${entry.path}: ${entry.detail}`),
      ...comparison.stale.map(
        (entry) => `stale baseline: ${entry.rule}: ${entry.path}: ${entry.detail}`,
      ),
    ];
    throw new Error(
      `Package structure violations:\n${lines.map((line) => `- ${line}`).join("\n")}`,
    );
  }
  return inventory;
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length > 1 ||
      args.some((arg) => !["--strict", "--write-baseline", "--prune-baseline"].includes(arg))
    )
      throw new Error(
        "Usage: check-package-structure.mjs [--strict | --write-baseline | --prune-baseline]",
      );
    const inventory = await checkPackageStructure(REPOSITORY_ROOT, {
      strict: !args.includes("--write-baseline") && !args.includes("--prune-baseline"),
      writeBaseline: args.includes("--write-baseline"),
      pruneBaseline: args.includes("--prune-baseline"),
    });
    console.log(
      `Package structure: ${inventory.packages.length} libraries, ${inventory.tests.length} test files, ${inventory.violations.length} tracked migration violations.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
