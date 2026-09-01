import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

/**
 * Runtime application composition is intentionally the sole caller of these factory/accessor
 * APIs. Leaf packages may define their own factories, so this guard scans only application
 * production source, never package implementation source.
 */
export const INSTALLED_PI_COMPOSITION_OWNER =
  "apps/runtime-node/src/composition/installed-pi-server.ts";
const SINGLETON_COMPOSITION_IDENTIFIERS = new Set([
  "createDefaultPiRpcRouteGroups",
  "createPiAgentServerInstallation",
  "createPiRpcRouter",
  "createPiRuntimeApiRouter",
  "createPiRuntimeHttpRouter",
  "createStreamHub",
  "getInteractiveResponseRegistry",
  "getStreamHub",
  "InteractiveResponseRegistry",
]);
const ROOT_COMPOSITION_DIRECTORIES = [
  "apps/desktop-electron/scripts",
  "apps/desktop-electron/src",
  "apps/web/src",
  "runtime",
  "apps/runtime-node/scripts",
  "apps/runtime-node/src",
];
const ALLOWED_NONLITERAL_MODULE_REFERENCES = new Map([
  [
    "apps/desktop-electron/scripts/native-runtime-smoke.cjs",
    'require:path.join(nodePtyRoot,"lib","utils.js")',
  ],
  ["apps/desktop-electron/src/packaged-runtime-lifecycle.cjs", "require:supportPath"],
]);

function resolvedComputedReference(relativeFilename, reference) {
  if (reference.loaderBase === "unknown") return undefined;
  const anchor = path.resolve(path.parse(process.cwd()).root, "__workbench_repository__");
  const sourceDirectory = path.join(anchor, path.dirname(relativeFilename));
  const absolute = path[reference.computedPathMethod](
    sourceDirectory,
    ...reference.computedRelativeSegments,
  );
  const relative = path.relative(anchor, absolute);
  return normalized(
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
      ? relative
      : absolute,
  );
}

export function runtimeApplicationBoundaryViolations(files) {
  const violations = [];
  const runtimePrefix = "apps/runtime-node/";
  for (const [relativeFilename, source] of files) {
    let allowedNonliteralCount = 0;
    for (const reference of moduleReferences(source)) {
      if (reference.literal === false) {
        const signature = `${reference.kind}:${reference.argumentSignature}`;
        if (ALLOWED_NONLITERAL_MODULE_REFERENCES.get(relativeFilename) === signature) {
          allowedNonliteralCount += 1;
        } else {
          violations.push(
            `${relativeFilename}: non-literal module reference is not an exact audited exception (${signature})`,
          );
        }
        continue;
      }
      const resolvedRelativeSpecifier = reference.computedRelativeSegments
        ? resolvedComputedReference(relativeFilename, reference)
        : reference.specifier.startsWith(".") && reference.loaderBase !== "unknown"
          ? normalized(
              path.normalize(path.join(path.dirname(relativeFilename), reference.specifier)),
            )
          : undefined;
      if (!relativeFilename.startsWith(runtimePrefix)) {
        if (
          reference.specifier === "@workbench/runtime-node" ||
          reference.specifier.includes("apps/runtime-node") ||
          /(?:^|\/)(?:apps\/)?runtime-node(?:\/|$)/u.test(reference.specifier) ||
          resolvedRelativeSpecifier?.startsWith(runtimePrefix)
        ) {
          violations.push(
            `${relativeFilename}: Application/supervisor source must not import the Runtime application graph (${reference.specifier})`,
          );
        }
        continue;
      }
      if (resolvedRelativeSpecifier && !resolvedRelativeSpecifier.startsWith(runtimePrefix)) {
        violations.push(
          `${relativeFilename}: Runtime application source must not import another application source (${reference.specifier})`,
        );
      } else if (
        reference.loaderBase === "unknown" &&
        /(?:^|\/)(?:apps\/)?(?:desktop-electron|web)(?:\/|$)/u.test(reference.specifier)
      ) {
        violations.push(
          `${relativeFilename}: Runtime application source must not import another application source (${reference.specifier})`,
        );
      }
    }
    const allowedSignature = ALLOWED_NONLITERAL_MODULE_REFERENCES.get(relativeFilename);
    if (allowedSignature && allowedNonliteralCount !== 1) {
      violations.push(
        `${relativeFilename}: audited non-literal module reference ${allowedSignature} must appear exactly once; found ${allowedNonliteralCount}`,
      );
    }
  }
  return violations;
}

