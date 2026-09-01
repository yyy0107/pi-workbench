import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const PRODUCTION_ROOTS = [
  "apps/desktop-renderer/src",
  "apps/web/src",
  "packages/agent-runtime/adapters/pi/contributions/src",
  "packages/workbench/shell/src",
];
const NODE_MODULE_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier}`]),
);
const SHELL_SOURCE_DIRECTORY = "packages/workbench/shell/src/";
const SHELL_LEGACY_PI_COMPATIBILITY_FILE = "packages/workbench/shell/src/legacy-pi-compat.ts";
const SHELL_SDK_DESCRIPTOR_RUNTIME_FILE = "packages/workbench/shell/src/i18n/runtime.ts";
const SHELL_EXTENSION_HOST_ROOT_HOOKS = new Set([
  "useCommandService",
  "useComposerCommandRegistry",
  "useExtensionErrorReporter",
  "useMainViewService",
  "usePanelRegistry",
  "usePanelService",
  "useSettingsRegistry",
]);
const SHELL_EXTENSION_HOST_CAPABILITIES = new Set([
  "@workbench/extension-host/command-palette",
  "@workbench/extension-host/hosts/extension-error-boundary",
  "@workbench/extension-host/hosts/main-view-sidebar-host",
  "@workbench/extension-host/hosts/panel-host",
  "@workbench/extension-host/hosts/renderer-host",
  "@workbench/extension-host/hosts/slot-host",
  "@workbench/extension-host/i18n/en-US",
  "@workbench/extension-host/i18n/zh-CN",
  "@workbench/extension-host/installation",
  "@workbench/extension-host/services",
]);

const PI_CONTRIBUTIONS_SOURCE_DIRECTORY = "packages/agent-runtime/adapters/pi/contributions/src/";
const PI_CLIENT_COMPOSITION_ALLOWLIST = new Set([
  "apps/desktop-renderer/src/desktop/desktop-workbench.tsx",
  "apps/web/src/workbench/providers/installed-agent-runtime.tsx",
]);
const INSTALLED_WORKBENCH_SETTINGS_COMPOSITION_ROOTS = new Set([
  "apps/desktop-renderer/src/desktop/desktop-workbench.tsx",
  "apps/web/src/workbench/providers/installed-workbench-settings.ts",
]);
const PI_WORKBENCH_SETTINGS_SPECIFIER = "@workbench/agent-runtime-pi-client/workbench-settings";

/* The Workbench-owned connection composition root is the sole production location allowed to
 * snapshot window.location.origin. Navigation (pathname/assign) and static assets remain valid.
 */
const RUNTIME_CONNECTION_COMPOSITION_ROOT =
  "packages/workbench/shell/src/runtime-connection/runtime-connection.ts";

function isProductionSource(filename) {
  if (!SOURCE_EXTENSIONS.has(path.extname(filename))) return false;
  return !/\.(?:bench|spec|test)\.[^.]+$/u.test(filename);
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
    else if (entry.isFile() && isProductionSource(filename)) files.push(filename);
  }
  return files;
}

function withoutCommentsAndStrings(source) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu,
    (match) => {
      if (match.startsWith('"') || match.startsWith("'")) return '""';
      if (match.startsWith("`")) {
        return [...match.matchAll(/\$\{([\s\S]*?)\}/gu)]
          .map((expression) => expression[1])
          .join(" ");
      }
      return "";
    },
  );
}

function sourceTokens(source) {
  const tokens = [];
  const expression =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\S/gu;
  for (const match of source.matchAll(expression)) {
    const value = match[0];
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    if (value[0] === '"' || value[0] === "'" || value[0] === "`") {
      tokens.push({ type: "string", value: value.slice(1, -1) });
    } else if (/^[A-Za-z_$]/u.test(value)) {
      tokens.push({ type: "identifier", value });
    } else {
      tokens.push({ type: "punctuation", value });
    }
  }
  return tokens;
}

