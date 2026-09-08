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
  command(command: BrowserCommand, signal?: AbortSignal): Promise<unknown>;
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
    pi.registerTool({
      name: "workbench_browser",
      label: "workbench_browser",
      description:
        "Control Workbench's in-app browser or this Pi session's isolated headless browser. Read the browser skill before browser work. Use tabs.list to discover tabs in the current project, then reuse the returned id as sessionId. Attach creates or reuses a tab; its optional HTTP(S) url applies only to a new tab. Use navigate to change an existing tab. Omitting sessionId uses this conversation's fixed default tab, not the user's focused tab. Snapshot returns {session,snapshotId,nodes,truncated}; use observed node refs with click params:{ref} or fill params:{ref,text}. Refs belong to one tab and its latest snapshot; take another snapshot after navigation or a stale-ref error. Permissions and per-site overrides are enforced by the host, and approval requests use the host UI. Screenshot returns an image plus viewport and capture dimensions in CSS pixels, not bitmap pixels. Input x/y are viewport-relative CSS pixels: for a viewport screenshot displayed at W×H, use x=imageX*viewport.width/W and y=imageY*viewport.height/H. Full-page screenshots use document coordinates; scroll and capture the viewport before coordinate input. Input params.event accepts {kind:'text',text}, {kind:'mouse',type:'mousePressed'|'mouseReleased'|'mouseMoved'|'mouseWheel',x,y,button?,deltaX?,deltaY?}, or {kind:'key',type:'keyDown'|'keyUp',key,code}. Find params: {text,backwards?}. Viewport params: {width,height,visible,zoom?,fitToWidth?,device?:{width,height,mobile}}. Open-page params.page may be history or downloads. Upload params: {requestId,files:[{name,mimeType,data:base64}]}. Dialog.respond params: {accept,text?}, for page dialogs only. Download params.downloadId selects a prior download. Site-tools.call params: {name,arguments}; discover names with site-tools.list. CDP params: {method,params}, available only when the user enables full CDP access in Browser settings. Never change permissions or bypass a denied action.",
      promptSnippet:
        "Control the browser; read the browser skill first, then observe and act with snapshots.",
      parameters: Type.Object({
        action: StringEnum(actions),
        sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        url: Type.Optional(Type.String({ maxLength: 8192 })),
        params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
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
        const command = parseBrowserCommand({
          ...params,
          type: action,
          ...(action === "tabs.list" ? {} : { sessionId: id }),
          ...(url === undefined ? {} : { url }),
          ...(action === "attach" || action === "tabs.list" ? { projectId } : {}),
        });
        if (!command) throw new Error("Invalid browser command parameters.");
        const result = await browser.command(command, signal);
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
          action === "tabs.list"
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
        if (action === "screenshot") {
          const file = result as BrowserFile;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ viewport: file.viewport, capture: file.capture }),
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
