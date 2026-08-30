import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT_URL = new URL("../", import.meta.url);
const RETRYABLE_RESOLUTION_ERRORS = new Set(["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"]);
const repositoryRequire = createRequire(import.meta.url);
const tsxRequire = createRequire(repositoryRequire.resolve("tsx/package.json"));
const { transformSync } = tsxRequire("esbuild");

// These are legitimate client dependencies of components exercised by integration tests. Keep
// this list narrow: in particular, do not alias next/navigation, so a Host leaking into the pure
// Extension authoring graph remains a hard Node loading failure.
const NODE_TEST_SPECIFIER_ALIASES = new Map([
  ["next/dynamic", pathToFileURL(repositoryRequire.resolve("next/dynamic.js")).href],
  ["next/image", pathToFileURL(repositoryRequire.resolve("next/image")).href],
]);

function splitSpecifierSuffix(specifier) {
  const suffixIndex = specifier.search(/[?#]/);
  if (suffixIndex === -1) return { path: specifier, suffix: "" };
  return {
    path: specifier.slice(0, suffixIndex),
    suffix: specifier.slice(suffixIndex),
  };
}

function resolutionCandidates(specifier) {
  const nodeTestAlias = NODE_TEST_SPECIFIER_ALIASES.get(specifier);
  if (nodeTestAlias) return [nodeTestAlias];

  const isAlias = specifier.startsWith("@/");
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!isAlias && !isRelative) return [specifier];

  const mappedSpecifier = isAlias
    ? new URL(specifier.slice(2), REPOSITORY_ROOT_URL).href
    : specifier;
  const { path, suffix } = splitSpecifierSuffix(mappedSpecifier);
  const hasExtension = /\.[^/]+$/.test(path);
  if (hasExtension) return [mappedSpecifier];

  return [
    mappedSpecifier,
    `${path}.ts${suffix}`,
    `${path}.tsx${suffix}`,
    `${path}/index.ts${suffix}`,
    `${path}/index.tsx${suffix}`,
  ];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let lastError;
    for (const candidate of resolutionCandidates(specifier)) {
      try {
        return nextResolve(candidate, context);
      } catch (error) {
        if (!RETRYABLE_RESOLUTION_ERRORS.has(error?.code)) throw error;
        lastError = error;
      }
    }

    throw lastError;
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && new URL(url).pathname.endsWith(".svg")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify({ src: url, height: 0, width: 0 })};`,
      };
    }

    if (!url.startsWith("file:") || !new URL(url).pathname.endsWith(".tsx")) {
      return nextLoad(url, context);
    }

    const filename = fileURLToPath(url);
    const transformed = transformSync(readFileSync(filename, "utf8"), {
      format: "esm",
      jsx: "automatic",
      loader: "tsx",
      sourcefile: filename,
      sourcemap: "inline",
      target: "node24",
    });
    return {
      format: "module",
      shortCircuit: true,
      source: transformed.code,
    };
  },
});