function computedDirnamePath(tokens, start) {
  if (
    tokens[start]?.value !== "path" ||
    tokens[start + 1]?.value !== "." ||
    !["join", "resolve"].includes(tokens[start + 2]?.value) ||
    tokens[start + 3]?.value !== "(" ||
    tokens[start + 4]?.value !== "__dirname"
  ) {
    return undefined;
  }
  const segments = [];
  let cursor = start + 5;
  while (tokens[cursor]?.value === "," && tokens[cursor + 1]?.type === "string") {
    segments.push(tokens[cursor + 1].value);
    cursor += 2;
  }
  if (segments.length === 0 || tokens[cursor]?.value !== ")") return undefined;
  return Object.freeze({ method: tokens[start + 2].value, segments: Object.freeze(segments) });
}

function callArgumentSignature(tokens, start) {
  const values = [];
  let depth = 1;
  for (let cursor = start; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === "(") depth += 1;
    if (token.value === ")") {
      depth -= 1;
      if (depth === 0) return values.join("");
    }
    values.push(token.type === "string" ? JSON.stringify(token.value) : token.value);
  }
  return "<unterminated>";
}

function normalized(filename) {
  return filename.split(path.sep).join("/");
}

function sourceTokens(source) {
  const tokens = [];
  const expression =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\S/gu;
  for (const match of source.matchAll(expression)) {
    const value = match[0];
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    if (value[0] === '"' || value[0] === "'") {
      tokens.push({ type: "string", value: value.slice(1, -1) });
    } else if (value[0] === "`") {
      tokens.push({ type: "template", value: value.slice(1, -1) });
    } else if (/^[A-Za-z_$]/u.test(value)) {
      tokens.push({ type: "identifier", value });
    } else {
      tokens.push({ type: "punctuation", value });
    }
  }
  return tokens;
}

function matchingDelimiter(tokens, openingIndex) {
  const closingForOpening = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]);
  const expected = [];
  for (let index = openingIndex; index < tokens.length; index += 1) {
    const closing = closingForOpening.get(tokens[index].value);
    if (closing) {
      expected.push(closing);
      continue;
    }
    if (tokens[index].value !== expected.at(-1)) continue;
    expected.pop();
    if (expected.length === 0) return index;
  }
  return undefined;
}

function statementEnd(tokens, start) {
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === ";") return index;
  }
  return tokens.length;
}

function namedBindingEntries(tokens, opening, closing) {
  const bindings = [];
  let index = opening + 1;
  while (index < closing) {
    if (tokens[index].value === "," || tokens[index].value === "type") {
      index += 1;
      continue;
    }
    const imported = tokens[index];
    if (imported?.type !== "identifier") {
      index += 1;
      continue;
    }
    index += 1;
    let local = imported.value;
    if (["as", ":"].includes(tokens[index]?.value) && tokens[index + 1]?.type === "identifier") {
      local = tokens[index + 1].value;
      index += 2;
    }
    bindings.push(Object.freeze({ imported: imported.value, local }));
    while (index < closing && tokens[index].value !== ",") index += 1;
  }
  return bindings;
}

function moduleCallReference(tokens, opening, kind, loaderBase) {
  const computed = computedDirnamePath(tokens, opening + 1);
  return {
    kind,
    loaderBase,
    ...(computed
      ? {
          computedPathMethod: computed.method,
          computedRelativeSegments: computed.segments,
          literal: true,
          specifier: `path.${computed.method}(__dirname, ${computed.segments.map((segment) => JSON.stringify(segment)).join(", ")})`,
        }
      : {
          argumentSignature: callArgumentSignature(tokens, opening + 1),
          literal: tokens[opening + 1]?.type === "string",
          specifier:
            tokens[opening + 1]?.type === "string" ? tokens[opening + 1].value : "<non-literal>",
        }),
  };
}

function createRequireBase(tokens, opening, closing, isUnboundIdentifier) {
  const argument = tokens.slice(opening + 1, closing).map((token) => token.value);
  if (
    (argument.length === 1 &&
      argument[0] === "__filename" &&
      isUnboundIdentifier(opening + 1, "__filename")) ||
    JSON.stringify(argument) === JSON.stringify(["import", ".", "meta", ".", "url"])
  ) {
    return "source";
  }
  return "unknown";
}

/**
 * Covers static import/export, dynamic import, CommonJS require, createRequire-derived loaders,
 * and module.require aliases without matching comments or unrelated shadowed functions.
 */
