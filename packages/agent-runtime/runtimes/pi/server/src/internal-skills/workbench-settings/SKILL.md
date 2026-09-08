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

1. Choose the domain and scope from the relevant reference, then call `action: "describe"`.
2. Send only requested keys with `action: "update"` and `patch`. Workbench object preferences require merging with current values; Pi updates require the returned revision as `expectedRevision`. Follow the domain's reset rules and never send an entire old snapshot back.
3. Read back using the same domain and scope, then report saved values and when they apply. Do not restart, refresh, or reload an active task.

A request to inspect settings does not authorize changes; an explicit change request needs no repeated confirmation. After a conflict or uncertain failure, read before retrying and preserve intervening changes. If the tool is unavailable, explain the limitation and give the corresponding UI setting; do not edit an assumed settings file or claim success. Unsupported Pi settings belong to `pi-docs` and their corresponding services.
