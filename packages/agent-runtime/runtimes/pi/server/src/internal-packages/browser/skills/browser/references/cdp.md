# CDP diagnostics

CDP requires full access to already be enabled by the user. Use it for authorized diagnostics; do not enable it or use JavaScript to bypass a blocked, hidden, disabled, or covered control.

Put the method and its protocol arguments together in the tool's `params` object:

```json
{"action":"cdp","sessionId":"<current-session>","params":{"method":"Runtime.evaluate","expression":"document.title","returnByValue":true}}
{"action":"cdp","sessionId":"<current-session>","params":{"method":"Page.getFrameTree"}}
```

The older shape `params: {"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}` also works. Use one shape per call; do not mix arguments beside `method` with arguments inside `params.params`.

`Runtime.evaluate` requires a JavaScript expression. Wrap multiple statements or a top-level `return` in an invoked function, for example `(() => { const title = document.title; return title; })()`. Prefer `returnByValue: true` for readable results. A JavaScript exception is a failed evaluation even when the browser connection is healthy.

Read the returned error before retrying. Fix invalid parameters or JavaScript syntax, and change the failed approach when another observation shows a different cause. Do not repeatedly send the same failed request or call the browser connection unreliable because a request was invalid. Navigate using URLs supplied by the user or observed on the page; do not guess login routes or hash fragments as recovery.

An unavailable, empty, or still-loading frame does not establish whether the user is signed in. Confirm account state through an explicit page indicator or the user before reporting it; missing snapshot content alone is insufficient.
