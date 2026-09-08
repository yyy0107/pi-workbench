import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseBrowserCommand, type BrowserFile } from "@workbench/browser-contracts";
import { getPiAgentHostBindings } from "../../agent-runtime/pi-agent-host-bindings";

const actions = [
  "attach",
  "navigate",
  "back",
  "forward",
  "reload",
  "stop",
  "close",
  "screenshot",
  "copy",
  "input",
  "find",
  "viewport",
  "open-page",
  "downloads.list",
  "download.cancel",
  "upload",
  "site-tools.list",
  "site-tools.call",
  "cdp",
] as const;

export const browserExtension: ExtensionFactory = (pi) => {
  if (!getPiAgentHostBindings().browser) return;
  pi.registerTool({
    name: "workbench_browser",
    label: "workbench_browser",
    description:
      "Operate the built-in Workbench browser. First attach with an optional HTTP(S) url; reuse the returned sessionId. Permissions and per-site overrides are enforced by the host, and approval requests appear in Workbench. Use screenshot to see the page. Input params.event accepts {kind:'text',text}, {kind:'mouse',type:'mousePressed'|'mouseReleased'|'mouseMoved'|'mouseWheel',x,y,button?,deltaX?,deltaY?}, or {kind:'key',type:'keyDown'|'keyUp',key,code}. Screenshot results include the CSS viewport and capture size; map screenshot positions proportionally into capture coordinates. Full-page captures require scrolling before clicking targets outside the viewport. Find params: {text,backwards?}. Viewport params: {width,height,visible,zoom?,fitToWidth?,device?:{width,height,mobile}}. Open-page params.page may be history or downloads. Upload params: {requestId,files:[{name,mimeType,data:base64}]}. Download params.downloadId selects a prior download. Site-tools.call params: {name,arguments}; discover names with site-tools.list. CDP params: {method,params}, available only when the user enables full CDP access in Browser settings. Never change permissions or bypass a denied action.",
    promptSnippet: "Browse and interact with pages in Workbench, respecting browser permissions.",
    parameters: Type.Object({
      action: Type.Union(actions.map((action) => Type.Literal(action))),
      sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      url: Type.Optional(Type.String({ maxLength: 8192 })),
      params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, { action, sessionId, url, params }, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const browser = getPiAgentHostBindings().browser;
      if (!browser) throw new Error("The built-in browser is unavailable in this host.");
      const id = sessionId ?? `workbench-${ctx.sessionManager.getSessionId()}`;
      const command = parseBrowserCommand({
        ...params,
        type: action,
        sessionId: id,
        ...(url === undefined ? {} : { url }),
        ...(action === "attach" ? { projectId: ctx.cwd } : {}),
      });
      if (!command) throw new Error("Invalid browser command parameters.");
      const result = await browser.command(command, signal);
      const state =
        result && typeof result === "object" && "url" in result && typeof result.url === "string"
          ? result
          : undefined;
      const details = {
        browserSessionId: id,
        ...(state ? { url: state.url, projectId: ctx.cwd } : {}),
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
