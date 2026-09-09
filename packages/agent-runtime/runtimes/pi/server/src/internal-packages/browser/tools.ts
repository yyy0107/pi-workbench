import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { BROWSER_TOOL_ACTIONS, type BrowserFile } from "@workbench/browser-contracts";
import type { BrowserHost } from "./index";
import { runBrowserScript } from "./script";

const text = (maxLength = 65536) => Type.String({ maxLength });
const optionalText = (maxLength?: number) => Type.Optional(text(maxLength));
const number = (minimum: number, maximum: number) => Type.Number({ minimum, maximum });
const target = { ref: optionalText(256), selector: optionalText(2048), frameId: optionalText(256) };
const modifiers = Type.Optional(Type.Integer({ minimum: 0, maximum: 15 }));
const timeout = Type.Optional(number(0.01, 120));
const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }));
const sinceSeq = Type.Optional(Type.Integer({ minimum: 0 }));
const list = Type.Optional(Type.Array(text(256), { maxItems: 32 }));

const definitions: Record<
  keyof typeof BROWSER_TOOL_ACTIONS,
  { description: string; parameters: Record<string, TSchema>; read?: boolean }
> = {
  browser_setup: {
    description:
      "Connect to the browser selected in Workbench settings. Idempotently create or reuse this conversation's default tab.",
    parameters: {},
  },
  browser_snapshot: {
    description:
      "Read the accessibility tree with stable element refs, states, frame IDs and CSS bounds. Use query to find accessible names beyond truncation. Prefer refs for actions; take screenshots only for visual rendering.",
    parameters: { query: optionalText(1024), includeScreenshot: Type.Optional(Type.Boolean()) },
    read: true,
  },
  browser_click: {
    description:
      "Click an observed ref (preferred), a CSS selector, or viewport x/y. Ref geometry is resolved again before native input. Returns pageChanges when a prior full snapshot exists.",
    parameters: {
      ...target,
      x: Type.Optional(number(0, 16384)),
      y: Type.Optional(number(0, 16384)),
    },
  },
  browser_fill: {
    description:
      "Fill an input, textarea or contenteditable by ref or selector using native value setters and bubbling input/change events. Returns the verified value, redacting passwords. No focus step is needed.",
    parameters: { ...target, value: text() },
  },
  browser_fill_form: {
    description:
      "Fill multiple form fields sequentially using stable refs. String values fill text/select fields; booleans set checkboxes/radios. Returns per-field success or failure and pageChanges; never submits the form.",
    parameters: {
      fields: Type.Array(
        Type.Object({ ref: text(256), value: Type.Union([text(), Type.Boolean()]) }),
        { minItems: 1, maxItems: 100 },
      ),
    },
  },
  browser_select_option: {
    description:
      "Select a native select option by exactly one of value, label or index. Refuses disabled options and reports available options on mismatch. For custom dropdowns, click their observed refs.",
    parameters: {
      ...target,
      value: optionalText(),
      label: optionalText(2048),
      index: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
  },
  browser_set_checked: {
    description:
      "Idempotently set an observed checkbox/radio to checked or unchecked. For radios, select the desired option in the group.",
    parameters: { ...target, checked: Type.Boolean() },
  },
  browser_focus: {
    description: "Focus an element by ref or selector and verify that it received focus.",
    parameters: target,
  },
  browser_type: {
    description:
      "Insert text into the focused editable element. Use fill for replacing a value, and press_key for keyboard shortcuts.",
    parameters: { text: text() },
  },
  browser_press_key: {
    description:
      "Press and release a key (Enter, Tab, Escape, arrows or a character). Modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift.",
    parameters: { key: text(128), modifiers },
  },
  browser_dispatch_key: {
    description:
      "Dispatch a synthetic DOM KeyboardEvent on a specific ref or selector. Includes legacy keyCode/which. Does not insert text; use when a component needs an element-specific event.",
    parameters: {
      ...target,
      key: text(128),
      modifiers,
      eventType: Type.Optional(
        Type.Union([Type.Literal("keydown"), Type.Literal("keyup"), Type.Literal("keypress")]),
      ),
    },
  },
  browser_scroll: {
    description:
      "Scroll using native wheel input. Positive deltaY scrolls down. Optional x/y target a scrollable region in viewport CSS pixels.",
    parameters: {
      deltaY: Type.Optional(number(-10000, 10000)),
      deltaX: Type.Optional(number(-10000, 10000)),
      x: Type.Optional(number(0, 16384)),
      y: Type.Optional(number(0, 16384)),
    },
  },
  browser_drag_and_drop: {
    description:
      "Drag between two viewport CSS coordinate pairs, optionally supplying MIME-to-text dataTransfer entries for HTML5 drop targets.",
    parameters: {
      startX: number(0, 16384),
      startY: number(0, 16384),
      endX: number(0, 16384),
      endY: number(0, 16384),
      dataTransfer: Type.Optional(Type.Record(text(256), text(65536))),
    },
  },
  browser_page_info: {
    description:
      "Get URL, title, viewport, scroll position, page size and readiness, or the pending page dialog without evaluating blocked JavaScript.",
    parameters: {},
    read: true,
  },
  browser_wait: {
    description:
      "Wait for a bounded number of seconds. Prefer wait_for or wait_for_load for page conditions. Cancellation interrupts the wait.",
    parameters: { seconds: number(0, 60) },
    read: true,
  },
  browser_wait_for: {
    description:
      "Wait for exactly one CSS selector or text condition. gone:true waits for absence. Timeout is in seconds, default 5.",
    parameters: {
      selector: optionalText(2048),
      text: optionalText(4096),
      gone: Type.Optional(Type.Boolean()),
      timeout,
    },
    read: true,
  },
  browser_wait_for_load: {
    description: "Wait until document.readyState is complete. Timeout is in seconds, default 15.",
    parameters: { timeout },
    read: true,
  },
  browser_handle_dialog: {
    description:
      "Accept or dismiss a page alert, confirm or prompt. This cannot answer Workbench permission requests.",
    parameters: { accept: Type.Boolean(), promptText: optionalText() },
  },
  browser_screenshot: {
    description:
      "Capture a native image for visual verification. Returns CSS viewport/capture bounds and bitmap dimensions. Full-page coordinates are not viewport click coordinates.",
    parameters: {
      fullPage: Type.Optional(Type.Boolean()),
      format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])),
      quality: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      maxDim: Type.Optional(Type.Integer({ minimum: 100, maximum: 8000 })),
    },
    read: true,
  },
  browser_navigate: {
    description:
      "Navigate the current or specified controlled tab to an HTTP(S) URL. Wait for page conditions before acting.",
    parameters: { url: text(8192) },
  },
  browser_open_urls: {
    description:
      "Open up to 16 URLs in separate controlled tabs. Returns every new session ID, including partial failures, and selects the last successful tab.",
    parameters: { urls: Type.Array(text(8192), { minItems: 1, maxItems: 16 }) },
  },
  browser_go_back: {
    description: "Go back in this tab's history, subject to browser history permission.",
    parameters: {},
  },
  browser_go_forward: {
    description: "Go forward in this tab's history, subject to browser history permission.",
    parameters: {},
  },
  browser_reload: {
    description: "Reload the current tab. Old document refs become stale.",
    parameters: {},
  },
  browser_list_tabs: {
    description:
      "List only this conversation's tabs. scope:'all' has the same conversation boundary. includeInternal:false omits chrome:// pages. Use the returned ids as sessionId/targetId for actions.",
    parameters: {
      scope: Type.Optional(Type.Union([Type.Literal("owned"), Type.Literal("all")])),
      includeInternal: Type.Optional(Type.Boolean()),
    },
    read: true,
  },
  browser_current_tab: {
    description:
      "Inspect this conversation's selected tab; it is independent of whichever tab the user focuses.",
    parameters: {},
    read: true,
  },
  browser_switch_tab: {
    description:
      "Select and reveal an existing controlled tab by targetId or sessionId. Use list_tabs to discover IDs.",
    parameters: {},
  },
  browser_new_tab: {
    description:
      "Create a new controlled tab, optionally at a URL, and select it for subsequent browser tools.",
    parameters: { url: optionalText(8192) },
  },
  browser_close_tab: {
    description:
      "Close a controlled tab. Existing unrelated Chrome tabs cannot be closed through this tool.",
    parameters: {},
  },
  browser_upload_file: {
    description:
      "Upload an absolute local file to an observed file-input ref or selector, or a pending requestId. The host enforces upload permission.",
    parameters: { ...target, requestId: optionalText(256), filePath: text(4096) },
  },
  browser_download: {
    description:
      "Configure the browser download directory for this connection, subject to download permission. downloadPath (or directory) must be absolute. Downloads can be inspected with workbench_browser downloads.list/download.read.",
    parameters: { downloadPath: optionalText(4096), directory: optionalText(4096) },
  },
  browser_print_to_pdf: {
    description:
      "Print the current page to PDF and return a local artifact path. Optionally provide an output path; existing files are never overwritten.",
    parameters: { outputPath: optionalText(4096), path: optionalText(4096) },
    read: true,
  },
  browser_viewport_resize: {
    description:
      "Set viewport dimensions and optional device pixel ratio for responsive testing. Ordinary actions preserve the existing viewport.",
    parameters: {
      width: number(1, 7680),
      height: number(1, 7680),
      deviceScaleFactor: Type.Optional(number(1, 3)),
    },
  },
  browser_http_get: {
    description:
      "GET an HTTP(S) URL outside Chrome for APIs or static pages. Does not share browser cookies. Bounds response size and applies timeout to headers and body.",
    parameters: {
      url: text(8192),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      timeout,
    },
    read: true,
  },
  browser_network_requests: {
    description:
      "Read this tab's bounded network records with URL substring or /regex/flags, method, status, resource type and recency filters. sinceSeq/nextCursor support incremental reads. Response bodies are optional and bounded; overflow is explicit.",
    parameters: {
      urlPattern: optionalText(1024),
      methodFilter: list,
      resourceTypes: list,
      statusFilter: Type.Optional(
        Type.Object({ min: Type.Optional(number(100, 599)), max: Type.Optional(number(100, 599)) }),
      ),
      sinceMs: Type.Optional(number(0, Number.MAX_SAFE_INTEGER)),
      sinceSeq,
      limit,
      includeResponseBodies: Type.Optional(Type.Boolean()),
    },
    read: true,
  },
  browser_console: {
    description:
      "Read bounded console messages and JavaScript errors for this tab. Pass nextCursor as sinceSeq to observe only later entries. Records survive tab switches.",
    parameters: {
      levels: list,
      sinceSeq,
      limit,
      textPattern: optionalText(1024),
      sinceMs: Type.Optional(number(0, Number.MAX_SAFE_INTEGER)),
    },
    read: true,
  },
  browser_execute_js: {
    description:
      "Evaluate JavaScript in the page, returning a JSON value. A leading return is wrapped automatically. Optional frameId comes from snapshot. Requires full CDP access in Browser settings because JavaScript can mutate the page.",
    parameters: { expression: text(100000), frameId: optionalText(256) },
  },
  browser_run_script: {
    description:
      "Execute a reviewed local JavaScript file with Node.js and a live CDP bridge. Requires full CDP access. File must be under cwd or the temporary directory. A worker enforces a hard timeout, including synchronous loops. Bindings: params, daemon, require, signal, onUpdate, ctx, console, fetch, Buffer. Return {content:[{type:'text',text:'...'}],details?:{...}}.",
    parameters: {
      path: text(4096),
      params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 600000 })),
    },
  },
  browser_web_search: {
    description:
      "Search Google in an isolated temporary tab and return ranked title/url/snippet results. Does not disturb the selected tab. Reports CAPTCHA or no_results explicitly; do not busy-retry a challenge.",
    parameters: {
      query: text(2048),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
    },
    read: true,
  },
  browser_read_page: {
    description:
      "Read the page's main article text with boilerplate removed. Provide a URL for an isolated temporary tab, or use the current/selected tab. Temporary tabs close after success, error or cancellation.",
    parameters: { url: optionalText(8192) },
    read: true,
  },
};