export function moduleReferences(source) {
  const tokens = sourceTokens(source);
  const references = [];
  let nextScopeId = 0;
  const rootScope = {
    bindings: new Map(),
    end: tokens.length,
    id: nextScopeId++,
    start: 0,
  };
  const scopes = [rootScope];

  // Every brace-delimited region is a conservative lexical scope. Object/destructuring braces
  // introduce harmless extra regions; declarations are registered against their declaration
  // token, so those extra regions cannot turn an unrelated local into a trusted loader.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "{") continue;
    const closing = matchingDelimiter(tokens, index);
    if (closing === undefined) continue;
    const scope = {
      bindings: new Map(),
      end: closing,
      id: nextScopeId++,
      start: index + 1,
    };
    scopes.push(scope);
  }

  function containingScopes(index) {
    return scopes
      .filter((scope) => scope.start <= index && index < scope.end)
      .sort((left, right) => {
        const span = left.end - left.start - (right.end - right.start);
        return span === 0 ? right.id - left.id : span;
      });
  }

  function declarationScope(index, kind) {
    if (kind === "var") {
      const functionScope = containingScopes(index).find((scope) => scope.functionScope === true);
      if (functionScope) return functionScope;
    }
    return containingScopes(index)[0] ?? rootScope;
  }

  function declare(scope, name) {
    let binding = scope.bindings.get(name);
    if (!binding) {
      binding = { name, values: new Set() };
      scope.bindings.set(name, binding);
    }
    return binding;
  }

  function resolveBinding(index, name) {
    for (const scope of containingScopes(index)) {
      const binding = scope.bindings.get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  function isUnboundIdentifier(index, name) {
    return tokens[index]?.value === name && resolveBinding(index, name) === undefined;
  }

  function topLevelSegments(start, end) {
    const segments = [];
    let segmentStart = start;
    const closings = [];
    const closingForOpening = new Map([
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ]);
    for (let index = start; index < end; index += 1) {
      const value = tokens[index].value;
      const closing = closingForOpening.get(value);
      if (closing) closings.push(closing);
      else if (closings.at(-1) === value) closings.pop();
      else if (closings.length === 0 && value === ",") {
        segments.push([segmentStart, index]);
        segmentStart = index + 1;
      }
    }
    segments.push([segmentStart, end]);
    return segments;
  }

  function topLevelToken(start, end, value) {
    const closings = [];
    const closingForOpening = new Map([
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ]);
    for (let index = start; index < end; index += 1) {
      const current = tokens[index].value;
      const closing = closingForOpening.get(current);
      if (closing) {
        closings.push(closing);
        continue;
      }
      if (closings.at(-1) === current) {
        closings.pop();
        continue;
      }
      if (closings.length === 0 && current === value) return index;
    }
    return undefined;
  }

  function bindingEntries(start, end, projection) {
    if (
      tokens[start]?.value === "." &&
      tokens[start + 1]?.value === "." &&
      tokens[start + 2]?.value === "."
    ) {
      start += 3;
    }
    if (tokens[start]?.type === "identifier") {
      return [{ name: tokens[start].value, projection }];
    }
    if (!["{", "["].includes(tokens[start]?.value)) return [];
    const closing = matchingDelimiter(tokens, start);
    if (closing === undefined || closing >= end) return [];
    const entries = [];
    for (const [rawStart, rawEnd] of topLevelSegments(start + 1, closing)) {
      let entryStart = rawStart;
      if (
        tokens[entryStart]?.value === "." &&
        tokens[entryStart + 1]?.value === "." &&
        tokens[entryStart + 2]?.value === "."
      ) {
        entryStart += 3;
      }
      if (entryStart >= rawEnd) continue;
      if (tokens[start].value === "[") {
        entries.push(...bindingEntries(entryStart, rawEnd, undefined));
        continue;
      }
      const colon = topLevelToken(entryStart, rawEnd, ":");
      if (colon !== undefined) {
        const property = tokens[entryStart]?.value;
        entries.push(...bindingEntries(colon + 1, rawEnd, property));
      } else if (tokens[entryStart]?.type === "identifier") {
        entries.push({ name: tokens[entryStart].value, projection: tokens[entryStart].value });
      }
    }
    return entries;
  }

  function parameterBindings(opening, closing, scope) {
    for (const [start, end] of topLevelSegments(opening + 1, closing)) {
      const equals = topLevelToken(start, end, "=");
      const colon = topLevelToken(start, equals ?? end, ":");
      const patternEnd = Math.min(colon ?? end, equals ?? end);
      for (const { name } of bindingEntries(start, patternEnd, undefined)) declare(scope, name);
    }
  }

  function conciseArrowEnd(start) {
    const closings = [];
    const closingForOpening = new Map([
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ]);
    for (let index = start; index < tokens.length; index += 1) {
      const value = tokens[index].value;
      const closing = closingForOpening.get(value);
      if (closing) closings.push(closing);
      else if (closings.at(-1) === value) closings.pop();
      else if (closings.length === 0 && [",", ";"].includes(value)) return index;
      else if (closings.length === 0 && [")", "]", "}"].includes(value)) return index;
    }
    return tokens.length;
  }

  function implementationBodyAfterSignature(signatureClosing) {
    if (tokens[signatureClosing + 1]?.value === "{") return signatureClosing + 1;
    if (tokens[signatureClosing + 1]?.value !== ":") return undefined;
    for (let cursor = signatureClosing + 2; cursor < tokens.length; cursor += 1) {
      if ([";", "="].includes(tokens[cursor].value)) return undefined;
      if (tokens[cursor].value !== "{") continue;
      const closing = matchingDelimiter(tokens, cursor);
      if (closing === undefined) return undefined;
      if ([">", "&", "|", "]"].includes(tokens[closing + 1]?.value)) {
        cursor = closing;
        continue;
      }
      if (tokens[closing + 1]?.value === "{") return closing + 1;
      return cursor;
    }
    return undefined;
  }

  // Parameter bindings need a scope that starts before the body. This also makes a parameter
  // shadow apply to defaults and to all nested blocks without pretending that a textual name in a
  // type annotation is a value binding.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "function") {
      let opening = index + 1;
      while (opening < tokens.length && tokens[opening].value !== "(") opening += 1;
      const closing = opening < tokens.length ? matchingDelimiter(tokens, opening) : undefined;
      if (closing === undefined) continue;
      const body = implementationBodyAfterSignature(closing);
      const bodyClosing = body === undefined ? undefined : matchingDelimiter(tokens, body);
      if (bodyClosing === undefined) continue;
      const scope = {
        bindings: new Map(),
        end: bodyClosing,
        functionScope: true,
        id: nextScopeId++,
        start: opening + 1,
      };
      scopes.push(scope);
      parameterBindings(opening, closing, scope);
      if (tokens[index + 1]?.type === "identifier" && tokens[index + 2]?.value === "(") {
        declare(scope, tokens[index + 1].value);
      }
      continue;
    }
    if (tokens[index].value !== "=" || tokens[index + 1]?.value !== ">") continue;
    let opening;
    let closing;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if ([";", "{", "}", "="].includes(tokens[cursor].value)) break;
      if (tokens[cursor].value === ")") {
        closing = cursor;
        break;
      }
    }
    if (closing !== undefined) {
      for (let cursor = closing - 1, depth = 1; cursor >= 0; cursor -= 1) {
        if (tokens[cursor].value === ")") depth += 1;
        if (tokens[cursor].value === "(") depth -= 1;
        if (depth === 0) {
          opening = cursor;
          break;
        }
      }
    }
    const body = index + 2;
    const bodyClosing =
      tokens[body]?.value === "{" ? matchingDelimiter(tokens, body) : conciseArrowEnd(body);
    if (bodyClosing === undefined) continue;
    const scope = {
      bindings: new Map(),
      end: bodyClosing,
      functionScope: true,
      id: nextScopeId++,
      start: opening === undefined ? index - 1 : opening + 1,
    };
    scopes.push(scope);
    if (opening !== undefined && closing !== undefined) parameterBindings(opening, closing, scope);
    else if (tokens[index - 1]?.type === "identifier") declare(scope, tokens[index - 1].value);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "catch" && tokens[index + 1]?.value === "(") {
      const closing = matchingDelimiter(tokens, index + 1);
      let body = closing === undefined ? undefined : closing + 1;
      while (body !== undefined && body < tokens.length && tokens[body].value !== "{") body += 1;
      const bodyClosing = body === undefined ? undefined : matchingDelimiter(tokens, body);
      if (closing !== undefined && bodyClosing !== undefined) {
        const scope = {
          bindings: new Map(),
          end: bodyClosing,
          id: nextScopeId++,
          start: index + 2,
        };
        scopes.push(scope);
        parameterBindings(index + 1, closing, scope);
      }
    }
  }

  // Object/class methods are function scopes too even though their grammar has no `function`
  // keyword. Control-flow parentheses are excluded explicitly; a remaining `name(...) {` shape
  // is the closed JavaScript method form this loader analysis needs to distinguish.
  const controlFlowHeads = new Set(["catch", "for", "if", "switch", "while", "with"]);
  for (let opening = 0; opening < tokens.length; opening += 1) {
    if (tokens[opening].value !== "(") continue;
    const methodName = tokens[opening - 1];
    if (
      !methodName ||
      (!["identifier", "string"].includes(methodName.type) && methodName.value !== "]") ||
      controlFlowHeads.has(methodName.value)
    ) {
      continue;
    }
    const closing = matchingDelimiter(tokens, opening);
    if (closing === undefined) continue;
    const body = implementationBodyAfterSignature(closing);
    if (body === undefined) continue;
    const bodyClosing = matchingDelimiter(tokens, body);
    if (bodyClosing === undefined) continue;
    const scope = {
      bindings: new Map(),
      end: bodyClosing,
      functionScope: true,
      id: nextScopeId++,
      start: opening + 1,
    };
    scopes.push(scope);
    parameterBindings(opening, closing, scope);
  }

  // A `let`/`const` declared in a for-head shadows only that loop. Give the head and body one
  // range so a loop-local `module` cannot suppress the real CommonJS `module` after the loop.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "for") continue;
    let opening = index + 1;
    while (opening < tokens.length && tokens[opening].value !== "(") opening += 1;
    const closing = opening < tokens.length ? matchingDelimiter(tokens, opening) : undefined;
    if (closing === undefined) continue;
    const bodyStart = closing + 1;
    const bodyEnd =
      tokens[bodyStart]?.value === "{"
        ? matchingDelimiter(tokens, bodyStart)
        : statementEnd(tokens, bodyStart);
    if (bodyEnd === undefined) continue;
    scopes.push({
      bindings: new Map(),
      end: bodyEnd,
      id: nextScopeId++,
      start: opening + 1,
    });
  }

  const assignments = [];

  function isNodeModuleSpecifier(token) {
    return token?.type === "string" && ["module", "node:module"].includes(token.value);
  }

  function addValues(binding, values) {
    let changed = false;
    for (const value of values) {
      if (binding.values.has(value)) continue;
      binding.values.add(value);
      changed = true;
    }
    return changed;
  }

  function identifierValues(index) {
    const name = tokens[index]?.value;
    const binding = resolveBinding(index, name);
    if (binding) return new Set(binding.values);
    if (name === "require") return new Set(["loader:native-require:source"]);
    if (name === "module") return new Set(["native-module"]);
    return new Set();
  }

  function propertyValues(values, property) {
    const projected = new Set();
    for (const value of values) {
      if (value === "node-module" && property === "createRequire") projected.add("factory");
      if (value === "native-module" && property === "require") {
        projected.add("loader:module-require:source");
      }
      if (value.startsWith("loader:") && property === "bind") {
        projected.add(`bind:${value}`);
      }
    }
    return projected;
  }

  function staticPropertyAt(index) {
    if (tokens[index]?.value === "." && tokens[index + 1]?.type === "identifier") {
      return { end: index + 2, property: tokens[index + 1].value };
    }
    if (
      tokens[index]?.value === "?" &&
      tokens[index + 1]?.value === "." &&
      tokens[index + 2]?.type === "identifier"
    ) {
      return { end: index + 3, property: tokens[index + 2].value };
    }
    if (
      tokens[index]?.value === "[" &&
      tokens[index + 1]?.type === "string" &&
      tokens[index + 2]?.value === "]"
    ) {
      return { end: index + 3, property: tokens[index + 1].value };
    }
    return undefined;
  }

  function loaderBase(values) {
    const loaders = [...values].filter((value) => value.startsWith("loader:"));
    if (loaders.length === 0) return undefined;
    return loaders.some((value) => value.endsWith(":unknown")) ? "unknown" : "source";
  }

  const recordedCalls = new Map();

  function expressionAt(start, recordCalls = false, recursion = new Set()) {
    if (recursion.has(start)) return { end: start + 1, values: new Set() };
    recursion.add(start);
    let index = start;
    let values;
    if (tokens[index]?.type === "identifier") {
      values = identifierValues(index);
      index += 1;
    } else if (tokens[index]?.value === "(" && matchingDelimiter(tokens, index) !== undefined) {
      const closing = matchingDelimiter(tokens, index);
      const inner = expressionAt(index + 1, false, recursion);
      values = inner.end <= closing ? inner.values : new Set();
      index = closing + 1;
    } else {
      recursion.delete(start);
      return { end: start + 1, values: new Set() };
    }

    while (index < tokens.length) {
      const property = staticPropertyAt(index);
      if (property) {
        values = propertyValues(values, property.property);
        index = property.end;
        continue;
      }
      if (tokens[index]?.value !== "(") break;
      const opening = index;
      const closing = matchingDelimiter(tokens, opening);
      if (closing === undefined) break;
      const base = loaderBase(values);
      if (recordCalls && base !== undefined && !recordedCalls.has(opening)) {
        recordedCalls.set(opening, moduleCallReference(tokens, opening, "require", base));
      }
      const called = new Set();
      if (values.has("factory")) {
        called.add(
          `loader:create-require:${createRequireBase(tokens, opening, closing, isUnboundIdentifier)}`,
        );
      }
      if (
        [...values].some((value) => value.startsWith("loader:")) &&
        isNodeModuleSpecifier(tokens[opening + 1])
      ) {
        const onlyArgument = tokens[opening + 2]?.value === ")";
        if (onlyArgument) called.add("node-module");
      }
      for (const value of values) {
        if (!value.startsWith("bind:loader:")) continue;
        const loader = value.slice("bind:".length);
        const argument = expressionAt(opening + 1, false, recursion);
        if (
          loader.startsWith("loader:module-require:") &&
          argument.values.has("native-module") &&
          argument.end === closing
        ) {
          called.add(loader);
        } else {
          called.add(`${loader.slice(0, loader.lastIndexOf(":"))}:unknown`);
        }
      }
      values = called;
      index = closing + 1;
    }
    recursion.delete(start);
    return { end: index, values };
  }

  // Predeclare all lexical names before deriving trust. A declaration therefore shadows native
  // CommonJS globals throughout its scope, including before its textual declaration.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "import" && tokens[index + 1]?.value !== "(") {
      const end = statementEnd(tokens, index);
      const from = tokens.findIndex(
        (token, cursor) => cursor > index && cursor < end && token.value === "from",
      );
      if (from < 0) continue;
      const scope = declarationScope(index);
      if (tokens[index + 1]?.type === "identifier" && tokens[index + 1].value !== "type") {
        const binding = declare(scope, tokens[index + 1].value);
        if (isNodeModuleSpecifier(tokens[from + 1])) addValues(binding, ["node-module"]);
      }
      const star = tokens.findIndex(
        (token, cursor) => cursor > index && cursor < from && token.value === "*",
      );
      if (
        star >= 0 &&
        tokens[star + 1]?.value === "as" &&
        tokens[star + 2]?.type === "identifier"
      ) {
        const binding = declare(scope, tokens[star + 2].value);
        if (isNodeModuleSpecifier(tokens[from + 1])) addValues(binding, ["node-module"]);
      }
      const opening = tokens.findIndex(
        (token, cursor) => cursor > index && cursor < from && token.value === "{",
      );
      const closing = opening < 0 ? undefined : matchingDelimiter(tokens, opening);
      if (opening >= 0 && closing !== undefined && closing < from) {
        for (const binding of namedBindingEntries(tokens, opening, closing)) {
          const local = declare(scope, binding.local);
          if (isNodeModuleSpecifier(tokens[from + 1]) && binding.imported === "createRequire") {
            addValues(local, ["factory"]);
          }
        }
      }
      continue;
    }

    if (["const", "let", "var"].includes(tokens[index].value)) {
      const kind = tokens[index].value;
      const scope = declarationScope(index, kind);
      let cursor = index + 1;
      const end = statementEnd(tokens, index);
      while (cursor < end) {
        const patternStart = cursor;
        const patternClosing = ["{", "["].includes(tokens[cursor]?.value)
          ? matchingDelimiter(tokens, cursor)
          : undefined;
        const patternEnd = patternClosing === undefined ? cursor + 1 : patternClosing + 1;
        const entries = bindingEntries(patternStart, patternEnd, undefined);
        for (const entry of entries) declare(scope, entry.name);
        let separator = patternEnd;
        const closings = [];
        for (; separator < end; separator += 1) {
          const value = tokens[separator].value;
          if (["(", "[", "{"].includes(value)) {
            closings.push(value === "(" ? ")" : value === "[" ? "]" : "}");
          } else if (closings.at(-1) === value) {
            closings.pop();
          } else if (closings.length === 0 && [",", ";"].includes(value)) {
            break;
          }
        }
        const equals = topLevelToken(patternEnd, separator, "=");
        if (equals !== undefined) {
          for (const entry of entries) {
            assignments.push({
              binding: declare(scope, entry.name),
              expression: equals + 1,
              projection: entry.projection,
            });
          }
        }
        if (tokens[separator]?.value !== ",") break;
        cursor = separator + 1;
      }
      continue;
    }

    if (
      ["class", "function"].includes(tokens[index].value) &&
      tokens[index + 1]?.type === "identifier"
    ) {
      declare(declarationScope(index), tokens[index + 1].value);
    }
  }

  // Plain assignments are included so `let load; load = createRequire(...)` cannot evade the
  // guard. Assignments to an undeclared global are intentionally not elevated to trusted state.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index]?.type !== "identifier" ||
      tokens[index - 1]?.value === "." ||
      tokens[index + 1]?.value !== "=" ||
      ["=", ">"].includes(tokens[index + 2]?.value)
    ) {
      continue;
    }
    const binding = resolveBinding(index, tokens[index].value);
    if (binding) assignments.push({ binding, expression: index + 2, projection: undefined });
  }

  function projectedValues(values, projection) {
    return projection === undefined ? values : propertyValues(values, projection);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments) {
      const expression = expressionAt(assignment.expression);
      if (
        addValues(assignment.binding, projectedValues(expression.values, assignment.projection))
      ) {
        changed = true;
      }
    }
  }

  const indexedReferences = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    if (token.value === "import" && tokens[index + 1]?.value === "(") {
      indexedReferences.push({
        index: index + 1,
        reference: moduleCallReference(tokens, index + 1, "dynamic import", "source"),
      });
      continue;
    }
    if (tokens[index - 1]?.value !== ".") expressionAt(index, true);
    if (token.value !== "import" && token.value !== "export") continue;
    if (token.value === "import" && tokens[index + 1]?.type === "string") {
      indexedReferences.push({
        index,
        reference: { kind: "import", specifier: tokens[index + 1].value },
      });
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
        indexedReferences.push({
          index,
          reference: { kind: token.value, specifier: tokens[cursor + 1].value },
        });
        break;
      }
    }
  }
  for (const [index, reference] of recordedCalls) indexedReferences.push({ index, reference });
  indexedReferences.sort((left, right) => left.index - right.index);
  references.push(...indexedReferences.map(({ reference }) => reference));
  return references;
}

