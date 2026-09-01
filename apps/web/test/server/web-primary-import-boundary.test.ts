import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SERVER_ROOT = path.join(WEB_ROOT, "src", "server");
const PRIMARY_ENTRY = path.join(SERVER_ROOT, "web-artifact-main.ts");
const EXPECTED_LOCAL_CLOSURE = Object.freeze([
  "next-web-handler.ts",
  "web-application-host.ts",
  "web-artifact-cli.ts",
  "web-artifact-layout.ts",
  "web-artifact-main.ts",
  "web-control-stdout.ts",
  "web-host-process.ts",
  "web-only-host.ts",
]);
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  "next",
  "node:fs/promises",
  "node:http",
  "node:net",
  "node:path",
  "node:stream",
  "node:url",
  "@workbench/host-contracts/web-artifact-manifest",
  "@workbench/host-contracts/web-host-control",
  "@workbench/host-contracts/runtime-connection",
  "@workbench/host-server/runtime-sidecar-proxy",
  "@workbench/host-server/web-host-control-session",
  "@workbench/host-server/web-artifact",
  "@workbench/host-server/workbench-http-server",
]);

async function importSpecifiers(filename: string): Promise<readonly string[]> {
  const source = await readFile(filename, "utf8");
  const tokens: Array<{
    readonly type: "identifier" | "punctuation" | "string";
    readonly value: string;
  }> = [];
  const expression =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\S/gu;
  for (const match of source.matchAll(expression)) {
    const value = match[0]!;
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    if (value[0] === '"' || value[0] === "'") {
      tokens.push({ type: "string", value: value.slice(1, -1) });
    } else if (/^[A-Za-z_$]/u.test(value)) {
      tokens.push({ type: "identifier", value });
    } else {
      tokens.push({ type: "punctuation", value });
    }
  }

  const specifiers: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type !== "identifier") continue;
    if (
      token.value === "import" &&
      tokens[index + 1]?.value === "(" &&
      tokens[index + 2]?.type === "string"
    ) {
      specifiers.push(tokens[index + 2]!.value);
      continue;
    }
    if (token.value !== "import" && token.value !== "export") continue;
    if (token.value === "import" && tokens[index + 1]?.type === "string") {
      specifiers.push(tokens[index + 1]!.value);
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor]?.value === ";") break;
      if (tokens[cursor]?.value === "from" && tokens[cursor + 1]?.type === "string") {
        specifiers.push(tokens[cursor + 1]!.value);
        break;
      }
    }
  }
  return specifiers;
}

test("the primary Web artifact graph has one exact Web/Next closure and no Runtime owner", async () => {
  const pending = [PRIMARY_ENTRY];
  const visited = new Set<string>();
  const external = new Set<string>();

  while (pending.length > 0) {
    const filename = pending.pop()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    for (const specifier of await importSpecifiers(filename)) {
      if (!specifier.startsWith(".")) {
        external.add(specifier);
        continue;
      }
      const resolved = path.resolve(path.dirname(filename), `${specifier}.ts`);
      assert.equal(
        resolved.startsWith(`${SERVER_ROOT}${path.sep}`),
        true,
        `primary entry escaped its Web server owner through ${specifier}`,
      );
      pending.push(resolved);
    }
  }

  assert.deepEqual(
    [...visited].map((filename) => path.relative(SERVER_ROOT, filename)).sort(),
    EXPECTED_LOCAL_CLOSURE,
  );
  assert.deepEqual(
    [...external].filter((specifier) => !ALLOWED_EXTERNAL_IMPORTS.has(specifier)).sort(),
    [],
  );
  for (const forbidden of [
    "migration-workbench-supervisor.ts",
    "runtime-api-route-delegator.ts",
    "runtime-sidecar-child.ts",
  ]) {
    assert.equal(visited.has(path.join(SERVER_ROOT, forbidden)), false, forbidden);
  }
  assert.equal(
    [...external].some(
      (specifier) =>
        specifier.includes("agent-runtime") ||
        specifier.includes("terminal") ||
        specifier.includes("pi-"),
    ),
    false,
  );
});
