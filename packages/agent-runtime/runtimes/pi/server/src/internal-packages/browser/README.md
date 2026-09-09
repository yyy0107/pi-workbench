# Browser for Pi

`@workbench/pi-browser` is a Pi package containing 40 `browser_*` tools, the compatible `workbench_browser` tool, and the `browser-use` skill. It works in Workbench and in standalone Pi CLI, using the same browser engine and command contracts.

In Workbench, the package uses the browser selected in **Settings → Browser → Browser connection**: the persistent in-app browser (default), or an existing Chrome connection with a selected user Profile. Both modes share the existing browser surfaces and permission UI. In standalone Pi, it lazily starts an isolated headless Chrome or Chromium instance for the current Pi session. Standalone mode does not open a visible browser window or attach to the user's normal Chrome, Edge, or Workbench profile.

## Install locally

From the Workbench repository, install its source directory into Pi:

```bash
pi install /absolute/path/to/workbench-ui/packages/agent-runtime/runtimes/pi/server/src/internal-packages/browser
```

Pi records local directory packages by path. Keep the directory available after installation. Start a new Pi session, or run `/reload` in an idle session, to load the extension and skill. The source manifest loads `index.ts`, so a reload uses the latest source without a build. Workbench deploys and registers the same package at `packages/.builtin/browser` under its Pi agent directory; a second manual installation there is unnecessary.

To create a distributable local archive, run from this package directory:

```bash
pnpm pack --pack-destination /absolute/path/to/artifacts
```

The `prepack` script builds a complete package in `dist/`. The archive contains its compiled `index.js`, manifest, skill, and this README. Extract the archive and install its resulting package directory with `pi install /absolute/path/to/extracted/package`. This does not require publishing to a registry.

The package targets the Pi extension API verified with `@earendil-works/pi-coding-agent` 0.85.1. Pi provides its SDK, `pi-ai`, and TypeBox; the distributable includes the Workbench browser engine and its internal dependencies.

## Chrome or Chromium is required

Install Google Chrome or Chromium **123 or newer on the machine running Pi or the Workbench Runtime**. The package does not download or bundle a browser executable. Workbench Electron also uses the Runtime browser engine, so Electron's embedded Chromium does not replace this dependency.

The engine discovers common Chrome/Chromium executables on Linux, macOS, and Windows. To choose an executable explicitly, set `WORKBENCH_BROWSER_EXECUTABLE` in the process environment before starting Pi:

```bash
WORKBENCH_BROWSER_EXECUTABLE=/usr/bin/google-chrome pi
```

Chrome runs headlessly with its normal sandbox and a private debugging pipe. It exposes no remote debugging port. A `browser-unavailable` error can indicate that the executable is missing, too old, cannot start with its sandbox, or disconnected. Use a current full Chrome build for Chrome management pages and experimental website tools; a headless-shell-only executable lacks some of those features.

## Connect existing Chrome in Workbench

Close all Workbench browser tabs, select **Existing Chrome**, and use **Apply and connect**. The engine connects only to loopback HTTP/WebSocket browser debugger endpoints; it never stops the external Chrome process. Enable remote debugging in Chrome and accept its own connection prompt first. An empty endpoint discovers `DevToolsActivePort` or port 9222; an explicit endpoint can be an HTTP debugging origin or a `/devtools/browser/…` WebSocket URL.

For a Chrome launched with debugging flags, use a dedicated user data directory and `--remote-debugging-port=9222`; recent Chrome versions restrict debugging the default directory through command-line flags. See [Chrome remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port). The setting connects to a browser that is already running; it does not launch a replacement Chrome with a copied profile.

Profile discovery reads Chrome/Chromium/Edge/Brave metadata on the runtime computer. An optional absolute user data directory supports custom installations. Refresh the list, select the Profile, and apply. A temporary native window marker verifies the chosen Profile; subsequent tabs are created from an owned blank window in that Profile, preserving its login state. Workbench manages only its owned tabs and window, and leaves unrelated existing Chrome tabs intact. Switching connection/Profile requires closing Workbench tabs first. A failed connection remains editable and can be retried.

## Named browser tools

The 40 `browser_*` entries follow the supplied pi-browser-harness catalog and use the existing Workbench engine, without another browser daemon or automation dependency. Their schemas describe exact arguments.