export function registerHarnessTools(
  pi: ExtensionAPI,
  core: ToolDefinition,
  resolveHost: (context: ExtensionContext) => BrowserHost | undefined,
): () => void {
  const selectedTabs = new Map<string, string>();
  for (const [name, action] of Object.entries(BROWSER_TOOL_ACTIONS)) {
    const definition = definitions[name as keyof typeof definitions];
    pi.registerTool({
      name,
      label: name,
      description: definition.description,
      promptSnippet: definition.description.split(". ")[0],
      parameters: Type.Object({
        sessionId: optionalText(256),
        targetId: optionalText(256),
        ...definition.parameters,
      }),
      executionMode: definition.read ? "parallel" : "sequential",
      async execute(callId, args, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        if (args.sessionId && args.targetId && args.sessionId !== args.targetId)
          throw new Error("Use one sessionId or targetId.");
        // Pi validates this heterogeneous catalog against the selected tool's concrete schema.
        const { sessionId, targetId, ...params } = args as Record<string, any>;
        const threadId = ctx.sessionManager.getSessionId();
        const current = selectedTabs.get(threadId);
        const selected =
          sessionId ?? targetId ?? current ?? `workbench-${ctx.sessionManager.getSessionId()}`;
        const call = (
          command: string,
          fields: Record<string, unknown> = {},
          id = selected,
          callSignal = signal,
        ) =>
          core.execute(
            callId,
            { action: command, sessionId: id, params: fields },
            callSignal,
            onUpdate,
            ctx,
          );
        if (action === "http-get") return httpGet(params, signal);
        if (action === "run-script") {
          const host = resolveHost(ctx);
          if (!host) throw new Error("The browser is unavailable.");
          const settings = await host.command({ type: "settings.get" }, signal);
          if (
            !settings ||
            typeof settings !== "object" ||
            !("fullCdpAccess" in settings) ||
            !settings.fullCdpAccess
          )
            throw new Error("Enable full CDP access in Browser settings before running scripts.");
          await call("attach");
          return runBrowserScript(
            params,
            ctx,
            signal,
            async (method, parameters, scriptSignal) => {
              const result = await call(
                "cdp",
                { method, params: parameters },
                selected,
                scriptSignal,
              );
              const value = result.content.find((part) => part.type === "text");
              return value?.type === "text" ? JSON.parse(value.text) : undefined;
            },
            onUpdate,
          );
        }
        if (action === "open-urls") {
          const urls = params.urls as string[];
          const opened = await Promise.allSettled(
            urls.map((url) => call("attach", { url }, `workbench-${randomUUID()}`)),
          );
          signal?.throwIfAborted();
          const browserSessions = opened.flatMap((result) =>
            result.status === "fulfilled" ? [result.value.details] : [],
          );
          const last = browserSessions.at(-1) as { browserSessionId?: string } | undefined;
          if (last?.browserSessionId) selectedTabs.set(threadId, last.browserSessionId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  opened.map((result, i) =>
                    result.status === "fulfilled"
                      ? { url: params.urls[i], ...(result.value.details as object) }
                      : { url: params.urls[i], error: String(result.reason) },
                  ),
                ),
              },
            ],
            details: { browserSessions },
          };
        }
        if (name === "browser_new_tab") {
          const id = `workbench-${randomUUID()}`;
          const result = await call("attach", params, id);
          selectedTabs.set(threadId, id);
          return result;
        }
        if (action === "tabs.list") return call(action, params);
        if (action === "tabs.switch") {
          if (!sessionId && !targetId)
            throw new Error("Provide an observed sessionId or targetId.");
          const result = await call(action);
          selectedTabs.set(threadId, selected);
          return result;
        }
        if (
          action !== "attach" &&
          action !== "close" &&
          !sessionId &&
          !targetId &&
          !current &&
          action !== "web-search" &&
          !(action === "read-page" && params.url)
        ) {
          await call("attach");
          selectedTabs.set(threadId, selected);
        }
        if (action === "fill") {
          params.text = params.value;
          delete params.value;
        }
        if (action === "dialog.respond") {
          params.text = params.promptText;
          delete params.promptText;
        }
        if (action === "viewport") params.visible = true;
        if (action === "scroll") params.deltaY ??= 300;
        if (action === "download.configure" && params.downloadPath !== undefined) {
          if (params.directory !== undefined && params.directory !== params.downloadPath)
            throw new Error("Use one downloadPath or directory.");
          params.directory = params.downloadPath;
          delete params.downloadPath;
        }
        if (action === "print" && params.outputPath !== undefined) {
          if (params.path !== undefined && params.path !== params.outputPath)
            throw new Error("Use one outputPath or path.");
          params.path = params.outputPath;
          delete params.outputPath;
        }
        if (action === "drag")
          Object.assign(params, {
            fromX: params.startX,
            fromY: params.startY,
            toX: params.endX,
            toY: params.endY,
          });
        if (action === "upload") {
          if (!path.isAbsolute(params.filePath)) throw new Error("filePath must be absolute.");
          const info = await stat(params.filePath);
          if (!info.isFile() || info.size > 8 * 1024 * 1024)
            throw new Error("Upload a regular file no larger than 8 MiB.");
          const data = await readFile(params.filePath, { signal });
          params.files = [
            {
              name: path.basename(params.filePath),
              mimeType: "application/octet-stream",
              data: data.toString("base64"),
            },
          ];
          delete params.filePath;
        }
        const result = await call(action, params);
        if (action === "attach") selectedTabs.set(threadId, selected);
        if (action === "close" && selected === current) selectedTabs.delete(threadId);
        if (action === "print") {
          const value = result.content.find((part) => part.type === "text");
          const file: BrowserFile = JSON.parse(value?.type === "text" ? value.text : "{}");
          if (typeof file.data !== "string") throw new Error("The browser did not return a PDF.");
          const output = params.path
            ? path.resolve(ctx.cwd, params.path)
            : path.join(await mkdtemp(path.join(tmpdir(), "browser-pdf-")), file.name);
          await mkdir(path.dirname(output), { recursive: true });
          await writeFile(output, Buffer.from(file.data, "base64"), {
            flag: "wx",
            mode: 0o600,
            signal,
          });
          return {
            content: [
              { type: "text", text: JSON.stringify({ path: output, mimeType: file.mimeType }) },
            ],
            details: result.details,
          };
        }
        return result;
      },
    });
  }
  return () => selectedTabs.clear();
}

async function httpGet(args: Record<string, any>, signal?: AbortSignal) {
  let url = new URL(args.url);
  const requestSignal = AbortSignal.any([
    AbortSignal.timeout((args.timeout ?? 20) * 1000),
    ...(signal ? [signal] : []),
  ]);
  let headers = args.headers;
  for (let redirects = 0; redirects <= 10; redirects++) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Use an HTTP(S) URL without credentials.");
    const response = await fetch(url, { headers, signal: requestSignal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has("location")) {
      await response.body?.cancel();
      const next = new URL(response.headers.get("location")!, url);
      if (next.origin !== url.origin) headers = undefined;
      url = next;
      continue;
    }
    let length = 0;
    const chunks: Buffer[] = [];
    let truncated = false;
    for await (const chunk of response.body ?? []) {
      const buffer = Buffer.from(chunk);
      const remaining = 65536 - length;
      chunks.push(buffer.subarray(0, remaining));
      length += Math.min(remaining, buffer.length);
      if (buffer.length > remaining) {
        truncated = true;
        break;
      }
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            url: url.href,
            status: response.status,
            contentType: response.headers.get("content-type"),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          }),
        },
      ],
      details: {},
    };
  }
  throw new Error("Too many HTTP redirects.");
}
