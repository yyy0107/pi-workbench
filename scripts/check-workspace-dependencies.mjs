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
const PACKAGE_PRODUCTION_DEPENDENCY_POLICIES = new Map([
  [
    "@workbench/automation-server",
    new Set(["@workbench/automation-contracts", "@workbench/server-core", "cron-parser"]),
  ],
  [
    "@workbench/execution-server",
    new Set([
      "@workbench/execution-contracts",
      "@workbench/server-core",
      "@workbench/terminal-server",
    ]),
  ],
  [
    "@workbench/settings-server",
    new Set([
      "@workbench/agent-runtime-contracts",
      "@workbench/contracts",
      "@workbench/server-core",
    ]),
  ],
]);

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

async function workspaceDirectories(repositoryRoot) {
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
        directories.push({
          directory,
          kind: pattern.startsWith("apps/") ? "app" : "package",
        });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return directories.sort(({ directory: left }, { directory: right }) => left.localeCompare(right));
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
  const expression =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`([^`\\]|\\.)*`|[A-Za-z_$][\w$]*|\S/g;
  for (const match of source.matchAll(expression)) {
    const value = match[0];
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    if (value[0] === '"' || value[0] === "'" || value[0] === "`") {
      tokens.push({ type: "string", value: value.slice(1, -1) });
    } else if (/^[A-Za-z_$]/u.test(value)) tokens.push({ type: "identifier", value });
    else tokens.push({ type: "punctuation", value });
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
    if (tokens[index + 1]?.type === "string") specifiers.push(tokens[index + 1].value);
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
        specifiers.push(tokens[cursor + 1].value);
        break;
      }
    }
  }
  return specifiers;
}

