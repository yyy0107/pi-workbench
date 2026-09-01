const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, readdirSync, readlinkSync } = require("node:fs");
const path = require("node:path");

function snapshotArtifactTree(rootDirectory, { label = "artifact" } = {}) {
  const root = path.resolve(rootDirectory);
  const entries = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const stats = lstatSync(absolutePath);
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (stats.isSymbolicLink()) {
        entries.push(
          Object.freeze({
            path: relativePath,
            type: "symlink",
            target: readlinkSync(absolutePath),
          }),
        );
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`${label} contains an unsupported filesystem entry: ${relativePath}`);
      }
      entries.push(
        Object.freeze({
          path: relativePath,
          type: "file",
          size: stats.size,
          mode: stats.mode & 0o777,
          sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
        }),
      );
    }
  }
  visit(root);
  return Object.freeze(entries.sort((left, right) => left.path.localeCompare(right.path)));
}

function assertArtifactTreeEquivalent(
  expectedDirectory,
  actualDirectory,
  { actualLabel = "actual artifact", expectedLabel = "expected artifact" } = {},
) {
  const expected = snapshotArtifactTree(expectedDirectory, { label: expectedLabel });
  const actual = snapshotArtifactTree(actualDirectory, { label: actualLabel });
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return Object.freeze({
      actualDirectory: path.resolve(actualDirectory),
      entries: actual.length,
    });
  }

  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const deltas = [];
  for (const relativePath of [
    ...new Set([...expectedByPath.keys(), ...actualByPath.keys()]),
  ].sort()) {
    const expectedEntry = expectedByPath.get(relativePath);
    const actualEntry = actualByPath.get(relativePath);
    if (JSON.stringify(actualEntry) === JSON.stringify(expectedEntry)) continue;
    deltas.push(
      `${relativePath}: ${expectedLabel}=${expectedEntry ? JSON.stringify(expectedEntry) : "missing"}; ${actualLabel}=${actualEntry ? JSON.stringify(actualEntry) : "missing"}`,
    );
  }
  throw new Error(
    [
      `${actualLabel} is not byte-for-byte and mode-for-mode equivalent to ${expectedLabel}.`,
      `${expectedLabel} entries: ${expected.length}; ${actualLabel} entries: ${actual.length}; deltas: ${deltas.length}.`,
      ...deltas.slice(0, 20),
      ...(deltas.length > 20 ? [`... ${deltas.length - 20} more delta(s)`] : []),
    ].join("\n"),
  );
}

function assertRuntimeTreeEquivalent(expectedDirectory, actualDirectory) {
  return assertArtifactTreeEquivalent(expectedDirectory, actualDirectory, {
    actualLabel: "packaged desktop-runtime",
    expectedLabel: "staged desktop-runtime",
  });
}

const snapshotRuntimeTree = snapshotArtifactTree;

module.exports = {
  assertArtifactTreeEquivalent,
  assertRuntimeTreeEquivalent,
  snapshotArtifactTree,
  snapshotRuntimeTree,
};
