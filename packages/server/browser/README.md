# `@workbench/browser-server`

The shared browser engine for Workbench Web and Electron. The Runtime owns one lazily started
Chrome process and a dedicated persistent profile. Both clients display its page frames and send
input through the authenticated `/api/browser/ws` gateway; the Pi `workbench_browser` tool uses
the same `BrowserManager`. Session IDs reuse the same Chrome target and navigation history.

## Setup

Install Google Chrome or Chromium **on the machine running the Runtime**. The Runtime artifact
bundles this package's JavaScript, contracts, and Pi tool; it does not bundle a browser executable.
Electron also uses this Runtime-owned browser, so its bundled Chromium does not satisfy this
requirement.

The engine checks for Chrome/Chromium **123 or newer**. The complete integration test was verified
with Google Chrome **150.0.7871.181**. This minimum is a startup check; experimental WebMCP APIs and
Chrome's password-manager API depend on the installed browser version. Use a current full Chrome
build for the management pages and password import. A headless-shell-only binary lacks those
Chrome UI features.

Executable discovery checks:

- Linux: `google-chrome`, `google-chrome-stable`, `chromium`, and `chromium-browser` on `PATH`, then
  `/opt/google/chrome/chrome`.
- macOS: Google Chrome and Chromium under `/Applications`, then Chrome under `~/Applications`.
- Windows: Chrome under `PROGRAMFILES`, `PROGRAMFILES(X86)`, and `LOCALAPPDATA`, then `chrome.exe`
  and `chromium.exe` on `PATH`.

Set `WORKBENCH_BROWSER_EXECUTABLE` in the **Runtime process environment** to override discovery.
An absolute executable path is preferable; an explicit value replaces the default candidates.
For example, from the repository root:

```bash
WORKBENCH_BROWSER_EXECUTABLE=/usr/bin/google-chrome pnpm dev
```

Chrome runs in full headless mode with its normal sandbox and a private `--remote-debugging-pipe`.
It exposes no CDP listening port. The runtime account must be able to launch sandboxed Chrome and
write its state directory. A `browser-unavailable` error means executable discovery, Chrome
startup, the version check, or the browser connection failed. Update the executable/environment
and restart the Runtime when changing this setup.

## State and browser pages

The default state directory is `${PI_WORKBENCH_STATE_DIR}/browser`, or
`~/.pi/workbench/browser` when that environment variable is unset. The embedding API can supply
`new BrowserManager({ stateDirectory })` to choose the browser directory directly.

| Path             | Contents                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `profile/`       | Chrome-owned cookies, history, saved passwords, and browser preferences                    |
| `settings.json`  | Workbench browser preferences and agent permissions                                        |
| `downloads/`     | Default download destination; configurable with `downloadDirectory`                        |
| `downloads.json` | The last 1,000 completed Workbench download records                                        |
| `uploads/`       | Temporary uploaded files, removed when their browser tab closes or the manager is disposed |

The profile is separate from the user's normal Chrome profile. Password CSV data is passed to
Chrome's password manager and stored by Chrome; Workbench does not create a plaintext password
database. Session targets live in memory and can reconnect after a Chrome process failure;
the persistent profile survives Runtime restarts.

The `open-page` command opens the real Chrome history, downloads, password manager, addresses,
site settings, general settings, clear-browsing-data, download-settings, and import settings pages
in the existing Workbench tab. Ordinary address navigation accepts HTTP(S) and `about:blank`;
these internal destinations are selected through `open-page`. Settings and clearing actions apply
to the dedicated profile. Configure Workbench's download directory in Workbench Browser settings;
the Runtime applies that preference through CDP independently of Chrome's own download settings.
Chrome's clear-data page clears native browser history. Workbench download records are separate:
clear them in the Downloads dialog (`downloads.clear`). This user-only command preserves downloaded
files and in-progress downloads, and returns the remaining `BrowserDownload[]` list.

## Inputs, exports, and imports

- Up to 32 browser sessions share the manager. HTTP(S) URLs containing credentials are rejected.
  URL-based new-window links reuse the opener's Workbench tab after navigation permission checks.
- Frame `width` and `height` describe CSS input coordinates, including zoom, fit, and mobile page
  scale. They can differ from encoded PNG pixels. Map a point within the displayed image
  proportionally into those CSS dimensions, accounting for letterboxing.
- Live frames use lossless PNG and Chrome's native screencast, with compositor density 3.
  The viewport's optional `deviceScaleFactor` requests display density 1–3 (default 2), and also
  controls screenshot export density. Streams preserve aspect ratio within 3,840 pixels per edge
  and 3,840 × 2,160 pixels total. Native compositor density is the ceiling: at zoom 3, a 600-CSS-pixel
  panel receives up to 600 bitmap pixels across, while normal zoom receives 1,200 at density 2.
  Scrolling and input remain native Chrome operations; there is no screenshot polling loop.
- Screenshots return PNG; print returns PDF. `BrowserFile.viewport` describes the visible CSS
  input area, `capture` describes the image's CSS coverage, and `pixels` reports the encoded PNG dimensions. They match for a viewport
  screenshot. A full-page screenshot includes content outside the current viewport; scroll before
  clicking that content. Exported/read files are limited to 64 MiB. All screenshot captures reject
  dimensions above 16,384 bitmap pixels or an area above 50 million bitmap pixels.