| Purpose                 | Tools                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup and navigation    | `browser_setup`, `browser_navigate`, `browser_open_urls`, `browser_go_back`, `browser_go_forward`, `browser_reload`                                                                                                           |
| Tabs                    | `browser_list_tabs`, `browser_current_tab`, `browser_switch_tab`, `browser_new_tab`, `browser_close_tab`                                                                                                                      |
| Observation             | `browser_snapshot`, `browser_page_info`, `browser_screenshot`                                                                                                                                                                 |
| Forms and input         | `browser_click`, `browser_fill`, `browser_fill_form`, `browser_select_option`, `browser_set_checked`, `browser_focus`, `browser_type`, `browser_press_key`, `browser_dispatch_key`, `browser_scroll`, `browser_drag_and_drop` |
| Waits and dialogs       | `browser_wait`, `browser_wait_for`, `browser_wait_for_load`, `browser_handle_dialog`                                                                                                                                          |
| Files and viewport      | `browser_upload_file`, `browser_download`, `browser_print_to_pdf`, `browser_viewport_resize`                                                                                                                                  |
| Diagnostics and scripts | `browser_console`, `browser_network_requests`, `browser_http_get`, `browser_execute_js`, `browser_run_script`                                                                                                                 |
| Research                | `browser_web_search`, `browser_read_page`                                                                                                                                                                                     |

Named tools select a conversation-local current tab. Both `browser_list_tabs` and legacy `tabs.list` return only the current conversation's tabs, including user-created tabs and native popups. `scope:"all"` retains the same conversation boundary; `includeInternal:false` omits Chrome management pages. The host supplies the conversation ID and rejects attempts to inspect, switch, attach to, or close another conversation's tab, even with an explicit `sessionId` or `targetId`. Batch opening returns per-URL results and synchronizes successful tabs to the workspace. Legacy `workbench_browser` keeps its fixed-default selection for compatibility.

Form actions support stable refs and CSS selectors (optionally with an observed `frameId`). Native setters and bubbling input/change events support controlled fields, selects, checkboxes, radios, and contenteditable. Password values are redacted. Batch form filling reports individual failures and never submits automatically. Mutations append a compact `pageChanges` diff when a full prior snapshot is available, prioritizing the target ref, dialogs and controls before changing text. Element clicks also return `target.connected` and `target.visible` after native dispatch, or `target.unavailable` if navigation prevents verification. These are observations, not a claim that the user's task succeeded.

`browser_navigate({url, query?})` creates the default tab if necessary, navigates, waits for document load and returns the snapshot in one model turn. `includeSnapshot:false` keeps navigation alone; `timeout` bounds readiness waiting. When navigation succeeds but observation is unavailable, the result preserves navigation metadata and explains the observation failure. Explicit snapshots remain available for later page changes.

Console and network filters accept substrings or `/regex/flags` with a bounded execution time. Redirects retain separate records. Results are bounded per tab and support `sinceSeq`/`nextCursor`, filters, optional bounded response bodies, and overflow reporting. HTTP GET runs outside Chrome without its cookies. URL-based reading and Google search use temporary tabs, close them on success/error/cancellation, and preserve the selected page. Google CAPTCHA/consent failures are reported explicitly. Article extraction returns a marked fallback when no clear article can be extracted.

JavaScript and local script execution require the user's full CDP setting. A script must be an absolute file inside the project or OS temporary directory after resolving symlinks. Its worker has Node.js access and a CDP bridge, with a hard timeout even for synchronous loops. This is trusted local code execution, not a sandbox. Bindings include `params`, `daemon.session().call(method, params)`, `daemon.evaluateJs(expression)`, `require`, `signal`, `onUpdate`, and `ctx.cwd`; return `{ content: [{ type: "text", text: "…" }], details: {} }`.

## Use the tool and skill

Ask Pi to use Browser, or invoke `/skill:browser` with your task. The skill explains how to choose a tab, observe the page, act on the current snapshot, and verify the result.

| Operation                                   | Tool arguments                                     |
| ------------------------------------------- | -------------------------------------------------- |
| List this conversation's tabs               | `action: "tabs.list"`                              |
| Create a tab with an unused ID              | `action: "attach", sessionId, url`                 |
| Navigate an existing tab                    | `action: "navigate", sessionId, url`               |
| Inspect page content and element references | `action: "snapshot", sessionId`                    |
| Click an observed element                   | `action: "click", sessionId, params: { ref }`      |
| Fill an observed editable element           | `action: "fill", sessionId, params: { ref, text }` |
| Capture the viewport                        | `action: "screenshot", sessionId`                  |

Use the returned tab `id` as `sessionId`. Omitting `sessionId` selects the Pi conversation's fixed default tab, not the user's currently focused Workbench tab. `attach` reuses an existing ID without navigating it, even when a URL is provided. Use `navigate` to change an existing page and a distinct ID to create another tab.

Snapshots return `{ session, snapshotId, nodes, truncated }`. Element references stay stable within a tab and document, including repeated/filtered snapshots and same-document routes. Document navigation, removal of a referenced element, disconnection, or eviction after 10,000 retained refs requires observing again. Snapshots include same-origin embedded frames available in the current browser target, and their refs support ordinary `click` and `fill`. Cross-origin frames, frames isolated by a sandbox, and separate-target frames remain marked `unavailable: "frame"`; use screenshots and coordinate input when the selected model supports image input. Missing frame content does not establish whether the user is signed in.