function moduleReferences(source) {
  const tokens = sourceTokens(source);
  const references = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "require" && tokens[index + 1]?.value === "(") {
      if (tokens[index + 2]?.type === "string") {
        references.push({ kind: "require", specifier: tokens[index + 2].value, clause: [] });
      }
      continue;
    }
    if (token.value === "import" && tokens[index + 1]?.value === "(") {
      if (tokens[index + 2]?.type === "string") {
        references.push({ kind: "dynamic import", specifier: tokens[index + 2].value, clause: [] });
      }
      continue;
    }
    if (token.value !== "import" && token.value !== "export") continue;
    if (token.value === "import" && tokens[index + 1]?.type === "string") {
      references.push({ kind: "import", specifier: tokens[index + 1].value, clause: [] });
      continue;
    }

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].value !== "from" || tokens[cursor + 1]?.type !== "string") continue;
      references.push({
        kind: token.value,
        specifier: tokens[cursor + 1].value,
        clause: tokens.slice(index + 1, cursor),
      });
      break;
    }
  }
  return references;
}

function namedClauseValuesAreAllowed(item, allowsValue) {
  if (item.clause[0]?.value === "type") return item.kind === "import" || item.kind === "export";
  if (item.clause[0]?.value !== "{" || item.clause.at(-1)?.value !== "}") return false;
  for (let index = 1; index < item.clause.length - 1;) {
    if (item.clause[index]?.value === ",") {
      index += 1;
      continue;
    }
    const isType = item.clause[index]?.value === "type";
    const importedName = item.clause[index + Number(isType)];
    if (importedName?.type !== "identifier") return false;
    if (!isType && !allowsValue(importedName.value)) return false;
    index += Number(isType) + 1;
    if (item.clause[index]?.value === "as") {
      if (item.clause[index + 1]?.type !== "identifier") return false;
      index += 2;
    }
    if (item.clause[index]?.value !== "," && index !== item.clause.length - 1) return false;
  }
  return true;
}

function namedClauseNamesAreAllowed(item, allowsName) {
  if (item.clause[0]?.value === "type") return false;
  if (item.clause[0]?.value !== "{" || item.clause.at(-1)?.value !== "}") return false;
  for (let index = 1; index < item.clause.length - 1;) {
    if (item.clause[index]?.value === ",") {
      index += 1;
      continue;
    }
    const isType = item.clause[index]?.value === "type";
    const importedName = item.clause[index + Number(isType)];
    if (importedName?.type !== "identifier" || !allowsName(importedName.value)) return false;
    index += Number(isType) + 1;
    if (item.clause[index]?.value === "as") {
      if (item.clause[index + 1]?.type !== "identifier") return false;
      index += 2;
    }
    if (item.clause[index]?.value !== "," && index !== item.clause.length - 1) return false;
  }
  return true;
}

function piClientImportIsAllowed(relativeFilename) {
  return (
    relativeFilename.startsWith(PI_CONTRIBUTIONS_SOURCE_DIRECTORY) ||
    PI_CLIENT_COMPOSITION_ALLOWLIST.has(relativeFilename)
  );
}

function isPiClientSpecifier(specifier) {
  return (
    specifier === "@workbench/agent-runtime-pi-client" ||
    specifier.startsWith("@workbench/agent-runtime-pi-client/")
  );
}

function isPiProtocolOrSharedSpecifier(specifier) {
  return (
    specifier === "@workbench/agent-runtime-pi-protocol" ||
    specifier.startsWith("@workbench/agent-runtime-pi-protocol/") ||
    specifier === "@workbench/agent-runtime-pi-shared" ||
    specifier.startsWith("@workbench/agent-runtime-pi-shared/")
  );
}

function isPiServerSpecifier(specifier) {
  return (
    specifier === "@workbench/agent-runtime-pi-server" ||
    specifier.startsWith("@workbench/agent-runtime-pi-server/")
  );
}

function piContributionOwnerViolations(relativeFilename, source) {
  if (!relativeFilename.startsWith(PI_CONTRIBUTIONS_SOURCE_DIRECTORY)) return [];

  const violations = [];
  for (const { specifier } of moduleReferences(source)) {
    if (specifier.startsWith("@/")) {
      violations.push(
        `${relativeFilename}: Pi contributions must not import the root alias (${specifier})`,
      );
    }
    if (specifier === "next" || specifier.startsWith("next/")) {
      violations.push(
        `${relativeFilename}: Pi contributions must not import Next.js (${specifier})`,
      );
    }
    if (
      specifier === "@workbench/extension-host/internal" ||
      specifier.startsWith("@workbench/extension-sdk/internal")
    ) {
      violations.push(
        `${relativeFilename}: Pi contributions must use Extension Platform public APIs (${specifier})`,
      );
    }
    if (isPiServerSpecifier(specifier)) {
      violations.push(
        `${relativeFilename}: Pi contributions must not import the Pi server (${specifier})`,
      );
    }
    if (specifier.startsWith("@earendil-works/pi")) {
      violations.push(
        `${relativeFilename}: Pi contributions must use the Pi client seam (${specifier})`,
      );
    }
  }
  return violations;
}

