import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const TYPESCRIPT_TEST_LOADER = fileURLToPath(
  new URL("./register-typescript-test-loader.mjs", import.meta.url),
);
const ROOT_TEST_DIRECTORIES = [
  "app",
  "components",
  "extensions",
  "hooks",
  "i18n",
  "lib",
  "platform",
  "scripts",
  "services",
  "stores",
  "test-utils",
  "workbench",
];
const TEST_FILENAME = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const TEST_GLOB_SUFFIX = "**/*.{test,spec}.{js,cjs,mjs,ts,cts,mts,jsx,tsx}";

async function containsTests(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isFile() && TEST_FILENAME.test(entry.name)) return true;
    if (entry.isDirectory() && (await containsTests(path.join(directory, entry.name)))) return true;
  }
  return false;
}

function repositoryRelativeProject(projectDirectory) {
  const absoluteProject = path.resolve(projectDirectory);
  const relativeProject = path.relative(REPOSITORY_ROOT, absoluteProject);
  if (
    relativeProject === "" ||
    relativeProject === ".." ||
    relativeProject.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeProject)
  ) {
    throw new Error(`Workspace test project must be inside ${REPOSITORY_ROOT}: ${absoluteProject}`);
  }
  return relativeProject;
}

function packageProjectDirectory() {
  const packageJson = process.env.npm_package_json;
  if (!packageJson) {
    throw new Error("--package requires pnpm to provide the npm_package_json environment variable");
  }
  return path.dirname(packageJson);
}

export async function testGlobs({ projectDirectory } = {}) {
  const candidateDirectories = projectDirectory
    ? ["src", "test"].map((directory) => path.join(projectDirectory, directory))
    : ROOT_TEST_DIRECTORIES.map((directory) => path.join(REPOSITORY_ROOT, directory));
  const globs = [];

  for (const directory of candidateDirectories) {
    if (!(await containsTests(directory))) continue;
    const relativeDirectory = path.relative(REPOSITORY_ROOT, directory).split(path.sep).join("/");
    globs.push(`${relativeDirectory}/${TEST_GLOB_SUFFIX}`);
  }
  return globs;
}

function selectedProjectDirectory(arguments_) {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length === 1 && arguments_[0] === "--package") {
    const projectDirectory = packageProjectDirectory();
    repositoryRelativeProject(projectDirectory);
    return projectDirectory;
  }
  if (arguments_.length === 2 && arguments_[0] === "--project") {
    const projectDirectory = path.resolve(REPOSITORY_ROOT, arguments_[1]);
    repositoryRelativeProject(projectDirectory);
    return projectDirectory;
  }
  throw new Error("Usage: run-typescript-tests.mjs [--package | --project <repo-relative-path>]");
}

export async function runTests(arguments_ = process.argv.slice(2)) {
  const projectDirectory = selectedProjectDirectory(arguments_);
  const globs = await testGlobs({ projectDirectory });
  if (globs.length === 0) return 0;

  const child = spawn(
    process.execPath,
    ["--no-warnings=ExperimentalWarning", "--import", TYPESCRIPT_TEST_LOADER, "--test", ...globs],
    { cwd: REPOSITORY_ROOT, stdio: "inherit" },
  );
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`TypeScript test runner terminated by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await runTests();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