function compositionAnalysis(source) {
  const tokens = sourceTokens(source);
  const aliases = new Map();
  const namespaces = new Set();
  const references = new Set();

  // Outside the one owner, even an indirect/computed reference to a protected canonical name is
  // forbidden. This fail-closed fence covers indirection that a local alias analysis cannot prove.
  for (const token of tokens) {
    if (
      ["identifier", "string", "template"].includes(token.type) &&
      SINGLETON_COMPOSITION_IDENTIFIERS.has(token.value)
    ) {
      references.add(token.value);
    }
  }

  function statementEnd(start) {
    const end = tokens.findIndex((token, index) => index >= start && token.value === ";");
    return end < 0 ? tokens.length : end;
  }
  function namedBindings(opening, closing, onBinding) {
    let index = opening + 1;
    while (index < closing) {
      if (tokens[index].value === ",") {
        index += 1;
        continue;
      }
      const typeOnly = tokens[index].value === "type";
      if (typeOnly) index += 1;
      const imported = tokens[index];
      if (imported?.type !== "identifier") {
        index += 1;
        continue;
      }
      index += 1;
      let local = imported;
      if (tokens[index]?.value === "as" && tokens[index + 1]?.type === "identifier") {
        local = tokens[index + 1];
        index += 2;
      } else if (tokens[index]?.value === ":" && tokens[index + 1]?.type === "identifier") {
        local = tokens[index + 1];
        index += 2;
      }
      onBinding({ imported: imported.value, local: local.value, typeOnly });
      while (index < closing && tokens[index].value !== ",") index += 1;
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "import" && tokens[index + 1]?.value !== "(") {
      const end = statementEnd(index);
      const typeOnlyImport = tokens[index + 1]?.value === "type";
      const star = tokens.findIndex(
        (token, cursor) => cursor > index && cursor < end && token.value === "*",
      );
      if (
        !typeOnlyImport &&
        star >= 0 &&
        tokens[star + 1]?.value === "as" &&
        tokens[star + 2]?.type === "identifier"
      ) {
        namespaces.add(tokens[star + 2].value);
      }
      const opening = tokens.findIndex(
        (token, cursor) => cursor > index && cursor < end && token.value === "{",
      );
      if (opening < 0) continue;
      const closing = tokens.findIndex(
        (token, cursor) => cursor > opening && cursor < end && token.value === "}",
      );
      if (closing < 0) continue;
      namedBindings(opening, closing, ({ imported, local, typeOnly }) => {
        if (typeOnlyImport || typeOnly || !SINGLETON_COMPOSITION_IDENTIFIERS.has(imported)) return;
        aliases.set(local, imported);
        references.add(imported);
      });
      continue;
    }

    if (tokens[index].value === "export" && tokens[index + 1]?.value === "{") {
      const end = statementEnd(index);
      const closing = tokens.findIndex(
        (token, cursor) => cursor > index + 1 && cursor < end && token.value === "}",
      );
      if (closing < 0) continue;
      namedBindings(index + 1, closing, ({ imported, typeOnly }) => {
        const canonical = aliases.get(imported) ?? imported;
        if (!typeOnly && SINGLETON_COMPOSITION_IDENTIFIERS.has(canonical)) {
          references.add(canonical);
        }
      });
      continue;
    }

    if (!["const", "let", "var"].includes(tokens[index].value)) continue;
    if (tokens[index + 1]?.value === "{" && tokens[index + 2] !== undefined) {
      const closing = tokens.findIndex(
        (token, cursor) => cursor > index + 1 && token.value === "}",
      );
      if (
        closing > 0 &&
        tokens[closing + 1]?.value === "=" &&
        tokens[closing + 2]?.value === "require" &&
        tokens[closing + 3]?.value === "(" &&
        tokens[closing + 4]?.type === "string"
      ) {
        namedBindings(index + 1, closing, ({ imported, local }) => {
          if (!SINGLETON_COMPOSITION_IDENTIFIERS.has(imported)) return;
          aliases.set(local, imported);
          references.add(imported);
        });
      }
      continue;
    }
    if (
      tokens[index + 1]?.type === "identifier" &&
      tokens[index + 2]?.value === "=" &&
      tokens[index + 3]?.value === "require" &&
      tokens[index + 4]?.value === "(" &&
      tokens[index + 5]?.type === "string"
    ) {
      namespaces.add(tokens[index + 1].value);
    }
  }

  function canonicalAt(index) {
    const identifier = tokens[index];
    if (identifier?.type !== "identifier") return undefined;
    if (namespaces.has(identifier.value) && tokens[index + 1]?.value === ".") {
      const property = tokens[index + 2];
      if (
        property?.type === "identifier" &&
        SINGLETON_COMPOSITION_IDENTIFIERS.has(property.value)
      ) {
        return { identifier: property.value, next: index + 3 };
      }
    }
    if (
      namespaces.has(identifier.value) &&
      tokens[index + 1]?.value === "[" &&
      tokens[index + 2]?.type === "string" &&
      SINGLETON_COMPOSITION_IDENTIFIERS.has(tokens[index + 2].value) &&
      tokens[index + 3]?.value === "]"
    ) {
      return { identifier: tokens[index + 2].value, next: index + 4 };
    }
    const canonical = aliases.get(identifier.value) ?? identifier.value;
    if (!SINGLETON_COMPOSITION_IDENTIFIERS.has(canonical)) return undefined;
    if (tokens[index - 1]?.value === "." || tokens[index - 1]?.value === "[") return undefined;
    return { identifier: canonical, next: index + 1 };
  }

  // Propagate direct aliases and reject the reference itself outside the composition owner. The
  // fixed point covers `const second = first` without pretending to be a full data-flow engine.
  let addedAlias;
  do {
    addedAlias = false;
    for (let index = 0; index < tokens.length - 2; index += 1) {
      const declaration = ["const", "let", "var"].includes(tokens[index].value);
      const localIndex = declaration ? index + 1 : index;
      const equalsIndex = localIndex + 1;
      if (
        tokens[localIndex]?.type !== "identifier" ||
        tokens[equalsIndex]?.value !== "=" ||
        tokens[equalsIndex + 1]?.value === "=" ||
        tokens[equalsIndex + 1]?.value === ">"
      ) {
        continue;
      }
      const resolved = canonicalAt(equalsIndex + 1);
      if (resolved === undefined || ![";", ","].includes(tokens[resolved.next]?.value)) continue;
      references.add(resolved.identifier);
      if (aliases.get(tokens[localIndex].value) !== resolved.identifier) {
        aliases.set(tokens[localIndex].value, resolved.identifier);
        addedAlias = true;
      }
    }
  } while (addedAlias);

  const operations = new Map();
  function record(identifier) {
    operations.set(identifier, (operations.get(identifier) ?? 0) + 1);
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "new") {
      const resolved = canonicalAt(index + 1);
      if (resolved !== undefined) record(resolved.identifier);
      continue;
    }
    const resolved = canonicalAt(index);
    if (resolved === undefined || tokens[index - 1]?.value === "new") continue;
    if (tokens[resolved.next]?.value === "(") record(resolved.identifier);
  }
  return { operations, references };
}

