const { isInside } = require("./filesystem.cjs");
const { lstatSync, readFileSync, readdirSync, realpathSync } = require("node:fs");
const path = require("node:path");

const { ARTIFACT_TEST_SHAPE_PATTERN, isArtifactTestShapedPath } = require("./source-shape.cjs");

const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_MODEL_READABLE_ROOTS = Object.freeze(["README.md", "docs", "examples"]);
const RUNTIME_TEST_PATH_PATTERN = ARTIFACT_TEST_SHAPE_PATTERN;
const RUNTIME_TYPESCRIPT_SOURCE_PATTERN = /\.(?:[cm]?ts|tsx)$/iu;

function artifactRelativePath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe Runtime artifact relative path: ${relativePath}.`);
  }
  return normalized;
}

function isPathInResolvedExamplesTree(relativePath, resolvedExamplesRoot) {
  return (
    typeof relativePath === "string" &&
    typeof resolvedExamplesRoot === "string" &&
    resolvedExamplesRoot.length > 0 &&
    relativePath.startsWith(`${resolvedExamplesRoot}/`)
  );
}

function isTypeScriptOrTestPath(relativePath) {
  return (
    typeof relativePath === "string" &&
    (RUNTIME_TYPESCRIPT_SOURCE_PATTERN.test(relativePath) || isArtifactTestShapedPath(relativePath))
  );
}

function isRuntimeArtifactModelReadableException(
  relativePath,
  modelReadableResources,
  resolvedExamplesRoot,
) {
  return (
    Array.isArray(modelReadableResources) &&
    modelReadableResources.includes(relativePath) &&
    isPathInResolvedExamplesTree(relativePath, resolvedExamplesRoot)
  );
}

function requireRegularFile(absolutePath, artifactRoot, packageRoot) {
  const stats = lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Pi model-readable path must be a regular file: ${absolutePath}.`);
  }
  const resolved = realpathSync(absolutePath);
  if (!isInside(artifactRoot, resolved) || !isInside(packageRoot, resolved)) {
    throw new Error(`Pi model-readable file escapes its artifact package: ${absolutePath}.`);
  }
  return artifactRelativePath(path.relative(artifactRoot, resolved));
}

function collectDirectory(directory, artifactRoot, packageRoot, result) {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Pi model-readable path must be a real directory: ${directory}.`);
  }
  const resolvedDirectory = realpathSync(directory);
  if (!isInside(artifactRoot, resolvedDirectory) || !isInside(packageRoot, resolvedDirectory)) {
    throw new Error(`Pi model-readable directory escapes its artifact package: ${directory}.`);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Pi model-readable tree contains a symlink: ${absolutePath}.`);
    }
    if (entry.isDirectory()) {
      collectDirectory(absolutePath, artifactRoot, packageRoot, result);
    } else if (entry.isFile()) {
      result.push(requireRegularFile(absolutePath, artifactRoot, packageRoot));
    } else {
      throw new Error(`Pi model-readable tree contains an unsupported entry: ${absolutePath}.`);
    }
  }
}

/**
 * Derives the advertised model-readable Pi closure only from the final artifact's resolved
 * package. The public alias may be a pnpm symlink; reported paths always name physical files.
 */
function collectRuntimeArtifactModelReadableResources({ artifactRoot } = {}) {
  if (typeof artifactRoot !== "string" || !path.isAbsolute(artifactRoot)) {
    throw new Error("Runtime artifact model resources require an absolute artifact root.");
  }
  const resolvedArtifactRoot = realpathSync(artifactRoot);
  const packageAlias = path.join(
    resolvedArtifactRoot,
    "node_modules",
    ...PI_CODING_AGENT_PACKAGE.split("/"),
  );
  let packageRoot;
  try {
    packageRoot = realpathSync(packageAlias);
  } catch {
    throw new Error(`Runtime artifact is missing ${PI_CODING_AGENT_PACKAGE}.`);
  }
  if (!isInside(resolvedArtifactRoot, packageRoot)) {
    throw new Error(`${PI_CODING_AGENT_PACKAGE} resolves outside the Runtime artifact.`);
  }
  const packageStats = lstatSync(packageRoot);
  if (!packageStats.isDirectory() || packageStats.isSymbolicLink()) {
    throw new Error(`${PI_CODING_AGENT_PACKAGE} must resolve to a real package directory.`);
  }

  const packageJson = path.join(packageRoot, "package.json");
  requireRegularFile(packageJson, resolvedArtifactRoot, packageRoot);
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(readFileSync(packageJson, "utf8"));
  } catch {
    throw new Error(`${PI_CODING_AGENT_PACKAGE} package metadata is unreadable.`);
  }
  if (
    !packageMetadata ||
    typeof packageMetadata !== "object" ||
    packageMetadata.name !== PI_CODING_AGENT_PACKAGE
  ) {
    throw new Error(`Runtime artifact package identity is not ${PI_CODING_AGENT_PACKAGE}.`);
  }

  const [readmeName, docsName, examplesName] = PI_MODEL_READABLE_ROOTS;
  const resources = [
    requireRegularFile(path.join(packageRoot, readmeName), resolvedArtifactRoot, packageRoot),
  ];
  const docsDirectory = path.join(packageRoot, docsName);
  const examplesDirectory = path.join(packageRoot, examplesName);
  collectDirectory(docsDirectory, resolvedArtifactRoot, packageRoot, resources);
  collectDirectory(examplesDirectory, resolvedArtifactRoot, packageRoot, resources);

  return Object.freeze({
    resources: Object.freeze([...new Set(resources)].sort()),
    resolvedExamplesRoot: artifactRelativePath(
      path.relative(resolvedArtifactRoot, realpathSync(examplesDirectory)),
    ),
  });
}

/** Enforces the schema subset plus the stricter producer/consumer exact Pi closure policy. */
function assertRuntimeArtifactModelReadableResourceClassification({
  resources,
  modelReadableResources,
  expectedModelReadableResources,
  resolvedExamplesRoot,
} = {}) {
  if (
    !Array.isArray(resources) ||
    !resources.every((item) => typeof item === "string") ||
    !Array.isArray(modelReadableResources) ||
    !modelReadableResources.every((item) => typeof item === "string") ||
    !Array.isArray(expectedModelReadableResources) ||
    !expectedModelReadableResources.every((item) => typeof item === "string")
  ) {
    throw new Error("Runtime artifact model-readable resource classification is malformed.");
  }
  const actual = [...modelReadableResources];
  const expected = [...expectedModelReadableResources];
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify([...actual].sort()) ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "Runtime artifact model-readable resources do not match the Pi package closure.",
    );
  }
  const resourceSet = new Set(resources);
  if (!actual.every((resource) => resourceSet.has(resource))) {
    throw new Error("Runtime artifact model-readable resources are outside the final resources.");
  }
  for (const resource of resources) {
    if (
      isTypeScriptOrTestPath(resource) &&
      !isRuntimeArtifactModelReadableException(resource, actual, resolvedExamplesRoot)
    ) {
      throw new Error(
        `Runtime artifact TS/test resource is outside Pi's resolved examples tree: ${resource}.`,
      );
    }
  }
}

module.exports = {
  PI_CODING_AGENT_PACKAGE,
  PI_MODEL_READABLE_ROOTS,
  RUNTIME_TEST_PATH_PATTERN,
  RUNTIME_TYPESCRIPT_SOURCE_PATTERN,
  assertRuntimeArtifactModelReadableResourceClassification,
  collectRuntimeArtifactModelReadableResources,
  isPathInResolvedExamplesTree,
  isRuntimeArtifactModelReadableException,
  isTypeScriptOrTestPath,
};
