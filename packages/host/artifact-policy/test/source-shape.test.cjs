const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isArtifactTestCodeFilePath,
  isArtifactTestDirectoryPath,
  isArtifactTestShapedPath,
} = require("../src/source-shape.cjs");

test("classifies the shared artifact test directory shapes on either path separator", () => {
  for (const candidate of [
    "test/unit/data.json",
    "tests/unit/data.json",
    "__tests__/data.svg",
    "package/fixtures/data.bin",
    "package\\fixtures\\data.bin",
  ]) {
    assert.equal(isArtifactTestDirectoryPath(candidate), true, candidate);
    assert.equal(isArtifactTestShapedPath(candidate), true, candidate);
  }
  for (const candidate of [
    "package/test-data/data.json",
    "package/fixture/data.json",
    "package/spec/data.json",
    "package/specs/data.json",
  ]) {
    assert.equal(isArtifactTestDirectoryPath(candidate), false, candidate);
  }
});

test("classifies whole test basenames and separated suffixes only on exact code extensions", () => {
  for (const extension of ["js", "cjs", "mjs", "jsx", "ts", "cts", "mts", "tsx"]) {
    for (const shape of ["test", "tests", "spec", "specs", "fixture", "fixtures"]) {
      for (const basename of [shape, `next.${shape}`, `next_${shape}`, `next-${shape}`]) {
        const candidate = `package/${basename}.${extension}`;
        assert.equal(isArtifactTestCodeFilePath(candidate), true, candidate);
        assert.equal(isArtifactTestShapedPath(candidate), true, candidate);
      }
    }
  }

  for (const candidate of [
    "package/folder-test.svg",
    "package/next-test.json",
    "package/next-test.d.ts",
    "package/typespec.mjs",
    "package/navigation-testing-lock.js",
    "package/instant-test-bootstrap.js",
    "package/next-test.cjsx",
  ]) {
    assert.equal(isArtifactTestCodeFilePath(candidate), false, candidate);
    assert.equal(isArtifactTestShapedPath(candidate), false, candidate);
  }
});