function compositionViolations(relativeFilename, source) {
  const { operations, references } = compositionAnalysis(source);
  if (relativeFilename === INSTALLED_PI_COMPOSITION_OWNER) {
    return [...operations]
      .map(([identifier, calls]) => ({ identifier, calls }))
      .filter(({ calls }) => calls > 1)
      .map(
        ({ identifier, calls }) =>
          `${relativeFilename}: installed Pi composition must call ${identifier} once, found ${calls}`,
      );
  }
  return [...new Set([...operations.keys(), ...references])].map(
    (identifier) =>
      `${relativeFilename}: only ${INSTALLED_PI_COMPOSITION_OWNER} may call ${identifier} to create/access the installed Pi Runtime graph`,
  );
}

/**
 * This deliberately receives a map. It makes exact ownership fixtures cheap and prevents future
 * assertions from silently relying on a process cwd or generated output.
 */
export function installedPiCompositionViolations(files) {
  const violations = [];
  for (const [relativeFilename, source] of files) {
    violations.push(...compositionViolations(relativeFilename, source));
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

async function repositorySources(repositoryRoot) {
  const filenames = [];
  for (const directory of ROOT_COMPOSITION_DIRECTORIES) {
    filenames.push(...(await sourceFiles(path.join(repositoryRoot, directory))));
  }
  const entries = await Promise.all(
    [...new Set(filenames)].map(async (filename) => [
      normalized(path.relative(repositoryRoot, filename)),
      await readFile(filename, "utf8"),
    ]),
  );
  return new Map(entries);
}

export async function runtimeHostOwnershipViolations(repositoryRoot = REPOSITORY_ROOT) {
  const files = await repositorySources(repositoryRoot);
  return [
    ...installedPiCompositionViolations(files),
    ...runtimeApplicationBoundaryViolations(files),
  ].sort();
}

export async function checkRuntimeHostOwnership(repositoryRoot = REPOSITORY_ROOT) {
  const violations = await runtimeHostOwnershipViolations(repositoryRoot);
  if (violations.length === 0) return;
  throw new Error(
    `Runtime Host ownership violations:\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
  );
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
