# Observe and interact with a page

- Call `action: "snapshot"` with `sessionId` to read the page's accessibility snapshot. Its `nodes` describe roles, accessible names, values, and states. Actionable nodes include a `ref`.
- Empty layout wrappers are omitted, while their children remain. Use `params: {"query":"target name"}` for a case-insensitive substring search of accessible names across the available frame trees, before truncation. This does not search input values or scroll the page. Frame markers remain so unavailable content is explicit. An empty result does not establish absence from an unavailable frame or content that the site has not loaded.
- Click with `action: "click", params: {"ref":"<observed-ref>"}`. Fill an editable field with `action: "fill", params: {"ref":"<observed-ref>","text":"<requested-text>"}`. Derive references from the current snapshot; do not guess them from labels or previous pages.
- Semantic actions, dragging, and agent `input`/CDP mouse events move the real pointer along a paced curve with acceleration and deceleration. Workbench displays the same positions and held-button state. Cancellation or user takeover stops the movement. Prefer observed-ref actions for page interaction; JavaScript `element.click()` or `element.focus()` inside `Runtime.evaluate` does not move the pointer.
- Repeated snapshots and same-document routes preserve existing element references. Document navigation, element removal, disconnection, and eviction after 10,000 retained refs invalidate affected references. After a stale-reference error, take a fresh snapshot before acting again. Check the resulting page state after an action rather than assuming success from the click alone. A fresh reference does not fix an element that is hidden, disabled, or covered: inspect the cause instead of repeating the same click.
- Snapshots include same-origin embedded frame content available in the current browser target. Use its observed refs with ordinary `click` and `fill`. Cross-origin frames, frames isolated by a sandbox, and frames in a separate browser target remain marked `unavailable: "frame"`.

Example sequence, with values taken from actual tool results:

```json
{"action":"snapshot","sessionId":"<current-session>"}
{"action":"fill","sessionId":"<current-session>","params":{"ref":"<field-ref>","text":"search terms"}}
{"action":"click","sessionId":"<current-session>","params":{"ref":"<button-ref>"}}
{"action":"snapshot","sessionId":"<current-session>","params":{"query":"expected result"}}
```

Named tools use direct arguments: `browser_fill({ref, value})`, `browser_select_option({ref, label})`, `browser_set_checked({ref, checked})`, and `browser_fill_form({fields:[{ref,value}]})`. A CSS selector plus optional observed `frameId` is an alternative to a ref. Selects require exactly one of `value`, `label`, or `index`; custom dropdowns use ordinary clicks. Use `browser_focus` + `browser_type` to insert at the caret, `browser_press_key` for native shortcuts, and `browser_dispatch_key` only for an element-specific synthetic event. Password field results omit their value.
