const { lstat, realpath } = require("node:fs/promises");
const path = require("node:path");

/** Lexical containment only. Callers must resolve links before checking physical containment. */
function isInside(parent, candidate, pathApi = path) {
  const relative = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative))
  );
}

function canonicalPathSpelling(candidate, label, pathApi = path) {
  if (
    typeof candidate !== "string" ||
    !pathApi.isAbsolute(candidate) ||
    pathApi.normalize(candidate) !== candidate ||
    pathApi.resolve(candidate) !== candidate
  ) {
    throw new Error(`${label} must be an absolute canonical path without aliases.`);
  }
  return candidate;
}

async function directoryIdentity(directory, label) {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory and not a symbolic link.`);
  }
  if ((await realpath(directory)) !== directory) {
    throw new Error(`${label} must be canonical and not aliased.`);
  }
  return Object.freeze({ device: stats.dev, inode: stats.ino });
}

async function optionalDirectoryIdentity(directory, label) {
  try {
    return await directoryIdentity(directory, label);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function sameDirectoryIdentity(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

module.exports = {
  isInside,
  canonicalPathSpelling,
  directoryIdentity,
  optionalDirectoryIdentity,
  sameDirectoryIdentity,
};
