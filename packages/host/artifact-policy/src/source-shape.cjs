const ARTIFACT_TEST_DIRECTORY_PATTERN = /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)/iu;
const ARTIFACT_TEST_CODE_FILE_PATTERN =
  /(?:^|\/)(?:(?:tests?|specs?|fixtures?)|[^/]+[._-](?:tests?|specs?|fixtures?))\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx)$/iu;
const ARTIFACT_TEST_SHAPE_PATTERN = new RegExp(
  `${ARTIFACT_TEST_DIRECTORY_PATTERN.source}|${ARTIFACT_TEST_CODE_FILE_PATTERN.source}`,
  "iu",
);

function normalizeArtifactPath(candidate) {
  return typeof candidate === "string" ? candidate.replaceAll("\\", "/") : "";
}

/** Directory semantics intentionally remain broader than test-shaped filename semantics. */
function isArtifactTestDirectoryPath(candidate) {
  return ARTIFACT_TEST_DIRECTORY_PATTERN.test(normalizeArtifactPath(candidate));
}

/** Test/spec/fixture basenames and suffixes are meaningful only for JS/TS code files. */
function isArtifactTestCodeFilePath(candidate) {
  return ARTIFACT_TEST_CODE_FILE_PATTERN.test(normalizeArtifactPath(candidate));
}

function isArtifactTestShapedPath(candidate) {
  return ARTIFACT_TEST_SHAPE_PATTERN.test(normalizeArtifactPath(candidate));
}

module.exports = {
  ARTIFACT_TEST_CODE_FILE_PATTERN,
  ARTIFACT_TEST_DIRECTORY_PATTERN,
  ARTIFACT_TEST_SHAPE_PATTERN,
  isArtifactTestCodeFilePath,
  isArtifactTestDirectoryPath,
  isArtifactTestShapedPath,
};
