const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const { parse } = require("next/dist/compiled/acorn");

const NEXT_PACKAGE_NAME = "next";
const NEXT_CONFIG_UTILS_RELATIVE_PATH = "dist/server/config-utils.js";
const NEXT_RUNTIME_SCHEMA_RELATIVE_PATH = "dist/server/config-schema.js";
const NEXT_TEST_RUNTIME_RELATIVE_PATH = "dist/cli/next-test.js";
const NEXT_TEST_RUNTIME_PACKAGE_SPECIFIER = "next/dist/cli/next-test.js";
const NEXT_TEST_RUNTIME_SPECIFIER = "../cli/next-test";
const NEXT_WEBPACK_RUNTIME_SHARED_SPECIFIER = "./webpack.js";
const NEXT_WEBPACK_RUNTIME_BUNDLE_SPECIFIER = "./bundle5";

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function assertCanonicalDirectory(directory, label) {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error(`${label} must be a canonical real directory.`);
  }
}

function assertCanonicalRegularFile(filename, rootDirectory, label) {
  if (!isPathInside(rootDirectory, filename)) {
    throw new Error(`${label} escapes the resolved Next package.`);
  }
  const stats = lstatSync(filename);
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(filename) !== filename) {
    throw new Error(`${label} must be a canonical regular file.`);
  }
}

function parseJavaScript(source, filename) {
  try {
    return parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceFile: filename,
      sourceType: "script",
    });
  } catch (error) {
    throw new Error(`Next config-schema.js is not parseable CommonJS: ${error.message}`);
  }
}

function parseCommonJs(source, filename, label) {
  try {
    return parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceFile: filename,
      sourceType: "script",
    });
  } catch (error) {
    throw new Error(`${label} is not parseable CommonJS: ${error.message}`);
  }
}

function visitJavaScript(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) visitJavaScript(child, visitor);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      visitJavaScript(value, visitor);
    }
  }
}

function isExactStaticRequire(node) {
  return (
    node?.type === "CallExpression" &&
    node.optional !== true &&
    node.callee?.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments?.length === 1 &&
    node.arguments[0]?.type === "Literal" &&
    node.arguments[0].value === NEXT_TEST_RUNTIME_SPECIFIER
  );
}

/**
 * Next 16.3.1 loads this CLI module from a top-level config-schema dependency. Keep the proof
 * deliberately narrower than a text search: comments, ESM imports, shadowed/nested/dead calls,
 * dynamic specifiers, and similarly named files do not establish this CommonJS runtime edge.
 */
function bindingPatternContainsRequire(pattern) {
  if (!pattern) return false;
  if (pattern.type === "Identifier") return pattern.name === "require";
  if (pattern.type === "RestElement") return bindingPatternContainsRequire(pattern.argument);
  if (pattern.type === "AssignmentPattern") return bindingPatternContainsRequire(pattern.left);
  if (pattern.type === "ArrayPattern") {
    return pattern.elements?.some(bindingPatternContainsRequire) ?? false;
  }
  if (pattern.type === "ObjectPattern") {
    return (
      pattern.properties?.some((property) =>
        bindingPatternContainsRequire(
          property.type === "RestElement" ? property.argument : property.value,
        ),
      ) ?? false
    );
  }
  return false;
}

