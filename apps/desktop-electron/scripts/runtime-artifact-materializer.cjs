const path = require("node:path");
const { lstatSync, realpathSync, statSync } = require("node:fs");

const {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  runtimeArtifactTargetKey,
} = require("@workbench/host-contracts/runtime-artifact-manifest");

const {
  assertExactTarget,
  assertPathInside,
  createElectronRuntimeArtifactAdapter,
  resolveInstalledElectronTarget,
  validateElectronRuntimeTarget,
} = require("./native-runtime.cjs");

const MATERIALIZATION_REQUEST_FLAG = "--request-json";
const NATIVE_RUNTIME_INVENTORY_FILENAME = "native-runtime-inventory.json";
const SCRIPT_REPOSITORY_ROOT = realpathSync(path.resolve(__dirname, "../../.."));

function assertExactObjectKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function canonicalExistingDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`Runtime artifact materialization ${label} must be absolute.`);
  }
  const resolved = path.resolve(value);
  if (value !== resolved) {
    throw new Error(`Runtime artifact materialization ${label} spelling must be canonical.`);
  }
  let physical;
  try {
    physical = realpathSync(resolved);
    if (!statSync(physical).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`Runtime artifact materialization ${label} must be an existing directory.`);
  }
  return Object.freeze({ physical, resolved });
}

function pathExistsLexically(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertRuntimeProducerCandidate(outputDirectory, repositoryRoot, target, producerPid) {
  const expectedParent = path.join(repositoryRoot, ".desktop-build", "runtime-node");
  if (path.dirname(outputDirectory) !== expectedParent) {
    throw new Error(
      `Runtime artifact materialization output parent must be exactly ${expectedParent}.`,
    );
  }
  const targetKey = runtimeArtifactTargetKey(target);
  const escapedTargetKey = targetKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const candidatePattern = new RegExp(
    `^\\.${escapedTargetKey}\\.tmp-${producerPid}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    "u",
  );
  if (!candidatePattern.test(path.basename(outputDirectory))) {
    throw new Error(
      `Runtime artifact materialization output must be the exact ${targetKey} producer candidate.`,
    );
  }
  for (const filename of [RUNTIME_ARTIFACT_MANIFEST_FILENAME, NATIVE_RUNTIME_INVENTORY_FILENAME]) {
    if (pathExistsLexically(path.join(outputDirectory, filename))) {
      throw new Error(`Runtime artifact producer candidate already contains ${filename}.`);
    }
  }
}

function parseRuntimeArtifactMaterializationRequest(
  args,
  { expectedRepositoryRoot = SCRIPT_REPOSITORY_ROOT, producerPid = process.ppid } = {},
) {
  if (args.length !== 2 || args[0] !== MATERIALIZATION_REQUEST_FLAG) {
    throw new Error(
      `Usage: runtime-artifact-materializer.cjs ${MATERIALIZATION_REQUEST_FLAG} <json>`,
    );
  }
  let value;
  try {
    value = JSON.parse(args[1]);
  } catch {
    throw new Error("Runtime artifact materialization request is invalid JSON.");
  }
  assertExactObjectKeys(
    value,
    ["outputDirectory", "repositoryRoot", "schemaVersion", "target"],
    "Runtime artifact materialization request",
  );
  if (value.schemaVersion !== 1) {
    throw new Error("Runtime artifact materialization request schema is unsupported.");
  }
  const target = validateElectronRuntimeTarget(value.target);
  const repository = canonicalExistingDirectory(value.repositoryRoot, "repository root");
  if (repository.physical !== repository.resolved) {
    throw new Error(
      "Runtime artifact materialization repository root must use its canonical real path.",
    );
  }
  if (repository.physical !== expectedRepositoryRoot) {
    throw new Error(
      "Runtime artifact materialization repository root must match the materializer checkout.",
    );
  }
  const output = canonicalExistingDirectory(value.outputDirectory, "output directory");
  assertPathInside(
    repository.physical,
    output.physical,
    "Runtime artifact materialization output realpath",
  );
  if (output.physical !== output.resolved) {
    throw new Error(
      "Runtime artifact materialization output directory must use its canonical real path.",
    );
  }
  assertRuntimeProducerCandidate(output.physical, repository.physical, target, producerPid);
  return Object.freeze({
    schemaVersion: 1,
    target,
    repositoryRoot: repository.physical,
    outputDirectory: output.physical,
  });
}

async function materializeElectronRuntimeArtifact({
  request,
  environment = process.env,
  createAdapter = createElectronRuntimeArtifactAdapter,
  resolveInstalledTarget = resolveInstalledElectronTarget,
} = {}) {
  if (!request) throw new Error("Runtime artifact materialization request is required.");
  const installedTarget = resolveInstalledTarget({ environment });
  assertExactTarget(installedTarget, request.target, "Installed Electron Runtime artifact target");
  const adapter = createAdapter({ target: request.target, environment });
  await adapter.validateTarget(request.target);
  await adapter.materialize({
    target: request.target,
    outputDirectory: request.outputDirectory,
    repositoryRoot: request.repositoryRoot,
  });
}

if (require.main === module) {
  void materializeElectronRuntimeArtifact({
    request: parseRuntimeArtifactMaterializationRequest(process.argv.slice(2)),
  }).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Runtime artifact materialization failed.",
    );
    process.exitCode = 1;
  });
}

module.exports = {
  MATERIALIZATION_REQUEST_FLAG,
  SCRIPT_REPOSITORY_ROOT,
  assertRuntimeProducerCandidate,
  materializeElectronRuntimeArtifact,
  parseRuntimeArtifactMaterializationRequest,
};
