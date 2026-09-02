import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SOURCE_ROOTS = [
  "apps/desktop-electron/scripts",
  "apps/desktop-electron/src",
  "apps/desktop-renderer/src",
  "apps/runtime-node/scripts",
  "apps/runtime-node/src",
  "apps/web/src",
  "packages/agent-runtime/adapters/pi/contributions/src",
  "packages/workbench/shell/src",
  "runtime",
];
const COMPOSITION_ROOTS = [
  "apps/desktop-electron/scripts/",
  "apps/desktop-electron/src/",
  "apps/runtime-node/scripts/",
  "apps/runtime-node/src/",
  "apps/web/src/",
  "runtime/",
];
const RUNTIME_GRAPH_IDENTIFIERS = [
  "createDefaultPiRpcRouteGroups",
  "createPiAgentServerAdapter",
  "createPiRpcRouter",
  "createPiRuntimeApiRouter",
  "createPiRuntimeHttpRouter",
  "createStreamHub",
  "getInteractiveResponseRegistry",
  "getStreamHub",
  "InteractiveResponseRegistry",
];
const NONLITERAL_MODULE_REFERENCE_EXCEPTIONS = new Map([
  ["apps/desktop-electron/src/packaged-runtime-lifecycle.cjs", "require:supportPath"],
]);
const RUNTIME_CONNECTION_OWNER =
  "packages/workbench/shell/src/runtime-connection/runtime-connection.ts";

export const INSTALLED_PI_COMPOSITION_OWNER =
  "apps/runtime-node/src/composition/installed-pi-server.ts";

function executableSource(source) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu,
    (match) =>
      match.startsWith("`")
        ? [...match.matchAll(/\$\{([\s\S]*?)\}/gu)].map((item) => item[1]).join(" ")
        : "",
  );
}

function nonliteralModuleReferences(source) {
  const references = [];
  for (const match of source.matchAll(/\b(require|import)\s*\(\s*([^\n;)]*)/gu)) {
    const argument = match[2].trim();
    if (
      argument === "" ||
      argument.startsWith('"') ||
      argument.startsWith("'") ||
      (argument.startsWith("`") && !argument.includes("${"))
    ) {
      continue;
    }
    references.push(`${match[1]}:${argument.replace(/\s+/gu, "")}`);
  }
  return references;
}

export function runtimeBoundaryViolations(files) {
  const violations = [];
  for (const [filename, source] of files) {
    const executable = executableSource(source);
    const isCompositionSource = COMPOSITION_ROOTS.some((root) => filename.startsWith(root));

    if (isCompositionSource) {
      for (const reference of nonliteralModuleReferences(source)) {
        if (NONLITERAL_MODULE_REFERENCE_EXCEPTIONS.get(filename) !== reference) {
          violations.push(`${filename}: non-literal module reference (${reference})`);
        }
      }

      for (const identifier of RUNTIME_GRAPH_IDENTIFIERS) {
        const calls = executable.match(new RegExp(`\\b${identifier}\\s*\\(`, "gu"))?.length ?? 0;
        if (filename === INSTALLED_PI_COMPOSITION_OWNER) {
          if (calls > 1) {
            violations.push(
              `${filename}: ${identifier} must be called at most once, found ${calls}`,
            );
          }
        } else if (calls > 0) {
          violations.push(
            `${filename}: only ${INSTALLED_PI_COMPOSITION_OWNER} may call ${identifier}`,
          );
        }
      }
    }

    if (
      !filename.startsWith("apps/web/src/server/") &&
      /\bnew\s+(?:(?:window|globalThis)\.)?WebSocket\s*\(/u.test(executable)
    ) {
      violations.push(`${filename}: use the installed RuntimeConnection instead of WebSocket`);
    }
    if (
      filename !== RUNTIME_CONNECTION_OWNER &&
      /\b(?:window|globalThis)\.location\.origin\b/u.test(executable)
    ) {
      violations.push(`${filename}: use RuntimeConnection instead of location.origin`);
    }
  }
  return [...new Set(violations)].sort();
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
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(filename)));
    else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !/\.(?:bench|spec|test)\.[^.]+$/u.test(entry.name)
    ) {
      files.push(filename);
    }
  }
  return files;
}

export async function runtimeHostOwnershipViolations(repositoryRoot = REPOSITORY_ROOT) {
  const filenames = (
    await Promise.all(SOURCE_ROOTS.map((root) => sourceFiles(path.join(repositoryRoot, root))))
  ).flat();
  return runtimeBoundaryViolations(
    new Map(
      await Promise.all(
        [...new Set(filenames)].map(async (filename) => [
          path.relative(repositoryRoot, filename).split(path.sep).join("/"),
          await readFile(filename, "utf8"),
        ]),
      ),
    ),
  );
}

export async function checkRuntimeHostOwnership(repositoryRoot = REPOSITORY_ROOT) {
  const violations = await runtimeHostOwnershipViolations(repositoryRoot);
  if (violations.length > 0) {
    throw new Error(
      `Runtime boundary violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
    );
  }
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await checkRuntimeHostOwnership();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