function hasTopLevelRequireBinding(program) {
  for (const statement of program.body ?? []) {
    if (
      (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
      statement.id?.name === "require"
    ) {
      return true;
    }
    if (
      statement.type === "VariableDeclaration" &&
      statement.declarations?.some((declaration) => bindingPatternContainsRequire(declaration.id))
    ) {
      return true;
    }
  }
  return false;
}

function hasAnyRequireBinding(program) {
  let found = false;
  visitJavaScript(program, (node) => {
    if (found) return;
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression") &&
      (node.id?.name === "require" || node.params?.some(bindingPatternContainsRequire))
    ) {
      found = true;
      return;
    }
    if (
      (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
      node.id?.name === "require"
    ) {
      found = true;
      return;
    }
    if (node.type === "VariableDeclarator" && bindingPatternContainsRequire(node.id)) {
      found = true;
      return;
    }
    if (node.type === "CatchClause" && bindingPatternContainsRequire(node.param)) {
      found = true;
      return;
    }
    if (node.type === "ImportDeclaration") {
      found = node.specifiers?.some((specifier) => specifier.local?.name === "require") ?? false;
    }
  });
  return found;
}

function hasTopLevelNextTestDependency(program) {
  if (program.body?.[0]?.directive !== "use strict" || hasTopLevelRequireBinding(program)) {
    return false;
  }
  for (const statement of program.body ?? []) {
    if (statement.type === "ExpressionStatement" && isExactStaticRequire(statement.expression)) {
      return true;
    }
    if (
      statement.type === "VariableDeclaration" &&
      statement.declarations?.some((declaration) => isExactStaticRequire(declaration.init))
    ) {
      return true;
    }
  }
  return false;
}

function readNextPackageIdentity(packageManifest) {
  let value;
  try {
    value = JSON.parse(readFileSync(packageManifest, "utf8"));
  } catch {
    throw new Error("The resolved Next package manifest is invalid JSON.");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.name !== NEXT_PACKAGE_NAME ||
    typeof value.version !== "string" ||
    value.version.length === 0
  ) {
    throw new Error("The node_modules/next alias does not resolve to an exact Next package.");
  }
  return Object.freeze({ name: NEXT_PACKAGE_NAME, version: value.version });
}

function resolveWebArtifactNextPackage(artifactRoot, configuredNextAlias) {
  if (
    typeof artifactRoot !== "string" ||
    !path.isAbsolute(artifactRoot) ||
    path.normalize(artifactRoot) !== artifactRoot ||
    path.resolve(artifactRoot) !== artifactRoot
  ) {
    throw new Error("The Web artifact root must be an absolute canonical path.");
  }
  assertCanonicalDirectory(artifactRoot, "The Web artifact root");

  const nextAlias =
    configuredNextAlias ?? path.join(artifactRoot, "node_modules", NEXT_PACKAGE_NAME);
  if (
    typeof nextAlias !== "string" ||
    !path.isAbsolute(nextAlias) ||
    path.normalize(nextAlias) !== nextAlias ||
    path.resolve(nextAlias) !== nextAlias ||
    path.basename(nextAlias) !== NEXT_PACKAGE_NAME ||
    path.basename(path.dirname(nextAlias)) !== "node_modules" ||
    !isPathInside(artifactRoot, nextAlias)
  ) {
    throw new Error(
      "The Web artifact Next alias must be an exact confined node_modules/next path.",
    );
  }
  const aliasStats = lstatSync(nextAlias);
  if (!(aliasStats.isDirectory() || aliasStats.isSymbolicLink())) {
    throw new Error("The Web artifact node_modules/next entry must resolve to a directory.");
  }
  const nextPackageRoot = realpathSync(nextAlias);
  if (!isPathInside(artifactRoot, nextPackageRoot)) {
    throw new Error("The Web artifact node_modules/next alias escapes the artifact.");
  }
  assertCanonicalDirectory(nextPackageRoot, "The resolved Next package root");

  const packageManifest = path.join(nextPackageRoot, "package.json");
  assertCanonicalRegularFile(
    packageManifest,
    nextPackageRoot,
    "The resolved Next package manifest",
  );
  return Object.freeze({
    nextAlias,
    nextPackageRoot,
    packageIdentity: readNextPackageIdentity(packageManifest),
    packageManifest,
  });
}

function exactRequireHookAliasesCall(node) {
  const callee = node?.callee;
  const receiver = callee?.object;
  return (
    node?.type === "CallExpression" &&
    callee?.type === "MemberExpression" &&
    callee.computed === false &&
    callee.optional !== true &&
    callee.property?.type === "Identifier" &&
    callee.property.name === "addHookAliases" &&
    receiver?.type === "CallExpression" &&
    receiver.optional !== true &&
    receiver.callee?.type === "Identifier" &&
    receiver.callee.name === "require" &&
    receiver.arguments?.length === 1 &&
    receiver.arguments[0]?.type === "Literal" &&
    receiver.arguments[0].value === "../server/require-hook"
  );
}

function exactAliasMapCallback(node) {
  const parameter = node?.params?.[0];
  const body = node?.body;
  const resolved = body?.elements?.[1];
  return (
    node?.type === "ArrowFunctionExpression" &&
    node.async === false &&
    node.generator === false &&
    node.params?.length === 1 &&
    parameter?.type === "ArrayPattern" &&
    parameter.elements?.length === 2 &&
    parameter.elements[0]?.type === "Identifier" &&
    parameter.elements[0].name === "request" &&
    parameter.elements[1]?.type === "Identifier" &&
    parameter.elements[1].name === "replacement" &&
    body?.type === "ArrayExpression" &&
    body.elements?.length === 2 &&
    body.elements[0]?.type === "Identifier" &&
    body.elements[0].name === "request" &&
    resolved?.type === "CallExpression" &&
    resolved.optional !== true &&
    resolved.arguments?.length === 1 &&
    resolved.arguments[0]?.type === "Identifier" &&
    resolved.arguments[0].name === "replacement" &&
    resolved.callee?.type === "MemberExpression" &&
    resolved.callee.computed === false &&
    resolved.callee.optional !== true &&
    resolved.callee.object?.type === "Identifier" &&
    resolved.callee.object.name === "require" &&
    resolved.callee.property?.type === "Identifier" &&
    resolved.callee.property.name === "resolve"
  );
}

function nextWebpackAliasSpecifiers(program) {
  if (program.body?.[0]?.directive !== "use strict" || hasAnyRequireBinding(program)) {
    throw new Error("Next config-utils.js does not use the required unshadowed CommonJS shape.");
  }
  const calls = [];
  visitJavaScript(program, (node) => {
    if (exactRequireHookAliasesCall(node)) calls.push(node);
  });
  if (calls.length !== 1 || calls[0].arguments?.length !== 1) {
    throw new Error("Next config-utils.js must contain one exact addHookAliases dependency table.");
  }
  const mappedAliases = calls[0].arguments[0];
  if (
    mappedAliases?.type !== "CallExpression" ||
    mappedAliases.optional === true ||
    mappedAliases.arguments?.length !== 1 ||
    !exactAliasMapCallback(mappedAliases.arguments[0]) ||
    mappedAliases.callee?.type !== "MemberExpression" ||
    mappedAliases.callee.computed === true ||
    mappedAliases.callee.optional === true ||
    mappedAliases.callee.property?.type !== "Identifier" ||
    mappedAliases.callee.property.name !== "map" ||
    mappedAliases.callee.object?.type !== "ArrayExpression"
  ) {
    throw new Error(
      "Next config-utils.js does not resolve its alias table through require.resolve.",
    );
  }
  const replacements = [];
  for (const alias of mappedAliases.callee.object.elements ?? []) {
    if (
      alias?.type !== "ArrayExpression" ||
      alias.elements?.length !== 2 ||
      alias.elements[0]?.type !== "Literal" ||
      typeof alias.elements[0].value !== "string" ||
      alias.elements[1]?.type !== "Literal" ||
      typeof alias.elements[1].value !== "string"
    ) {
      throw new Error("Next config-utils.js contains a non-static webpack alias entry.");
    }
    const replacement = alias.elements[1].value;
    if (
      !replacement.startsWith("next/dist/compiled/webpack/") &&
      replacement !== "next/dist/compiled/@babel/runtime/package.json"
    ) {
      throw new Error("Next config-utils.js contains an unaudited webpack alias replacement.");
    }
    replacements.push(replacement);
  }
  const unique = [...new Set(replacements)].sort();
  if (
    unique.length === 0 ||
    !unique.includes("next/dist/compiled/webpack/webpack-lib") ||
    !unique.includes("next/dist/compiled/@babel/runtime/package.json")
  ) {
    throw new Error("Next config-utils.js is missing its required webpack runtime aliases.");
  }
  return Object.freeze(unique);
}

function staticRelativeRequires(program, label) {
  if (hasAnyRequireBinding(program)) {
    throw new Error(`${label} shadows the CommonJS require binding.`);
  }
  const specifiers = [];
  visitJavaScript(program, (node) => {
    if (
      node?.type !== "CallExpression" ||
      node.optional === true ||
      node.callee?.type !== "Identifier" ||
      node.callee.name !== "require"
    ) {
      return;
    }
    if (
      node.arguments?.length !== 1 ||
      node.arguments[0]?.type !== "Literal" ||
      typeof node.arguments[0].value !== "string"
    ) {
      throw new Error(`${label} contains a non-static CommonJS dependency.`);
    }
    if (node.arguments[0].value.startsWith(".")) specifiers.push(node.arguments[0].value);
  });
  return Object.freeze([...new Set(specifiers)].sort());
}

function resolveWebArtifactNextWebpackRuntime({ artifactRoot, nextAlias } = {}) {
  const nextPackage = resolveWebArtifactNextPackage(artifactRoot, nextAlias);
  const configUtils = path.join(
    nextPackage.nextPackageRoot,
    ...NEXT_CONFIG_UTILS_RELATIVE_PATH.split("/"),
  );
  assertCanonicalRegularFile(configUtils, nextPackage.nextPackageRoot, "Next config-utils.js");
  const configProgram = parseCommonJs(
    readFileSync(configUtils, "utf8"),
    configUtils,
    "Next config-utils.js",
  );
  const aliasSpecifiers = nextWebpackAliasSpecifiers(configProgram);
  const packageRequire = createRequire(configUtils);
  const runtimeFiles = new Map();
  const webpackWrappers = [];
  for (const packageSpecifier of aliasSpecifiers) {
    let runtimeFile;
    try {
      runtimeFile = packageRequire.resolve(packageSpecifier);
    } catch {
      throw new Error(`The Web artifact cannot resolve ${packageSpecifier}.`);
    }
    assertCanonicalRegularFile(
      runtimeFile,
      nextPackage.nextPackageRoot,
      `Next webpack alias dependency ${packageSpecifier}`,
    );
    runtimeFiles.set(runtimeFile, Object.freeze({ packageSpecifier, role: "alias-target" }));
    if (packageSpecifier.startsWith("next/dist/compiled/webpack/")) {
      webpackWrappers.push(runtimeFile);
    }
  }

  let sharedRuntimeFile;
  for (const wrapper of webpackWrappers) {
    const wrapperProgram = parseCommonJs(
      readFileSync(wrapper, "utf8"),
      wrapper,
      "Next compiled webpack alias wrapper",
    );
    const relativeRequires = staticRelativeRequires(
      wrapperProgram,
      "Next compiled webpack alias wrapper",
    );
    if (
      relativeRequires.length !== 1 ||
      relativeRequires[0] !== NEXT_WEBPACK_RUNTIME_SHARED_SPECIFIER
    ) {
      throw new Error("Next compiled webpack alias wrapper has an unaudited dependency closure.");
    }
    const expectedShared = path.join(path.dirname(wrapper), "webpack.js");
    assertCanonicalRegularFile(
      expectedShared,
      nextPackage.nextPackageRoot,
      "Next shared webpack runtime",
    );
    const resolvedShared = createRequire(wrapper).resolve(NEXT_WEBPACK_RUNTIME_SHARED_SPECIFIER);
    if (resolvedShared !== expectedShared || realpathSync(resolvedShared) !== expectedShared) {
      throw new Error("Next compiled webpack alias wrapper resolves an unexpected shared runtime.");
    }
    assertCanonicalRegularFile(
      resolvedShared,
      nextPackage.nextPackageRoot,
      "Next shared webpack runtime",
    );
    if (sharedRuntimeFile && sharedRuntimeFile !== resolvedShared) {
      throw new Error("Next compiled webpack aliases resolve multiple shared runtimes.");
    }
    sharedRuntimeFile = resolvedShared;
  }
  if (!sharedRuntimeFile) throw new Error("Next compiled webpack aliases have no shared runtime.");
  runtimeFiles.set(sharedRuntimeFile, Object.freeze({ role: "shared-runtime" }));

  const sharedProgram = parseCommonJs(
    readFileSync(sharedRuntimeFile, "utf8"),
    sharedRuntimeFile,
    "Next shared webpack runtime",
  );
  const sharedRelativeRequires = staticRelativeRequires(
    sharedProgram,
    "Next shared webpack runtime",
  );
  if (
    sharedRelativeRequires.length !== 1 ||
    sharedRelativeRequires[0] !== NEXT_WEBPACK_RUNTIME_BUNDLE_SPECIFIER
  ) {
    throw new Error("Next shared webpack runtime has an unaudited dependency closure.");
  }
  const expectedBundleRuntimeFile = path.join(path.dirname(sharedRuntimeFile), "bundle5.js");
  assertCanonicalRegularFile(
    expectedBundleRuntimeFile,
    nextPackage.nextPackageRoot,
    "Next compiled webpack bundle",
  );
  const bundleRuntimeFile = createRequire(sharedRuntimeFile).resolve(
    NEXT_WEBPACK_RUNTIME_BUNDLE_SPECIFIER,
  );
  if (
    bundleRuntimeFile !== expectedBundleRuntimeFile ||
    realpathSync(bundleRuntimeFile) !== expectedBundleRuntimeFile
  ) {
    throw new Error("Next shared webpack runtime resolves an unexpected compiled bundle.");
  }
  assertCanonicalRegularFile(
    bundleRuntimeFile,
    nextPackage.nextPackageRoot,
    "Next compiled webpack bundle",
  );
  runtimeFiles.set(bundleRuntimeFile, Object.freeze({ role: "compiled-bundle" }));

  const resources = [...runtimeFiles.entries()]
    .map(([runtimeFile, provenance]) => {
      const nextPackageRelativePath = path
        .relative(nextPackage.nextPackageRoot, runtimeFile)
        .split(path.sep)
        .join("/");
      const artifactRelativePath = path
        .relative(artifactRoot, runtimeFile)
        .split(path.sep)
        .join("/");
      if (
        !nextPackageRelativePath ||
        nextPackageRelativePath === ".." ||
        nextPackageRelativePath.startsWith("../") ||
        path.posix.isAbsolute(nextPackageRelativePath) ||
        !artifactRelativePath ||
        artifactRelativePath === ".." ||
        artifactRelativePath.startsWith("../") ||
        path.posix.isAbsolute(artifactRelativePath)
      ) {
        throw new Error("The Next webpack runtime dependency escapes the Web artifact.");
      }
      return Object.freeze({
        artifactRelativePath,
        nextPackageRelativePath,
        runtimeFile,
        ...provenance,
      });
    })
    .sort((left, right) => left.artifactRelativePath.localeCompare(right.artifactRelativePath));
  return Object.freeze({
    aliasSpecifiers,
    configUtils,
    nextPackageRoot: nextPackage.nextPackageRoot,
    packageIdentity: nextPackage.packageIdentity,
    resources: Object.freeze(resources),
  });
}

function assertWebArtifactNextWebpackRuntimeResources({ artifactRoot, resources } = {}) {
  const runtime = resolveWebArtifactNextWebpackRuntime({ artifactRoot });
  if (!Array.isArray(resources) || !resources.every((item) => typeof item === "string")) {
    throw new Error("The Web manifest resources must be an array of paths.");
  }
  for (const dependency of runtime.resources) {
    if (resources.filter((item) => item === dependency.artifactRelativePath).length !== 1) {
      throw new Error(
        "Every Next webpack runtime dependency must be owned exactly once by Web manifest resources.",
      );
    }
  }
  return runtime;
}

/**
 * Resolves the sole Web test-shaped production exception from the final artifact itself.
 * The returned path names the physical regular file, never the node_modules/next alias.
 */
function resolveWebArtifactNextRuntimeException({ artifactRoot } = {}) {
  const { nextPackageRoot, packageIdentity } = resolveWebArtifactNextPackage(artifactRoot);

  const configSchema = path.join(nextPackageRoot, ...NEXT_RUNTIME_SCHEMA_RELATIVE_PATH.split("/"));
  const runtimeFile = path.join(nextPackageRoot, ...NEXT_TEST_RUNTIME_RELATIVE_PATH.split("/"));
  assertCanonicalRegularFile(configSchema, nextPackageRoot, "Next config-schema.js");
  assertCanonicalRegularFile(runtimeFile, nextPackageRoot, "Next next-test.js runtime dependency");

  let resolvedPackageDependency;
  try {
    resolvedPackageDependency = createRequire(
      path.join(artifactRoot, ".web-artifact-next-runtime-provenance.cjs"),
    ).resolve(NEXT_TEST_RUNTIME_PACKAGE_SPECIFIER);
  } catch {
    throw new Error("The Web artifact cannot resolve next/dist/cli/next-test.js.");
  }
  if (
    resolvedPackageDependency !== runtimeFile ||
    realpathSync(resolvedPackageDependency) !== runtimeFile
  ) {
    throw new Error("The Web artifact resolves next/dist/cli/next-test.js to an unexpected file.");
  }

  const schemaProgram = parseJavaScript(readFileSync(configSchema, "utf8"), configSchema);
  if (!hasTopLevelNextTestDependency(schemaProgram)) {
    throw new Error(
      "Next config-schema.js does not contain the required top-level ../cli/next-test dependency.",
    );
  }
  let resolvedDependency;
  try {
    resolvedDependency = createRequire(configSchema).resolve(NEXT_TEST_RUNTIME_SPECIFIER);
  } catch {
    throw new Error("Next config-schema.js cannot resolve its ../cli/next-test dependency.");
  }
  if (resolvedDependency !== runtimeFile || realpathSync(resolvedDependency) !== runtimeFile) {
    throw new Error("Next config-schema.js resolves ../cli/next-test to an unexpected file.");
  }

  const artifactRelativePath = path.relative(artifactRoot, runtimeFile).split(path.sep).join("/");
  if (
    artifactRelativePath.length === 0 ||
    artifactRelativePath === ".." ||
    artifactRelativePath.startsWith("../") ||
    path.posix.isAbsolute(artifactRelativePath)
  ) {
    throw new Error("The Next next-test.js runtime dependency escapes the Web artifact.");
  }
  return Object.freeze({
    artifactRelativePath,
    configSchema,
    nextPackageRoot,
    packageIdentity,
    runtimeFile,
  });
}

function assertWebArtifactNextRuntimeExceptionResource({ artifactRoot, resources } = {}) {
  const exception = resolveWebArtifactNextRuntimeException({ artifactRoot });
  if (
    !Array.isArray(resources) ||
    !resources.every((item) => typeof item === "string") ||
    resources.filter((item) => item === exception.artifactRelativePath).length !== 1
  ) {
    throw new Error(
      "The Next next-test.js runtime dependency must be owned exactly once by Web manifest resources.",
    );
  }
  return exception;
}

module.exports = {
  NEXT_CONFIG_UTILS_RELATIVE_PATH,
  NEXT_RUNTIME_SCHEMA_RELATIVE_PATH,
  NEXT_TEST_RUNTIME_PACKAGE_SPECIFIER,
  NEXT_TEST_RUNTIME_RELATIVE_PATH,
  NEXT_TEST_RUNTIME_SPECIFIER,
  assertWebArtifactNextRuntimeExceptionResource,
  assertWebArtifactNextWebpackRuntimeResources,
  resolveWebArtifactNextRuntimeException,
  resolveWebArtifactNextWebpackRuntime,
};
