import { parseSync, visitorKeys } from "oxc-parser";

const FILE_CALLS =
  /^(?:(?:path\.)?(?:join|resolve|normalize)|(?:fs\.)?(?:readFile|readFileSync|readdir|readdirSync|stat|statSync)|URL)$/u;
const ROOT_IDENTIFIERS = new Set(["repositoryRoot", "PROJECT_ROOT", "REPOSITORY_ROOT"]);

export function parseWorkspaceSource(source, filename = "source.tsx") {
  const { program, errors } = parseSync(filename, source);
  if (errors.length) {
    throw new Error(
      `${filename}: cannot check module boundaries: ${errors.map((error) => error.message).join("; ")}`,
    );
  }
  return program;
}

function visit(node, callback) {
  if (!node || typeof node.type !== "string") return;
  callback(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((entry) => visit(entry, callback));
    else visit(child, callback);
  }
}

function literal(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
}

/** Actual module nodes only: quoted test fixtures and regex bodies are not imports. */
export function moduleSpecifiers(source, filename = "source.tsx") {
  const values = [];
  visit(typeof source === "string" ? parseWorkspaceSource(source, filename) : source, (node) => {
    let specifier;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
        "TSImportType",
      ].includes(node.type)
    ) {
      specifier = literal(node.source);
      if (
        specifier === undefined &&
        node.type === "ImportExpression" &&
        node.source?.type === "MemberExpression" &&
        node.source.property?.name === "href"
      ) {
        const url = node.source.object;
        if (url?.type === "NewExpression" && url.callee?.name === "URL")
          specifier = literal(url.arguments[0]);
      }
    } else if (node.type === "TSExternalModuleReference") {
      specifier = literal(node.expression);
    } else if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require"
    ) {
      specifier = literal(node.arguments[0]);
    }
    if (specifier !== undefined) values.push(specifier);
  });
  return values;
}

function calleeName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier") {
    return `${node.object.name}.${node.property.name}`;
  }
}

/** Static filesystem arguments; nested calls are visited without scanning string contents. */
export function pathReferenceValues(source, filename = "source.tsx") {
  const values = [];
  visit(typeof source === "string" ? parseWorkspaceSource(source, filename) : source, (node) => {
    if (node.type !== "CallExpression" && node.type !== "NewExpression") return;
    const callee = calleeName(node.callee);
    if (!callee || !FILE_CALLS.test(callee)) return;
    const args = node.arguments;
    const isJoin = /^(?:path\.)?(?:join|resolve)$/u.test(callee);
    const strings = (isJoin ? args : args.slice(0, 1))
      .map(literal)
      .filter((value) => value !== undefined);
    if (strings.length) {
      values.push({
        reference: strings.join("/"),
        repositoryRelative: args[0]?.type === "Identifier" && ROOT_IDENTIFIERS.has(args[0].name),
      });
    }
  });
  return values;
}

export function isTestSource(filename) {
  return /(?:^|[/\\])(?:test|tests)(?:[/\\])|\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(filename);
}
