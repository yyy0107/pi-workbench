import { createRequire } from "node:module";
import { readFile, readdir, mkdir, writeFile, cp } from "node:fs/promises";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const destination = "/tmp/workbench-conversation-browser";
const baselineFlag = process.argv.find(
  (argument) => argument === "--baseline" || argument.startsWith("--baseline="),
);
const baseline = Boolean(baselineFlag);
const baselineRef = baselineFlag?.split("=")[1] ?? "HEAD";
const variant = baseline ? "baseline" : "optimized";
await mkdir(path.join(destination, variant), { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts/conversation-browser-benchmark.tsx")],
  outdir: path.join(destination, variant),
  bundle: true,
  format: "esm",
  splitting: true,
  nodePaths: [path.join(root, "packages/workbench/shell/node_modules")],
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  plugins: baseline
    ? [
        {
          name: "baseline",
          setup(build) {
            build.onLoad(
              { filter: /packages\/(?:agent-runtime\/.+|workbench\/shell)\/src\/.*\.[tj]sx?$/ },
              async ({ path: filename }) => {
                try {
                  const contents = execFileSync(
                    "git",
                    ["show", `${baselineRef}:${path.relative(root, filename)}`],
                    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
                  );
                  return { contents, loader: filename.endsWith("x") ? "tsx" : "ts" };
                } catch {
                  return undefined;
                }
              },
            );
          },
        },
      ]
    : [],
});
const styles = await readdir(path.join(root, "apps/web/.next/static/chunks"));
await cp(path.join(root, "apps/web/.next/static/media"), path.join(destination, "media"), {
  recursive: true,
});
let css = (
  await Promise.all(
    styles
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFile(path.join(root, "apps/web/.next/static/chunks", name), "utf8")),
  )
).join("\n");
if (!baseline)
  css += (
    await readFile(path.join(root, "packages/workbench/shell/src/chat/conversation.css"), "utf8")
  ).replace(/^@import .*;$/gm, "");
css +=
  "\nbody{margin:16px}header{display:flex;gap:12px;margin-bottom:12px}header button,input{border:1px solid gray;padding:6px}#viewport{border:1px solid gray;max-width:1000px;margin:auto}#results{font:12px monospace;max-height:160px;overflow:auto}input{width:100%}";
await writeFile(path.join(destination, variant, "style.css"), css);
await writeFile(
  path.join(destination, variant, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Conversation ${variant} benchmark</title><link rel="stylesheet" href="style.css"><div id="root"></div><script type="module" src="conversation-browser-benchmark.js"></script></html>`,
);
if (!process.argv.includes("--serve")) process.exit(0);
createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const filename = path.resolve(
    destination,
    `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
  );
  if (!filename.startsWith(destination + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(filename);
    response.setHeader(
      "Content-Type",
      filename.endsWith(".js")
        ? "text/javascript"
        : filename.endsWith(".css")
          ? "text/css"
          : filename.endsWith(".html")
            ? "text/html"
            : "application/octet-stream",
    );
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4178, "127.0.0.1", () =>
  console.log("Conversation benchmark: http://localhost:4178/optimized/"),
);
