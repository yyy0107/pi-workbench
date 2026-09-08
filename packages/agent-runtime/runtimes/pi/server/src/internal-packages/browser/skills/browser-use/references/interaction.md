# Observe and interact with a page

- Call `action: "snapshot"` with `sessionId` to read the page's accessibility snapshot. Its `nodes` describe roles, accessible names, values, and states. Actionable nodes include a `ref`.
- Click with `action: "click", params: {"ref":"<observed-ref>"}`. Fill an editable field with `action: "fill", params: {"ref":"<observed-ref>","text":"<requested-text>"}`. Derive references from the current snapshot; do not guess them from labels or previous pages.
- Semantic `click` and `fill` move the browser's real pointer to the target first, keeping page hover behavior and the displayed pointer position in sync. Prefer these observed-ref actions for page interaction. JavaScript `element.click()` or `element.focus()` inside `Runtime.evaluate` does not move the pointer; raw `input` actions send the exact events requested.
- A new snapshot replaces earlier references. Navigation, route changes within the page or an observed child frame, or disconnection also invalidate them. After a stale-reference error, take a fresh snapshot before acting again. Check the resulting page state after an action rather than assuming success from the click alone. A fresh reference does not fix an element that is hidden, disabled, or covered: inspect the cause instead of repeating the same click.
- Snapshots include same-origin embedded frame content available in the current browser target. Use its observed refs with ordinary `click` and `fill`. Cross-origin frames, frames isolated by a sandbox, and frames in a separate browser target remain marked `unavailable: "frame"`.

Example sequence, with values taken from actual tool results:

```json
{"action":"snapshot","sessionId":"<current-session>"}
{"action":"fill","sessionId":"<current-session>","params":{"ref":"<field-ref>","text":"search terms"}}
{"action":"snapshot","sessionId":"<current-session>"}
{"action":"click","sessionId":"<current-session>","params":{"ref":"<button-ref>"}}
{"action":"screenshot","sessionId":"<current-session>"}
```
