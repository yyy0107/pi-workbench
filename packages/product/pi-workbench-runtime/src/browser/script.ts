import { workerSource } from "./script-worker";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export async function runBrowserScript(
  args: Record<string, any>,
  context: ExtensionContext,
  signal: AbortSignal | undefined,
  send: (method: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  onUpdate: Parameters<ToolDefinition["execute"]>[3],
): Promise<Awaited<ReturnType<ToolDefinition["execute"]>>> {
  if (!path.isAbsolute(args.path)) throw new Error("Script path must be absolute.");
  const filename = await realpath(args.path);
  const roots = await Promise.all([context.cwd, tmpdir()].map((root) => realpath(root)));
  if (
    !roots.some((root) => {
      const relative = path.relative(root, filename);
      return (
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      );
    })
  )
    throw new Error(
      "Script must be inside the current project or temporary directory, including symlink resolution.",
    );
  const info = await stat(filename);
  if (!info.isFile() || info.size > 1_000_000)
    throw new Error("Script must be a regular file no larger than 1 MB.");
  const source = await readFile(filename, { encoding: "utf8", signal });
  if (!source.trim() || Buffer.byteLength(source) > 1_000_000)
    throw new Error("Script is empty or too large.");
  const lifetime = new AbortController();
  const combined = AbortSignal.any([
    lifetime.signal,
    ...(signal ? [signal] : []),
    ...(context.signal ? [context.signal] : []),
  ]);
  combined.throwIfAborted();
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      source,
      params: args.params ?? {},
      cwd: context.cwd,
      requireFrom: path.join(context.cwd, "package.json"),
    },
    stdout: true,
    stderr: true,
  });
  // Consume output without retaining an unbounded console log in the host.
  worker.stdout.resume();
  worker.stderr.resume();
  let abort: () => void = () => {};
  const timer = setTimeout(
    () => lifetime.abort(new Error("Browser script timed out.")),
    args.timeoutMs ?? 60000,
  );
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(combined.reason);
      combined.addEventListener("abort", abort, { once: true });
      if (combined.aborted) {
        abort();
        return;
      }
      worker.on("error", reject);
      worker.on("exit", (code) =>
        reject(new Error(`Browser script exited before returning a result (${code}).`)),
      );
      worker.on("message", (message) => {
        try {
          if (combined.aborted) return;
          if (message.type === "cdp") {
            void send(message.method, message.params, combined)
              .then(
                (value) => {
                  if (!combined.aborted) worker.postMessage({ id: message.id, value });
                },
                (error) => {
                  if (!combined.aborted)
                    worker.postMessage({ id: message.id, error: String(error) });
                },
              )
              .catch(reject);
          } else if (message.type === "update") {
            if (
              Array.isArray(message.value?.content) &&
              message.value.content.every(
                (item: any) => item?.type === "text" && typeof item.text === "string",
              ) &&
              JSON.stringify(message.value).length < 65536
            )
              onUpdate?.({ content: message.value.content, details: message.value.details ?? {} });
          } else if (message.type === "error")
            reject(new Error(String(message.error).slice(0, 4096)));
          else if (message.type === "result") {
            const value = message.value;
            if (
              !Array.isArray(value?.content) ||
              !value.content.every(
                (item: any) => item?.type === "text" && typeof item.text === "string",
              )
            ) {
              reject(
                new Error(
                  "Script must return {content:[{type:'text',text:'...'}],details?:{...}}.",
                ),
              );
              return;
            }
            if (JSON.stringify(value).length > 1_000_000) {
              reject(new Error("Script result exceeds 1 MB. Write large results to a file."));
              return;
            }
            resolve({ content: value.content, details: value.details ?? {} });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", abort);
    lifetime.abort();
    await worker.terminate();
  }
}
