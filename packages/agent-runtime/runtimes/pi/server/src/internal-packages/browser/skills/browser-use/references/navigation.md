# Tabs, navigation, and local sites

Workbench conversations and projects share one persistent browser profile: login cookies, site storage, and browsing history are shared. Browser session IDs identify separate tabs with their own page and back/forward stack. Switching conversations or closing a tab does not clear the profile; reuse existing site authentication instead of assuming every conversation needs a new login.

1. Call `action: "tabs.list"` to inspect the current project's existing tabs. Use a matching tab's returned `id` as `sessionId` for later calls. Listing tabs does not grant permission to read unrelated pages, and the list does not identify the user's currently selected Workbench tab. If the user only identifies a current tab and several tabs could match, clarify the target before changing a page.
2. To open a new tab, call `action: "attach"` with an HTTP(S) `url` and a distinct `sessionId` that is absent from the list. Omitting `sessionId` uses the Pi conversation's fixed default tab; it does not select the currently focused Workbench tab or create a fresh tab on every call.
3. `attach` reuses an existing session without navigating it, even if `url` is supplied. To change an existing page, use `action: "navigate"` with its `sessionId` and the requested `url`.
4. Links and searches that open a native popup create a separate browser session and leave the original tab available. After such a click, call `action: "tabs.list"`, identify the new page by its URL or title, and use its returned `id` for subsequent snapshots and interactions. Do not repeat the click or navigate the original tab just because its URL did not change; the new page may depend on its opener's preload data.

For example, after confirming that the chosen session ID is unused, open a page with:

```json
{ "action": "attach", "sessionId": "browser-example-task-1", "url": "https://example.com/" }
```

Use the returned `id` and current snapshot references, not the example values below. A closed or missing tab requires selecting or attaching a current session; it does not require restarting the browser or host. In Workbench, tool results can reveal the tab in the background while preserving the user's current selection; do not claim the UI focused a tab merely because a call succeeded.

## Local sites

- Open local apps through their existing development server. For standalone HTML, use a static server bound to loopback with its served directory limited to the project, then navigate to its HTTP URL. Direct `file:` navigation is unsupported. Workbench `/api/*` file-preview endpoints are not a substitute for a site's own origin and relative asset paths.

## Profile history

- Read recent profile history with `action: "history.list"`. Optional `params: {"query":"search text","limit":50}` searches titles and URLs across the profile, returning `[{url,title,time}]`; the default limit is 50 and maximum is 100. History access still uses the browser history permission. It does not require a tab ID or full CDP access.
