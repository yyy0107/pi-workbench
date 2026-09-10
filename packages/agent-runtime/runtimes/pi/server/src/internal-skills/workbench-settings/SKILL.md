---
name: workbench-settings
description: Inspect or change the current Pi Workbench app's preferences and exposed Pi agent settings, including appearance, language, tool switches, user or project system prompts, and user-level compaction. For providers, credentials, or other Pi settings, use pi-docs.
---

# Workbench Settings

Use `workbench_settings` in the current Runtime. `domain: "workbench"` (default) manages UI preferences; `domain: "pi"` manages exposed Pi agent settings. No CLI, file-path discovery, or HTTP credentials are needed.

## Read only the relevant reference

- Appearance, theme, fonts, colors, or animation: [appearance.md](references/appearance.md).
- Language, conversation behavior, tools, sidebar, model-picker memory, or configuration troubleshooting: [preferences.md](references/preferences.md).
- Pi system prompts, additional instructions, or automatic compaction: [pi-settings.md](references/pi-settings.md).

## Apply the request

1. To list available settings, use the reference tables without reading saved state. To inspect values, call `action: "describe"` with `keys` containing only relevant top-level fields, e.g. `["locale"]`, `["appearance"]`, or Pi `["compaction"]`. Scope defaults to `user`; `project` is Pi-only. Without `keys`, describe returns a compact overview and lists excluded fields in `omittedKeys`; omission does not mean a setting is unset.
2. Send only requested keys with `action: "update"` and `patch`. A scalar Workbench change such as `{"locale":"en-US"}` needs no preliminary read. Workbench object preferences require reading that key and merging with current values; Pi updates require the returned revision as `expectedRevision`. Follow the domain's reset rules and never send an entire old snapshot back.
3. Updates return persisted values for the affected fields (and `resetKeys` for removed Workbench overrides). Use this result to report saved values and when they apply; no extra describe call is needed after success. Do not restart, refresh, or reload an active task.
4. Any result exceeding Pi's 50 KiB UTF-8 or 2,000-line budget returns `truncated: true`, the revision, and `fullOutputPath` instead of inline values. The private temporary file contains the complete selected JSON, with the same background-image/credential exclusions. Use `read` with offset/limit for relevant sections; if a JSON string exceeds a line's byte budget, use `bash` to extract the needed field or string slice. Do not dump the entire file back into context. If `outputError` is returned, the settings operation completed but output storage failed or was cancelled; inspect narrower keys if needed and do not repeat the update.

A request to inspect settings does not authorize changes; an explicit change request needs no repeated confirmation. After a conflict or uncertain failure, read before retrying and preserve intervening changes. If the tool is unavailable, explain the limitation and give the corresponding UI setting; do not edit an assumed settings file or claim success. Unsupported Pi settings belong to `pi-docs` and their corresponding services.