function isInstalledWorkbenchSettingsCompositionImport(relativeFilename, item) {
  if (
    !INSTALLED_WORKBENCH_SETTINGS_COMPOSITION_ROOTS.has(relativeFilename) ||
    item.specifier !== PI_WORKBENCH_SETTINGS_SPECIFIER ||
    item.kind !== "import"
  ) {
    return false;
  }
  return namedClauseValuesAreAllowed(item, (name) => name === "createPiWorkbenchSettingsClient");
}

function isAllowedShellExtensionHostImport(item) {
  if (SHELL_EXTENSION_HOST_CAPABILITIES.has(item.specifier)) return true;
  return (
    item.specifier === "@workbench/extension-host" &&
    item.kind === "import" &&
    namedClauseNamesAreAllowed(item, (name) => SHELL_EXTENSION_HOST_ROOT_HOOKS.has(name))
  );
}

function isAllowedShellSdkInternalImport(relativeFilename, item) {
  return (
    relativeFilename === SHELL_SDK_DESCRIPTOR_RUNTIME_FILE &&
    item.specifier === "@workbench/extension-sdk/internal" &&
    item.kind === "import" &&
    namedClauseNamesAreAllowed(item, (name) => name === "createLocalizableMessageDescriptor")
  );
}

function isGenericAgentRuntimeSpecifier(specifier) {
  return (
    specifier === "@workbench/agent-runtime-client" ||
    specifier.startsWith("@workbench/agent-runtime-client/") ||
    specifier === "@workbench/agent-runtime-contracts" ||
    specifier.startsWith("@workbench/agent-runtime-contracts/")
  );
}

function shellPiLexicalViolations(relativeFilename, source) {
  if (relativeFilename === SHELL_LEGACY_PI_COMPATIBILITY_FILE) return [];
  const hasProductMarker = sourceTokens(source).some((token) =>
    token.type === "identifier"
      ? /^(?:Pi[A-Z_]|pi[A-Z_]|PI_)/u.test(token.value)
      : !token.value.includes("legacy-pi-compat") &&
        /(?:^|[/@:.-])pi(?:[/@: .-]|$)|piWorkingOrb|pi_response_error|\bPi\b/u.test(token.value),
  );
  return hasProductMarker
    ? [`${relativeFilename}: Shell Pi compatibility literals belong only in legacy-pi-compat.ts`]
    : [];
}

function shellOwnerViolations(relativeFilename, source) {
  if (!relativeFilename.startsWith(SHELL_SOURCE_DIRECTORY)) return [];

  const violations = [];
  for (const item of moduleReferences(source)) {
    const { specifier } = item;
    if (
      (specifier.startsWith("@workbench/extension-sdk/") &&
        !isAllowedShellSdkInternalImport(relativeFilename, item)) ||
      (specifier.startsWith("@workbench/extension-host") &&
        !isAllowedShellExtensionHostImport(item))
    ) {
      violations.push(
        `${relativeFilename}: Shell must use finite Extension Platform public capabilities (${specifier})`,
      );
    }
    if (specifier.startsWith("@/")) {
      violations.push(`${relativeFilename}: Shell must not import the root alias (${specifier})`);
    }
    if (
      specifier.startsWith("@workbench/agent-runtime-") &&
      !isGenericAgentRuntimeSpecifier(specifier) &&
      !specifier.startsWith("@workbench/agent-runtime-pi")
    ) {
      violations.push(
        `${relativeFilename}: Shell must not import Agent Runtime implementations (${specifier})`,
      );
    }
    if (
      specifier === "i18next" ||
      specifier.startsWith("i18next/") ||
      specifier === "react-i18next" ||
      specifier.startsWith("react-i18next/") ||
      specifier === "next-intl" ||
      specifier.startsWith("next-intl/")
    ) {
      violations.push(
        `${relativeFilename}: Shell must not own product settings or i18n (${specifier})`,
      );
    }
    if (specifier === "next" || specifier.startsWith("next/")) {
      violations.push(`${relativeFilename}: Shell must not import Next.js (${specifier})`);
    }
    if (NODE_MODULE_SPECIFIERS.has(specifier)) {
      violations.push(
        `${relativeFilename}: Shell must not import Node production APIs (${specifier})`,
      );
    }
    if (
      specifier === "node-pty" ||
      specifier === "tree-sitter" ||
      specifier === "tree-sitter-bash"
    ) {
      violations.push(`${relativeFilename}: Shell must not import native packages (${specifier})`);
    }
    if (
      specifier.startsWith("@earendil-works/pi") ||
      specifier.startsWith("@workbench/agent-runtime-pi")
    ) {
      violations.push(`${relativeFilename}: Shell must not import Pi (${specifier})`);
    }
    if (
      specifier === "electron" ||
      specifier.startsWith("electron/") ||
      specifier.startsWith("@electron/")
    ) {
      violations.push(`${relativeFilename}: Shell must not import Electron (${specifier})`);
    }
    if (specifier === "tauri" || specifier.startsWith("@tauri-apps/")) {
      violations.push(`${relativeFilename}: Shell must not import Tauri (${specifier})`);
    }
  }
  if (sourceTokens(source).some((token) => /\/api(?:\/|$)/u.test(token.value))) {
    violations.push(`${relativeFilename}: Shell must not hardcode product endpoints`);
  }
  violations.push(...shellPiLexicalViolations(relativeFilename, source));
  return violations;
}