- Cookie import accepts a JSON array or `{ "cookies": [...] }`, up to 10,000 cookies, with an
  HTTP(S) `url` or a `domain`. Common export fields such as `expirationDate`, `hostOnly`, and
  `sameSite: "no_restriction"` are supported. Invalid domains, control characters, mismatched
  URL/domain pairs, and insecure `SameSite=None` cookies are rejected.
- Password import accepts CSV with `url,username,password` columns, or the corresponding
  `login_uri,login_username,login_password` columns. `note`/`notes` is optional; quoted commas and
  newlines are preserved. It accepts up to 10,000 rows, HTTP(S) URLs, and nonempty passwords.
  Import commands allow at most 8 Mi characters, with a further 10 MiB UTF-8 parser limit.
- Uploads target an intercepted HTML file input and require its `requestId`. Commands accept up
  to 20 files, at most 12 Mi base64 characters per file, and 64 MiB of decoded data in total.
  Browser WebSocket requests have a 16 MiB total JSON limit, which can impose a lower limit.
- Chrome initially stores downloads under GUID names so the engine can locate them reliably.
  `download.read` returns the suggested filename and file contents. `downloadDirectory` accepts
  an absolute path or `~/...`; an empty setting uses `downloads/` above. `askDownloadLocation`
  emits a file event for the client save dialog after completion.

## Agent permissions and API

```ts
import { BrowserManager } from "@workbench/browser-server";

const abortController = new AbortController();
const browser = new BrowserManager({ stateDirectory: "/path/to/browser-state" });
const unsubscribe = browser.subscribe((event) => {
  // Forward states, frames, permission prompts, dialogs, and file events to the client.
});

await browser.handle(
  { type: "attach", sessionId: "example", projectId: "/workspace", url: "https://example.com" },
  { source: "agent", signal: abortController.signal },
);

const tabs = await browser.handle(
  { type: "tabs.list", projectId: "/workspace" },
  { source: "agent", signal: abortController.signal },
);
const snapshot = await browser.handle(
  { type: "snapshot", sessionId: "example" },
  { source: "agent", signal: abortController.signal },
);

unsubscribe();
browser.dispose();
```

Model callers must pass `source: "agent"`; the installed Pi host binding fixes this source and
forwards its cancellation signal. An omitted source represents an interactive user operation.
Agent navigation, history, download, and upload permissions default to `ask`, with global and
HTTP(S)-origin-specific `allow`/`ask`/`deny` overrides. Approval requests expire after 120 seconds;
aborting the agent removes pending approvals and prevents a later Allow from resuming the action.
Standard agent commands cannot change settings, answer approval prompts, or import cookies/passwords.
Their internal page access is limited to history and downloads, with the relevant permissions.

`fullCdpAccess` defaults to `false`. Enabling it exposes arbitrary CDP methods through `cdp` after
the navigation permission check, including powerful access to the dedicated browser profile.
The regular commands retain their action-specific checks.

`tabs.list` lists only existing controlled tabs with the exact requested `projectId`. It does not
launch Chrome or discover the user's other browser windows. `snapshot` returns a bounded native
accessibility tree with the current session, a snapshot ID, roles, names, control states, and
optional element references. Empty layout wrappers are omitted without dropping their children.
An optional `query` filters accessible names by case-insensitive substring before the output limits,
so a known target beyond the first 1,000 unfiltered nodes remains searchable. It does not search
input values; frame markers remain to expose unavailable content. Password values are omitted. At most 1,000 nodes and approximately
64 Ki characters of accessible text are returned; `truncated` indicates omitted content. Pages
that have not reached DOM readiness after a one-second wait return `browser-page-loading`.

Use `{ type: "click", sessionId, x, y }` for one complete native left click at viewport CSS
coordinates observed in a current screenshot. Coordinates outside the viewport are rejected.
Map displayed image coordinates proportionally to `viewport`; do not change zoom or device
settings for conversion. Do not mix `ref` and coordinates.

Use observed references with `{ type: "click", sessionId, ref }` or
`{ type: "fill", sessionId, ref, text }`. Both use native Chrome input, check navigation permission,
and work while unrestricted CDP access is disabled. Fill replaces an editable element's contents;
an empty string clears it. Click checks visibility, disabled state, and whether another element
covers its target. References belong to one tab and its latest snapshot. Navigation, document
replacement, a newer snapshot, or removing an element makes its references stale. Recover from
`browser-element-stale` or `browser-element-not-interactable` by observing the page again before
choosing the next action. Same-origin embedded frames are traversed and their refs support ordinary click/fill.
Cross-origin, sandbox-isolated, and separate-target frames remain marked `unavailable: "frame"`. Local development pages should be
served over HTTP(S); ordinary navigation does not accept `file:` URLs.

Website tools have global and per-origin switches. The launched Chrome enables
`WebMCP,WebMCPTesting`; `site-tools.list`/`site-tools.call` use the current
`document.modelContext.getTools()`/`executeTool()` APIs with a fallback to older
`navigator.modelContextTesting` APIs. A page must register tools, and the installed Chrome must
support those APIs; otherwise listing returns no tools. See [Chrome's WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp).

For package verification from the repository root:

```bash
pnpm --filter @workbench/browser-server typecheck
pnpm exec node --import ./scripts/register-typescript-test-loader.mjs --test packages/server/browser/test/browser.test.ts
```

The integration test launches an isolated temporary Chrome profile and a local HTTP fixture.
It skips the Chrome test when no executable is installed; the full WebMCP coverage requires a
current browser with the APIs described above.