function pathReferenceValues(source) {
  const values = [];
  const expression =
    /(?=(?:new\s+URL|(?:path\.)?(?:join|resolve|normalize)|(?:fs\.)?(?:readFile|readFileSync|readdir|readdirSync|stat|statSync))\s*\(([^)]*)\))/gu;
  for (const match of source.matchAll(expression)) {
    const argumentsSource = match[1] ?? "";
    const strings = [...argumentsSource.matchAll(/["'`]([^"'`]*)["'`]/gu)].map((item) => item[1]);
    if (strings.length === 0) continue;
    values.push({
      reference: strings.join("/"),
      repositoryRelative: /^\s*(?:repositoryRoot|PROJECT_ROOT|REPOSITORY_ROOT)\s*(?:,|$)/u.test(
        argumentsSource,
      ),
    });
  }
  return values;
}

function importedPackageName(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier === "client-only" ||
    specifier === "server-only" ||
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

function isInsideDirectory(target, directory) {
  const relative = path.relative(directory, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function matchingAppDirectory({
  filename,
  reference,
  repositoryRelative = false,
  appDirectories,
  repositoryRoot,
  aliasRoot = repositoryRoot,
}) {
  const resolved = reference.startsWith("@/")
    ? path.resolve(aliasRoot, reference.slice(2))
    : path.resolve(repositoryRelative ? repositoryRoot : path.dirname(filename), reference);
  for (const directory of appDirectories) {
    if (isInsideDirectory(resolved, directory)) return directory;
  }

  const normalizedReference = reference.split(/[/\\]+/).filter(Boolean);
  for (const directory of appDirectories) {
    const relativeDirectory = path
      .relative(repositoryRoot, directory)
      .split(path.sep)
      .filter(Boolean);
    for (
      let index = 0;
      index <= normalizedReference.length - relativeDirectory.length;
      index += 1
    ) {
      if (
        relativeDirectory.every(
          (segment, offset) => normalizedReference[index + offset] === segment,
        )
      ) {
        return directory;
      }
    }
  }
  return undefined;
}

function matchingPackageSourceDirectory({
  filename,
  reference,
  repositoryRelative = false,
  packageDirectories,
  repositoryRoot,
  aliasRoot = repositoryRoot,
}) {
  const pathLike =
    repositoryRelative ||
    reference.startsWith(".") ||
    reference.startsWith("/") ||
    reference.startsWith("@/") ||
    path.isAbsolute(reference);
  if (!pathLike) return undefined;
  const resolved = reference.startsWith("@/")
    ? path.resolve(aliasRoot, reference.slice(2))
    : path.resolve(repositoryRelative ? repositoryRoot : path.dirname(filename), reference);
  return packageDirectories.find((directory) => isInsideDirectory(resolved, directory));
}

function sourceBoundaryViolations({
  appDirectories,
  appNames,
  enforcePackageBoundary,
  filename,
  owner,
  packageDirectories,
  repositoryRoot,
  source,
}) {
  const location = path.relative(repositoryRoot, filename);
  const aliasRoot = owner.kind === "app" ? path.join(owner.directory, "src") : repositoryRoot;
  const violations = [];
  const report = (targetDirectory, detail) => {
    const target = path.relative(repositoryRoot, targetDirectory);
    if (owner.kind === "package") {
      violations.push(
        `${location}: packages must not depend on app source (${target}) via ${detail}`,
      );
      return;
    }
    if (targetDirectory !== owner.directory) {
      violations.push(
        `${location}: apps must not depend on another app source (${target}) via ${detail}`,
      );
    }
  };
  const reportPackage = (targetDirectory, detail) => {
    if (!enforcePackageBoundary || targetDirectory === owner.directory) return;
    violations.push(
      `${location}: workspace source must not depend on another package source (${path.relative(repositoryRoot, targetDirectory)}) via ${detail}`,
    );
  };

  for (const specifier of moduleSpecifiers(source, filename)) {
    const dependency = importedPackageName(specifier);
    const targetDirectory =
      appNames.get(dependency) ??
      matchingAppDirectory({
        aliasRoot,
        filename,
        reference: specifier,
        appDirectories,
        repositoryRoot,
      });
    if (targetDirectory) report(targetDirectory, `module specifier ${specifier}`);
    else {
      const packageDirectory = matchingPackageSourceDirectory({
        aliasRoot,
        filename,
        reference: specifier,
        packageDirectories,
        repositoryRoot,
      });
      if (packageDirectory) {
        reportPackage(packageDirectory, `module specifier ${specifier}`);
        continue;
      }
    }
  }
  for (const { reference, repositoryRelative } of pathReferenceValues(source)) {
    const targetDirectory = matchingAppDirectory({
      aliasRoot,
      filename,
      reference,
      repositoryRelative,
      appDirectories,
      repositoryRoot,
    });
    if (targetDirectory) report(targetDirectory, `source path ${reference}`);
    else {
      const packageDirectory = matchingPackageSourceDirectory({
        aliasRoot,
        filename,
        reference,
        repositoryRelative,
        packageDirectories,
        repositoryRoot,
      });
      if (packageDirectory) {
        reportPackage(packageDirectory, `source path ${reference}`);
        continue;
      }
    }
  }
  return [...new Set(violations)];
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
  const directories = await workspaceDirectories(repositoryRoot);
  const workspaces = [];

  for (const { directory, kind } of directories) {
    const manifestPath = path.join(directory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error(`${path.relative(repositoryRoot, manifestPath)} must declare a package name`);
    }
    workspaces.push({ directory, kind, manifest, manifestPath });
  }

  const packages = workspaces.filter((workspace) => workspace.kind === "package");
  const apps = workspaces.filter((workspace) => workspace.kind === "app");
  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));
  const allWorkspaceNames = new Set(workspaces.map(({ manifest }) => manifest.name));
  const appNames = new Map(apps.map(({ directory, manifest }) => [manifest.name, directory]));
  const appDirectories = apps.map(({ directory }) => directory);
  const packageDirectories = packages.map(({ directory }) => directory);
  const violations = [];
  for (const cycle of workspaceDependencyCycles(
    productionWorkspaceGraph(packages, workspaceNames),
  )) {
    violations.push(`workspace production dependency cycle: ${cycle}`);
  }

  for (const workspace of workspaces) {
    const { directory, kind, manifest, manifestPath } = workspace;
    const productionDependencyPolicy = PACKAGE_PRODUCTION_DEPENDENCY_POLICIES.get(manifest.name);
    for (const field of [...PRODUCTION_DEPENDENCY_FIELDS, "devDependencies"]) {
      for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
        if (
          productionDependencyPolicy &&
          PRODUCTION_DEPENDENCY_FIELDS.includes(field) &&
          !productionDependencyPolicy.has(dependency)
        ) {
          violations.push(
            `${path.relative(repositoryRoot, manifestPath)}: ${manifest.name} must not declare production dependency ${dependency}`,
          );
        }
        if (allWorkspaceNames.has(dependency) && !String(version).startsWith("workspace:")) {
          violations.push(
            `${path.relative(repositoryRoot, manifestPath)}: ${dependency} must use the workspace: protocol`,
          );
        }
        const appDirectory = appNames.get(dependency);
        if (!appDirectory) continue;
        const appPath = path.relative(repositoryRoot, appDirectory);
        if (kind === "package") {
          violations.push(
            `${path.relative(repositoryRoot, manifestPath)}: packages must not declare app dependency (${appPath})`,
          );
        } else if (appDirectory !== directory) {
          violations.push(
            `${path.relative(repositoryRoot, manifestPath)}: apps must not declare another app dependency (${appPath})`,
          );
        }
      }
    }

    for (const sourceDirectory of ["src", "test"]) {
      const allowDevelopment = sourceDirectory === "test";
      const declared = declaredDependencies(manifest, allowDevelopment);
      for (const filename of await sourceFiles(path.join(directory, sourceDirectory))) {
        const source = await readFile(filename, "utf8");
        violations.push(
          ...sourceBoundaryViolations({
            appDirectories,
            appNames,
            enforcePackageBoundary: sourceDirectory === "src",
            filename,
            owner: { directory, kind },
            packageDirectories,
            repositoryRoot,
            source,
          }),
        );
        for (const specifier of moduleSpecifiers(source, filename)) {
          const dependency = importedPackageName(specifier);
          if (!dependency || dependency === manifest.name) continue;
          const location = path.relative(repositoryRoot, filename);

          if (
            sourceDirectory === "src" &&
            productionDependencyPolicy &&
            !productionDependencyPolicy.has(dependency)
          ) {
            violations.push(
              `${location}: ${manifest.name} source must not import dependency ${dependency}`,
            );
          }

          if (
            allWorkspaceNames.has(dependency) &&
            packageSubpath(specifier, dependency).startsWith("src")
          ) {
            violations.push(`${location}: do not import workspace source internals (${specifier})`);
          }
          if (dependency.startsWith("@workbench/") && !allWorkspaceNames.has(dependency)) {
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