export async function transportBoundaryViolations(repositoryRoot = REPOSITORY_ROOT) {
  const violations = [];
  const filenames = (
    await Promise.all(
      PRODUCTION_ROOTS.map((directory) => sourceFiles(path.join(repositoryRoot, directory))),
    )
  ).flat();

  for (const filename of filenames.sort()) {
    const relativeFilename = path.relative(repositoryRoot, filename).split(path.sep).join("/");
    // Runtime server code authenticates/owns raw sockets; this guard protects browser consumers.
    if (relativeFilename.startsWith("apps/web/src/server/")) continue;

    const source = await readFile(filename, "utf8");
    const executable = withoutCommentsAndStrings(source);
    violations.push(...shellOwnerViolations(relativeFilename, source));
    violations.push(...piContributionOwnerViolations(relativeFilename, source));
    if (/\bnew\s+(?:(?:window|globalThis)\.)?WebSocket\s*\(/u.test(executable)) {
      violations.push(
        `${relativeFilename}: do not construct WebSocket directly; use @workbench/host-client through the installed RuntimeConnection`,
      );
    }

    if (
      relativeFilename !== RUNTIME_CONNECTION_COMPOSITION_ROOT &&
      /\b(?:window|globalThis)\.location\.origin\b/u.test(executable)
    ) {
      violations.push(
        `${relativeFilename}: do not derive a Runtime endpoint from location.origin; use RuntimeConnection`,
      );
    }

    if (
      sourceTokens(source).some((token) =>
        /[/]api[/]workspace\.files\.content\b/u.test(token.value),
      )
    ) {
      violations.push(
        `${relativeFilename}: do not pass the raw workspace.files.content endpoint into a Surface; use the installation-scoped Pi workspace client`,
      );
    }

    for (const item of moduleReferences(source)) {
      if (
        isPiClientSpecifier(item.specifier) &&
        !piClientImportIsAllowed(relativeFilename) &&
        !isInstalledWorkbenchSettingsCompositionImport(relativeFilename, item)
      ) {
        violations.push(
          `${relativeFilename}: do not consume standalone Pi client helper ${item.specifier}; use a context-bound usePi*Client facade`,
        );
      }
      if (
        isPiProtocolOrSharedSpecifier(item.specifier) &&
        !relativeFilename.startsWith(PI_CONTRIBUTIONS_SOURCE_DIRECTORY)
      ) {
        violations.push(
          `${relativeFilename}: Pi protocol/shared imports belong in the Pi contribution leaf (${item.specifier})`,
        );
      }
    }
  }
  return [...new Set(violations)].sort();
}

export async function checkTransportBoundaries(repositoryRoot = REPOSITORY_ROOT) {
  const violations = await transportBoundaryViolations(repositoryRoot);
  if (violations.length === 0) return;
  throw new Error(
    `Runtime transport boundary violations:\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
  );
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await checkTransportBoundaries();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
