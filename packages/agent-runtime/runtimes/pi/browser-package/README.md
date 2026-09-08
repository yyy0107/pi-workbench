# Browser for Pi

`@workbench/pi-browser` is a Pi package containing the `workbench_browser` tool and the `browser` skill. It works in Workbench and in standalone Pi CLI, using the same browser engine and command contracts.

In Workbench, the package connects to the existing in-app browser and its permission UI. In standalone Pi, it lazily starts an isolated headless Chrome or Chromium instance for the current Pi session. Standalone mode does not open a visible browser window or attach to the user's normal Chrome, Edge, or Workbench profile.

## Install locally

From the Workbench repository, build the package and install its directory into Pi:

```bash
pnpm --filter @workbench/pi-browser build
pi install /absolute/path/to/workbench-ui/packages/agent-runtime/runtimes/pi/browser-package
```

Pi records local directory packages by path. Keep the directory available after installation. Start a new Pi session, or run `/reload` in an idle session, to load the extension and skill. Workbench already consumes this same package as a built-in capability; a second manual installation there is unnecessary.

To create a distributable local archive, run from this package directory:

```bash
pnpm pack --pack-destination /absolute/path/to/artifacts
```

The `prepack` script builds the extension. The archive includes the compiled `dist/` entry, the skill, and this README. Extract the archive and install its resulting package directory with `pi install /absolute/path/to/extracted/package`. This does not require publishing to a registry.

The package targets the Pi extension API verified with `@earendil-works/pi-coding-agent` 0.85.1. Pi provides its SDK, `pi-ai`, and TypeBox; the distributable includes the Workbench browser engine and its internal dependencies.

## Chrome or Chromium is required

Install Google Chrome or Chromium **123 or newer on the machine running Pi or the Workbench Runtime**. The package does not download or bundle a browser executable. Workbench Electron also uses the Runtime browser engine, so Electron's embedded Chromium does not replace this dependency.

The engine discovers common Chrome/Chromium executables on Linux, macOS, and Windows. To choose an executable explicitly, set `WORKBENCH_BROWSER_EXECUTABLE` in the process environment before starting Pi:

```bash
WORKBENCH_BROWSER_EXECUTABLE=/usr/bin/google-chrome pi
```

Chrome runs headlessly with its normal sandbox and a private debugging pipe. It exposes no remote debugging port. A `browser-unavailable` error can indicate that the executable is missing, too old, cannot start with its sandbox, or disconnected. Use a current full Chrome build for Chrome management pages and experimental website tools; a headless-shell-only executable lacks some of those features.

## Use the tool and skill

Ask Pi to use Browser, or invoke `/skill:browser` with your task. The skill explains how to choose a tab, observe the page, act on the current snapshot, and verify the result.

| Operation                                   | Tool arguments                                     |
| ------------------------------------------- | -------------------------------------------------- |
| List this project's tabs                    | `action: "tabs.list"`                              |
| Create a tab with an unused ID              | `action: "attach", sessionId, url`                 |
| Navigate an existing tab                    | `action: "navigate", sessionId, url`               |
| Inspect page content and element references | `action: "snapshot", sessionId`                    |
| Click an observed element                   | `action: "click", sessionId, params: { ref }`      |
| Fill an observed editable element           | `action: "fill", sessionId, params: { ref, text }` |
| Capture the viewport                        | `action: "screenshot", sessionId`                  |

Use the returned tab `id` as `sessionId`. Omitting `sessionId` selects the Pi conversation's fixed default tab, not the user's currently focused Workbench tab. `attach` reuses an existing ID without navigating it, even when a URL is provided. Use `navigate` to change an existing page and a distinct ID to create another tab.

Snapshots return `{ session, snapshotId, nodes, truncated }`. Node references belong to that tab's latest snapshot. Another snapshot, navigation, an in-page route change, or disconnection invalidates earlier references. The current snapshot does not expand embedded frame content and marks frame nodes as unavailable; use screenshots and coordinate input to interact with content inside frames.

Local websites must be served over HTTP. Reuse the project's development server, or serve a standalone HTML directory through a loopback-only static server limited to the project. Direct `file:` URLs are unsupported; Workbench file-preview endpoints do not provide a site's origin and relative asset layout.

## Screenshots and terminal output

A screenshot returns a PNG image content block plus text containing viewport and capture dimensions in CSS pixels. Pi forwards that image result to the model. The call does not automatically write an image file, open an image viewer, or create a visible browser window.

Pi can also display the image inline when the terminal supports its image protocol and `terminal.showImages` is enabled. Plain terminals may not display the image inline. The model's image content and the terminal's ability to render it are separate concerns.

Mouse input uses viewport-relative CSS coordinates, which can differ from the PNG's pixel dimensions. Scale positions from the displayed screenshot into the reported viewport. A full-page capture also contains offscreen document content; scroll to the target and capture the viewport before clicking coordinates there.

## Permissions and session lifetime

Model operations always use the browser engine's agent permission checks. Workbench shows its existing permission prompts. Standalone Pi uses its dialog-capable UI to confirm requests that require approval, showing the requested action and origin. Rejection, cancellation, or an unavailable dialog UI never grants permission. Noninteractive Pi modes cannot automatically approve an `ask` decision.

Standalone Pi uses a separate state directory for each session instance so its Chrome profile cannot collide with Workbench or another Pi process. Browser tabs and login state belong to that isolated browser. The adapter closes its browser and cancels pending interactions when the Pi session shuts down, reloads, or is replaced. It does not close Workbench's shared browser.

The first tool call reports the directory in a `browser-session` event. It is located under Pi's agent directory at `browser/<session-id>/active-<process-id>-<unique-id>/`, respecting `PI_CODING_AGENT_DIR`. Each instance gets a fresh directory; reloading or resuming a session does not reuse an earlier browser profile. State files remain after shutdown so Chrome can finish exiting safely. They can be removed after the corresponding browser process has stopped.

File chooser requests, browser errors, and completed or canceled downloads appear as `browser-event` messages. A file chooser event includes the `requestId` used by `upload`; standalone mode does not supply Workbench's native file picker. Downloads use the browser's configured destination, which defaults to the isolated state's `downloads/` directory. File notifications report names and media types, rather than embedding downloaded file data into the conversation.

Page dialogs are distinct from permission prompts: `dialog.respond` answers a page alert, confirmation, or prompt. It cannot grant navigation, download, upload, or history access. Full CDP access is disabled by default; ordinary snapshots, clicking, filling, navigation, and screenshots do not require it.

Standalone mode has no Workbench sign-in window and does not import another browser's authentication. If a site requires authentication that cannot be completed in the current host, report that limitation instead of claiming access or silently substituting a different site.
