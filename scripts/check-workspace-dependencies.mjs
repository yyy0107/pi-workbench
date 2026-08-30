import { builtinModules } from "node:module";
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
);
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const PRODUCTION_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function parseWorkspacePackagePatterns(source) {
  const patterns = [];
  let inPackages = false;

  for (const line of source.split(/\r?\n/)) {
    if (/^packages:\s*(?:#.*)?$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    if (!inPackages) continue;

    const match = line.match(/^\s+-\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
    if (match) patterns.push(match[1] ?? match[2] ?? match[3]);
  }
  return patterns;
}

async function workspacePackageDirectories(repositoryRoot) {
  const workspaceSource = await readFile(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  const patterns = parseWorkspacePackagePatterns(workspaceSource);
  const directories = [];

  for (const pattern of patterns) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(
        `Workspace dependency checks require an exact leaf pattern ending in /*: ${pattern}`,
      );
    }

    const parentDirectory = path.join(repositoryRoot, pattern.slice(0, -2));
    let entries;
    try {
      entries = await readdir(parentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(parentDirectory, entry.name);
      try {
        await readFile(path.join(directory, "package.json"), "utf8");
        directories.push(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return directories.sort();
}

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function sourceTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) index += 1;
        value += source[index];
        index += 1;
      }
      index += 1;
      tokens.push({ type: "string", value });
      continue;
    }
    if (character === "`") {
      index += 1;
      while (index < source.length && source[index] !== "`") {
        if (source[index] === "\\" && index + 1 < source.length) index += 1;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let value = character;
      index += 1;
      while (index < source.length && /[\w$]/.test(source[index])) {
        value += source[index];
        index += 1;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }
    tokens.push({ type: "punctuation", value: character });
    index += 1;
  }
  return tokens;
}

function moduleSpecifiers(source) {
  const tokens = sourceTokens(source);
  const specifiers = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (
      (token.value === "import" || token.value === "require") &&
      tokens[index + 1]?.value === "("
    ) {
      if (tokens[index + 2]?.type === "string") specifiers.push(tokens[index + 2].value);
      continue;
    }
    if (token.value !== "import" && token.value !== "export") continue;
    if (tokens[index - 1]?.value === ".") continue;
    if (tokens[index + 1]?.type === "string") {
      specifiers.push(tokens[index + 1].value);
      continue;
    }

    for (let cursor = index + 1; cursor < Math.min(tokens.length, index + 64); cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
        specifiers.push(tokens[cursor + 1].value);
        break;
      }
    }
  }
  return specifiers;
}

function importedPackageName(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    BUILTIN_MODULES.has(specifier)
  ) {
    return undefined;
  }
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function declaredDependencies(manifest, includeDevelopment) {
  const fields = includeDevelopment
    ? [...PRODUCTION_DEPENDENCY_FIELDS, "devDependencies"]
    : PRODUCTION_DEPENDENCY_FIELDS;
  return new Set(fields.flatMap((field) => Object.keys(manifest[field] ?? {})));
}

function packageSubpath(specifier, packageName) {
  return specifier === packageName ? "" : specifier.slice(packageName.length + 1);
}

function productionWorkspaceGraph(packages, workspaceNames) {
  return new Map(
    packages.map(({ manifest }) => [
      manifest.name,
      [
        ...new Set(
          PRODUCTION_DEPENDENCY_FIELDS.flatMap((field) =>
            Object.keys(manifest[field] ?? {}),
          ).filter((dependency) => workspaceNames.has(dependency)),
        ),
      ].sort(),
    ]),
  );
}

function workspaceDependencyCycles(graph) {
  const cycles = new Set();
  const visited = new Set();
  const active = [];
  const activeIndexes = new Map();

  function visit(packageName) {
    const cycleStart = activeIndexes.get(packageName);
    if (cycleStart !== undefined) {
      const cycle = [...active.slice(cycleStart), packageName];
      const members = cycle.slice(0, -1);
      const rotations = members.map((_, index) => [
        ...members.slice(index),
        ...members.slice(0, index),
      ]);
      rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
      cycles.add([...rotations[0], rotations[0][0]].join(" -> "));
      return;
    }
    if (visited.has(packageName)) return;

    activeIndexes.set(packageName, active.length);
    active.push(packageName);
    for (const dependency of graph.get(packageName) ?? []) visit(dependency);
    active.pop();
    activeIndexes.delete(packageName);
    visited.add(packageName);
  }

  for (const packageName of [...graph.keys()].sort()) visit(packageName);
  return [...cycles].sort();
}

export async function workspaceDependencyViolations(repositoryRoot = REPOSITORY_ROOT) {
  const packageDirectories = await workspacePackageDirectories(repositoryRoot);
  const packages = [];

  for (const directory of packageDirectories) {
    const manifestPath = path.join(directory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error(`${path.relative(repositoryRoot, manifestPath)} must declare a package name`);
    }
    packages.push({ directory, manifest, manifestPath });
  }

  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));
  const violations = [];
  for (const cycle of workspaceDependencyCycles(
    productionWorkspaceGraph(packages, workspaceNames),
  )) {
    violations.push(`workspace production dependency cycle: ${cycle}`);
  }
  for (const { directory, manifest, manifestPath } of packages) {
    for (const field of [...PRODUCTION_DEPENDENCY_FIELDS, "devDependencies"]) {
      for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
        if (workspaceNames.has(dependency) && !String(version).startsWith("workspace:")) {
          violations.push(
            `${path.relative(repositoryRoot, manifestPath)}: ${dependency} must use the workspace: protocol`,
          );
        }
      }
    }

    for (const sourceDirectory of ["src", "test"]) {
      const allowDevelopment = sourceDirectory === "test";
      const declared = declaredDependencies(manifest, allowDevelopment);
      for (const filename of await sourceFiles(path.join(directory, sourceDirectory))) {
        const source = await readFile(filename, "utf8");
        for (const specifier of moduleSpecifiers(source)) {
          const dependency = importedPackageName(specifier);
          if (!dependency || dependency === manifest.name) continue;
          const location = path.relative(repositoryRoot, filename);

          if (
            workspaceNames.has(dependency) &&
            packageSubpath(specifier, dependency).startsWith("src")
          ) {
            violations.push(`${location}: do not import workspace source internals (${specifier})`);
          }
          if (dependency.startsWith("@workbench/") && !workspaceNames.has(dependency)) {
            violations.push(`${location}: unknown Workbench workspace package ${dependency}`);
          }
          if (!declared.has(dependency)) {
            violations.push(
              `${location}: ${dependency} is imported from ${sourceDirectory}/ but is not declared in the package manifest`,
            );
          }
        }
      }
    }
  }
  return violations.sort();
}

export async function checkWorkspaceDependencies(repositoryRoot = REPOSITORY_ROOT) {
  const violations = await workspaceDependencyViolations(repositoryRoot);
  if (violations.length === 0) return;
  throw new Error(
    `Workspace dependency boundary violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await checkWorkspaceDependencies();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
