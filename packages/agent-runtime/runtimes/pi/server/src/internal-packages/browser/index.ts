import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  parseBrowserCommand,
  type BrowserCommand,
  type BrowserFile,
} from "@workbench/browser-contracts";
import { createBrowserHostResolver } from "./standalone-host";

export interface BrowserHost {
  command(
    command: BrowserCommand,
    signal?: AbortSignal,
    controlSignal?: AbortSignal,
  ): Promise<unknown>;
  resolveProjectId?(cwd: string): Promise<string>;
}

const actions = [
  "tabs.list",
  "attach",
  "navigate",
  "back",
  "forward",
  "reload",
  "stop",
  "close",
  "screenshot",
  "snapshot",
  "click",
  "fill",
  "copy",
  "input",
  "find",
  "viewport",
  "open-page",
  "history.list",
  "downloads.list",
  "download.cancel",
  "upload",
  "dialog.respond",
  "site-tools.list",
  "site-tools.call",
  "cdp",
] as const;

export function createBrowserExtension(
  resolveHost: (context: ExtensionContext) => BrowserHost | undefined,
): ExtensionFactory {
  return (pi) => {
    let control: AbortController | undefined;
    const releaseControl = () => {
      control?.abort();
      control = undefined;
    };
    pi.on("agent_settled", releaseControl);
    pi.on("session_shutdown", releaseControl);
    pi.registerTool({
      name: "workbench_browser",
      label: "workbench_browser",
      description:
        "Control Workbench's in-app browser or this Pi session's isolated headless browser. Read the browser-use skill before browser work. Use tabs.list to discover tabs in the current project, then reuse the returned id as sessionId. Attach creates or reuses a tab; its optional HTTP(S) url applies only to a new tab. Use navigate to change an existing tab. Ordinary HTTP(S) navigation does not request browser permission; proceed within the user's task. Omitting sessionId uses this conversation's fixed default tab, not the user's focused tab. Snapshot returns {session,snapshotId,nodes,truncated}; params:{query} filters accessible names before the output limit, including later content in large pages. Use observed node refs with click params:{ref} or fill params:{ref,text}. Click also accepts params:{x,y} for one complete left click in viewport CSS coordinates; use a current screenshot and never mix ref with x/y. Refs belong to one tab and its latest snapshot; take another snapshot after navigation or a stale-ref error. Permissions and per-site overrides are enforced by the host, and approval requests use the host UI. Screenshot returns an image plus viewport/capture in CSS pixels and pixels:{width,height} for the encoded bitmap. Keep the user's viewport, zoom, and device settings when mapping coordinates. Input x/y are viewport-relative CSS pixels: for a viewport screenshot displayed at W×H, use x=imageX*viewport.width/W and y=imageY*viewport.height/H. Full-page screenshots use document coordinates; scroll and capture the viewport before coordinate input. Input params.event accepts {kind:'text',text}, {kind:'mouse',type:'mousePressed'|'mouseReleased'|'mouseMoved'|'mouseWheel',x,y,button?,deltaX?,deltaY?}, or {kind:'key',type:'keyDown'|'keyUp',key,code}. Find params: {text,backwards?}. Viewport params: {width,height,visible,zoom?,device?:{width,height,mobile}}. Ordinary pages reflow within the viewport at the selected zoom; fixed-width content may scroll horizontally. Open-page params.page may be history or downloads. History.list returns recent profile history as [{url,title,time}]; params:{query?,limit?} searches titles and URLs, with a default limit of 50 and maximum 100. History access remains subject to its browser permission. Upload params: {requestId,files:[{name,mimeType,data:base64}]}. Dialog.respond params: {accept,text?}, for page dialogs only. Download params.downloadId selects a prior download. Site-tools.call params: {name,arguments}; discover names with site-tools.list. CDP example params:{method:'Runtime.evaluate',expression:'document.title',returnByValue:true}; legacy {method,params:{...}} also works, but do not mix the two forms. CDP is available only when the user enables full access in Browser settings. Never change permissions or bypass a denied action.",
      promptSnippet:
        "Control the browser; read browser-use first. Search snapshots with query; use click with ref or screenshot-derived x/y, then verify the result.",
      parameters: Type.Object({
        action: StringEnum(actions),
        sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        url: Type.Optional(Type.String({ maxLength: 8192 })),
        params: Type.Optional(
          Type.Object(
            {
              ref: Type.Optional(
                Type.String({
                  description: "Observed ref for click or fill; do not combine with x/y.",
                }),
              ),
              text: Type.Optional(Type.String({ description: "Text for fill or find." })),
              query: Type.Optional(
                Type.String({
                  maxLength: 1024,
                  description:
                    "For snapshot, case-insensitive accessible-name substring, filtered before truncation. For history.list, search titles and URLs.",
                }),
              ),
              x: Type.Optional(
                Type.Number({
                  minimum: 0,
                  description:
                    "Click x in viewport CSS pixels, derived from a current screenshot; requires y.",
                }),
              ),
              y: Type.Optional(
                Type.Number({
                  minimum: 0,
                  description:
                    "Click y in viewport CSS pixels, derived from a current screenshot; requires x.",
                }),
              ),
              fullPage: Type.Optional(
                Type.Boolean({
                  description:
                    "Screenshot only: include offscreen content. Use a viewport screenshot before coordinate clicks.",
                }),
              ),
              method: Type.Optional(
                Type.String({
                  description: "CDP method, such as Runtime.evaluate or Page.getFrameTree.",
                }),
              ),
              expression: Type.Optional(
                Type.String({
                  description:
                    "Required for Runtime.evaluate: a JavaScript expression. Wrap a body using return in (() => { ... })().",
                }),
              ),
              returnByValue: Type.Optional(
                Type.Boolean({
                  description:
                    "For Runtime.evaluate, use true to return a JSON value instead of an objectId.",
                }),
              ),
              params: Type.Optional(
                Type.Record(Type.String(), Type.Unknown(), {
                  description:
                    "Legacy nested CDP arguments. Omit this when protocol arguments such as expression are alongside method; never mix both forms.",
                }),
              ),
            },
            {
              additionalProperties: true,
              description:
                "Arguments for the selected action. For CDP, put method and its protocol arguments here, for example {method:'Runtime.evaluate',expression:'document.title',returnByValue:true}.",
            },
          ),
        ),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, { action, sessionId, url, params }, signal, _onUpdate, ctx) {
        signal?.throwIfAborted();
        const browser = resolveHost(ctx);
        if (!browser) throw new Error("The built-in browser is unavailable in this host.");
        const id = sessionId ?? `workbench-${ctx.sessionManager.getSessionId()}`;
        const projectId =
          action === "attach" || action === "tabs.list"
            ? ((await browser.resolveProjectId?.(ctx.cwd)) ?? ctx.cwd)
            : ctx.cwd;
        signal?.throwIfAborted();
        let commandParams: Record<string, unknown> | undefined = params;
        if (action === "cdp") {
          const { method, params: nested, ...flat } = params ?? {};
          if (nested !== undefined && Object.keys(flat).length > 0)
            throw new Error(
              "CDP arguments mix flat and nested forms. Use params:{method:'Runtime.evaluate',expression:'document.title',returnByValue:true}, or put all protocol arguments inside params.params.",
            );
          const protocolParams = nested ?? flat;
          if (
            method === "Runtime.evaluate" &&
            (typeof protocolParams.expression !== "string" || !protocolParams.expression.trim())
          )
            throw new Error(
              "Runtime.evaluate requires a non-empty expression. Example: {action:'cdp',params:{method:'Runtime.evaluate',expression:'document.title',returnByValue:true}}. Wrap statements using return in (() => { ... })().",
            );
          commandParams = { method, params: protocolParams };
        }
        const command = parseBrowserCommand({
          ...commandParams,
          type: action,
          ...(action === "tabs.list" || action === "history.list" ? {} : { sessionId: id }),
          ...(url === undefined ? {} : { url }),
          ...(action === "attach" || action === "tabs.list" ? { projectId } : {}),
        });
        if (!command)
          throw new Error(
            action === "cdp"
              ? "Invalid CDP parameters. Example: {action:'cdp',params:{method:'Runtime.evaluate',expression:'document.title',returnByValue:true}}."
              : "Invalid browser command parameters.",
          );
        control ??= new AbortController();
        const controlSignal = ctx.signal
          ? AbortSignal.any([control.signal, ctx.signal])
          : control.signal;
        const result = await browser.command(command, signal, controlSignal);
        const session =
          result && typeof result === "object" && "session" in result ? result.session : result;
        const state =
          session &&
          typeof session === "object" &&
          "url" in session &&
          typeof session.url === "string"
            ? session
            : undefined;
        const details =
          action === "tabs.list" || action === "history.list"
            ? {}
            : {
                browserSessionId: id,
                ...(state
                  ? {
                      url: state.url,
                      projectId:
                        "projectId" in state && typeof state.projectId === "string"
                          ? state.projectId
                          : projectId,
                    }
                  : {}),
              };
        if (
          command.type === "cdp" &&
          result &&
          typeof result === "object" &&
          "exceptionDetails" in result &&
          result.exceptionDetails &&
          typeof result.exceptionDetails === "object"
        ) {
          const failure = result.exceptionDetails;
          const exception = "exception" in failure ? failure.exception : undefined;
          const message =
            exception &&
            typeof exception === "object" &&
            "description" in exception &&
            typeof exception.description === "string"
              ? exception.description
              : "text" in failure && typeof failure.text === "string"
                ? failure.text
                : "JavaScript execution failed.";
          const location =
            "lineNumber" in failure && typeof failure.lineNumber === "number"
              ? ` (line ${failure.lineNumber + 1}${"columnNumber" in failure && typeof failure.columnNumber === "number" ? `, column ${failure.columnNumber + 1}` : ""})`
              : "";
          throw new Error(`${command.method}${location}: ${message.slice(0, 2048)}`);
        }
        if (action === "screenshot") {
          const file = result as BrowserFile;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  viewport: file.viewport,
                  capture: file.capture,
                  pixels: file.pixels,
                }),
              },
              { type: "image", mimeType: file.mimeType, data: file.data },
            ],
            details,
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify(result ?? { completed: true, sessionId: id }) },
          ],
          details,
        };
      },
    });
  };
}

const browserExtension: ExtensionFactory = (pi) =>
  createBrowserExtension(createBrowserHostResolver(pi))(pi);

export default browserExtension;
