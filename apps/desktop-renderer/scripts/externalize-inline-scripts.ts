import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const GENERATED_SCRIPT_DIRECTORY = "_next/static/desktop-inline";
const SCRIPT_ELEMENT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
const SCRIPT_START_PATTERN = /<script\b/giu;
const SCRIPT_END_PATTERN = /<\/script\s*>/giu;
const ATTRIBUTE_NAME_PATTERN = /[^\s/"'<>`=]/u;
const JAVASCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

interface ParsedAttributes {
  readonly names: ReadonlySet<string>;
  readonly type?: string;
}

export interface ExternalizedInlineScript {
  readonly htmlPath: string;
  readonly scriptPath: string;
  readonly source: string;
}

function relativeArtifactPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function parseAttributes(raw: string, htmlPath: string): ParsedAttributes {
  if (/\/\s*$/u.test(raw)) {
    throw new Error(`Self-closing script syntax is unsupported in ${htmlPath}.`);
  }
  const names = new Set<string>();
  let type: string | undefined;
  let index = 0;

  while (index < raw.length) {
    while (/\s/u.test(raw[index] ?? "")) index += 1;
    if (index >= raw.length) break;

    const nameStart = index;
    while (index < raw.length && ATTRIBUTE_NAME_PATTERN.test(raw[index] ?? "")) index += 1;
    if (nameStart === index) throw new Error(`Malformed script attributes in ${htmlPath}.`);
    const name = raw.slice(nameStart, index).toLowerCase();
    if (names.has(name)) throw new Error(`Duplicate script attribute "${name}" in ${htmlPath}.`);
    names.add(name);

    while (/\s/u.test(raw[index] ?? "")) index += 1;
    let value = "";
    if (raw[index] === "=") {
      index += 1;
      while (/\s/u.test(raw[index] ?? "")) index += 1;
      const quote = raw[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < raw.length && raw[index] !== quote) index += 1;
        if (index >= raw.length) throw new Error(`Unterminated script attribute in ${htmlPath}.`);
        value = raw.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < raw.length && !/\s/u.test(raw[index] ?? "")) index += 1;
        if (valueStart === index)
          throw new Error(`Empty unquoted script attribute in ${htmlPath}.`);
        value = raw.slice(valueStart, index);
      }
    }
    if (name === "type") type = value.trim().toLowerCase();
  }

  if (type?.includes("&")) throw new Error(`Encoded script type is unsupported in ${htmlPath}.`);
  return { names, ...(type === undefined ? {} : { type }) };
}

function isExecutableScript(attributes: ParsedAttributes): boolean {
  const type = attributes.type;
  return type === undefined || type === "" || JAVASCRIPT_TYPES.has(type);
}

function assertExternalizable(attributes: ParsedAttributes, htmlPath: string): void {
  for (const name of ["async", "defer", "integrity", "blocking"]) {
    if (attributes.names.has(name)) {
      throw new Error(
        `Inline script attribute "${name}" cannot preserve semantics in ${htmlPath}.`,
      );
    }
  }
}

function scriptFilename(htmlPath: string, index: number, source: string): string {
  const digest = createHash("sha256")
    .update(htmlPath)
    .update("\0")
    .update(String(index))
    .update("\0")
    .update(source)
    .digest("hex")
    .slice(0, 24);
  return `${digest}.js`;
}

async function htmlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Desktop renderer export cannot contain a symlink: ${relativeArtifactPath(root, absolute)}.`,
        );
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        files.push(absolute);
      }
    }
  }
  await visit(root);
  return files;
}

/** Replace executable inline scripts in every exported HTML file with ordered same-origin files. */
export async function externalizeExecutableInlineScripts(
  exportRoot: string,
): Promise<readonly ExternalizedInlineScript[]> {
  const root = path.resolve(exportRoot);
  const outputDirectory = path.join(root, GENERATED_SCRIPT_DIRECTORY);
  try {
    await lstat(outputDirectory);
    throw new Error(
      `Reserved generated script directory already exists: ${GENERATED_SCRIPT_DIRECTORY}.`,
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const generated: ExternalizedInlineScript[] = [];
  for (const htmlFile of await htmlFiles(root)) {
    const htmlPath = relativeArtifactPath(root, htmlFile);
    const html = await readFile(htmlFile, "utf8");
    const startCount = [...html.matchAll(SCRIPT_START_PATTERN)].length;
    const endCount = [...html.matchAll(SCRIPT_END_PATTERN)].length;
    let scriptIndex = 0;
    let matchCount = 0;
    const transformed = html.replace(
      SCRIPT_ELEMENT_PATTERN,
      (element: string, rawAttributes: string, source: string) => {
        matchCount += 1;
        const currentIndex = scriptIndex;
        scriptIndex += 1;
        const attributes = parseAttributes(rawAttributes, htmlPath);
        if (attributes.names.has("src")) return element;
        // Module imports and import.meta.url resolve relative to the script URL, so moving an
        // inline module would change its semantics. Import maps and speculation rules cannot use
        // src at all. Fail closed for all three instead of producing a subtly different export.
        if (
          attributes.type === "module" ||
          attributes.type === "importmap" ||
          attributes.type === "speculationrules"
        ) {
          throw new Error(
            `Inline ${attributes.type} scripts cannot be externalized in ${htmlPath}.`,
          );
        }
        if (!isExecutableScript(attributes)) return element;
        assertExternalizable(attributes, htmlPath);

        const filename = scriptFilename(htmlPath, currentIndex, source);
        const scriptPath = `${GENERATED_SCRIPT_DIRECTORY}/${filename}`;
        generated.push(Object.freeze({ htmlPath, scriptPath, source }));
        return `<script${rawAttributes} src="/${scriptPath}"></script>`;
      },
    );
    if (matchCount !== startCount || matchCount !== endCount) {
      throw new Error(`Malformed or unsupported script markup in ${htmlPath}.`);
    }
    if (transformed !== html) await writeFile(htmlFile, transformed, "utf8");
  }

  if (generated.length > 0) {
    await mkdir(outputDirectory, { recursive: true });
    for (const script of generated) {
      await writeFile(path.join(root, script.scriptPath), script.source, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      });
    }
  }
  return Object.freeze(generated);
}