Agent mouse movement uses a shared trajectory algorithm: a lightly curved path, distance-dependent duration, and smooth acceleration/deceleration with an exact endpoint. Semantic actions, dragging, and agent `input`/CDP mouse events use this path; native mouse events and the visible Workbench pointer advance together. Dragging preserves the held buttons and displays the pressed pointer state. Cancellation or user takeover stops the remaining movement before a pending click. Direct user input stays immediate. JavaScript `element.click()` or `element.focus()` does not move the pointer; prefer the browser interaction tools.

When the user has already enabled full access, CDP arguments can use the flat form `params: { method: "Runtime.evaluate", expression: "document.title", returnByValue: true }` or the older nested form `params: { method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } }`. Mixing forms is rejected. `Runtime.evaluate` requires a non-empty expression; wrap statements containing `return` in an invoked function. Browser protocol errors retain their method and original diagnostic, and JavaScript exceptions become failed Pi tool results.

Local websites must be served over HTTP. Reuse the project's development server, or serve a standalone HTML directory through a loopback-only static server limited to the project. Direct `file:` URLs are unsupported; Workbench file-preview endpoints do not provide a site's origin and relative asset layout.

## Screenshots and terminal output

A screenshot returns a PNG or JPEG image content block plus text containing viewport and capture dimensions in CSS pixels. Inspecting that image requires a model with image input; a text-only model should use text snapshots and cannot infer coordinates or claim visual confirmation from it. The call does not automatically write an image file, open an image viewer, or create a visible browser window.

Pi can also display the image inline when the terminal supports its image protocol and `terminal.showImages` is enabled. Plain terminals may not display the image inline. The model's image content and the terminal's ability to render it are separate concerns.

Mouse input uses viewport-relative CSS coordinates, which can differ from the encoded bitmap's pixel dimensions. Scale positions from the displayed screenshot into the reported viewport. Agent screenshots, including `snapshot` with `includeScreenshot`, default to JPEG quality 80 with a 1600-pixel longest edge. `browser_screenshot` supports explicit `format`, JPEG `quality`, and `maxDim`; native CDP scaling bounds the bitmap without changing the page viewport. A full-page capture also contains offscreen document content; scroll to the target and capture the viewport before clicking coordinates there. The Workbench panel scales frames locally while the agent controls the tab, then applies its latest size when control ends; explicit zoom and device changes still apply.

Ordinary pages use the available viewport width divided by the selected zoom as their CSS layout width. Responsive sites can reflow in a narrow Workbench panel; fixed-width pages can scroll horizontally. Zoom continues to control the displayed size. Device previews retain their chosen dimensions, while DPR affects image sharpness without widening the CSS layout.

`action: "history.list"` reads recent entries from this browser profile as `[{url,title,time}]`. Optional `params: {query,limit}` searches titles and URLs across the profile history; the default limit is 50 and maximum is 100. This action requires the history permission and does not need a tab ID or full CDP access.

## Permissions and session lifetime

Ordinary HTTP(S) navigation does not require browser permission; the agent can follow links within the user's requested task without a navigation approval prompt. Operations such as downloads, uploads, and reading history still use the browser engine's agent permission checks. Workbench shows its existing permission prompts. Standalone Pi uses its dialog-capable UI to confirm requests that require approval, showing the requested action and origin. Rejection, cancellation, or an unavailable dialog UI never grants permission. Noninteractive Pi modes cannot automatically approve an `ask` decision.

Standalone Pi uses a separate state directory for each session instance so its Chrome profile cannot collide with Workbench or another Pi process. Browser tabs and login state belong to that isolated browser. The adapter closes its browser and cancels pending interactions when the Pi session shuts down, reloads, or is replaced. It does not close Workbench's shared browser. Browser control indicators persist across tool calls and automatic continuations, then clear when the run is canceled, fully settles, or the session shuts down or reloads; clearing an indicator does not cancel a page command.

The first tool call reports the directory in a `browser-session` event. It is located under Pi's agent directory at `browser/<session-id>/active-<process-id>-<unique-id>/`, respecting `PI_CODING_AGENT_DIR`. Each instance gets a fresh directory; reloading or resuming a session does not reuse an earlier browser profile. State files remain after shutdown so Chrome can finish exiting safely. They can be removed after the corresponding browser process has stopped.

File chooser requests, browser errors, and completed or canceled downloads appear as `browser-event` messages. A file chooser event includes the `requestId` used by `upload`; standalone mode does not supply Workbench's native file picker. Downloads use the browser's configured destination, which defaults to the isolated state's `downloads/` directory. File notifications report names and media types, rather than embedding downloaded file data into the conversation.

Page dialogs are distinct from permission prompts: `dialog.respond` answers a page alert, confirmation, or prompt. It cannot grant download, upload, or history access. Full CDP access is disabled by default; ordinary snapshots, clicking, filling, navigation, and screenshots do not require it.

Standalone mode has no Workbench sign-in window and does not import another browser's authentication. If a site requires authentication that cannot be completed in the current host, report that limitation instead of claiming access or silently substituting a different site.
