---
name: extension-creator
description: Create or update Pi TypeScript extensions for tools, commands, lifecycle hooks, providers, or terminal UI, and optionally scaffold a distributable Pi package. Use when the user asks to build a Pi extension or turn behavior into one. Workbench frontend Slot/Panel/Renderer contributions and Codex plugins use different platforms.
---

# Extension Creator

Build the requested Pi extension using the installed SDK and existing examples. The workflow follows a plugin creator's useful steps: choose the scope, generate a working starting point, implement the requested behavior, validate, then explain discovery and refresh. A generated echo/status example is a starting point, not completion of a requested feature.

## Choose the extension and destination

- Inspect the existing extension and nearby project instructions before editing. Update it directly rather than regenerating over user code.
- Use a Pi extension for executable tools, commands, event hooks, providers, and terminal rendering. For reusable instructions, use `skill-creator`; for a reusable text command, consider a Pi prompt template.
- A standalone Pi extension needs a TypeScript entry exporting a default `ExtensionAPI` factory. It does not require a Codex manifest, marketplace, hooks.json, or reinstall/cachebuster flow.
- Default standalone output is `<cwd>/.pi/extensions/<name>/index.ts`. Use `--user` for all projects, or `--path` for an explicit parent directory. Project discovery requires trust; do not change trust automatically.
- User scope comes from this skill's `runtime.json` (`userResourceDir`), with `$PI_CODING_AGENT_DIR` then `~/.pi/agent` as fallbacks when running an unbundled copy. Never infer user scope from a developer's home directory.
- Workbench-owned `.builtin` resources are read-only application assets. Create user extensions elsewhere. When explicitly modifying Workbench itself, use its existing internal extension registry and ownership rules instead of installing a second user copy.

## Scaffold with Python

The scripts require Python 3.10+ and its standard library. Resolve script paths from this skill's actual directory; use an available interpreter (`python3`, `python`, or `py -3`). Creating files does not install dependencies, register a package, publish, alter settings, or reload sessions.

```text
python3 <extension-creator-directory>/scripts/create_extension.py my-extension
python3 <extension-creator-directory>/scripts/create_extension.py text-helper --kind tool
python3 <extension-creator-directory>/scripts/create_extension.py session-status --kind event --user
python3 <extension-creator-directory>/scripts/create_extension.py my-extension --path <parent-directory>
python3 <extension-creator-directory>/scripts/create_extension.py my-extension --kind tool --package --path <repository>/packages
```

- Names normalize to lowercase hyphen-case, at most 64 characters; the resulting directory and package name match. Tool IDs use underscores in place of hyphens.
- `--kind command` (default) registers a command that echoes its arguments through a displayed custom message without triggering an LLM turn. `tool` registers a typed text-echo tool capped at 1,000 input characters to bound both output bytes and lines; `event` registers a guarded session-start notification.
- `--description` supplies the generated command/tool and package description. Edit generated user-facing text to fit the requested language and repository i18n conventions before handoff.
- Existing destinations are rejected, including symlinks. There is no overwrite switch; modify an existing extension deliberately. `.builtin` destinations are rejected.
- `--package` adds a `package.json` with `pi.extensions: ["./index.ts"]`, `pi-package` keywords, and relevant Pi-provided peer dependencies. Its default parent is `<cwd>/pi-packages`, outside automatic extension discovery. It starts with `private: true`; remove that only when publication is requested. `--user` is for standalone discovery, so it cannot be combined with `--package`.
- Add supporting modules, skills, prompts, dependencies, or assets only when the requested feature needs them. For a package, keep the Pi manifest consistent with actual files and read the matching `packages.md` through `pi-docs` before changing its packaging.

## Implement from the matching reference

Use `pi-docs` to compare the Runtime version with its bundled reference version. Read the relevant reference rather than the full extension manual:

| Work                                                       | Reference                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Factory, discovery, async startup, errors, supported modes | [Setup and modes](../pi-docs/references/extensions-getting-started.md)                                                                                                                                                   |
| Hooks and lifecycle cleanup                                | [Session events](../pi-docs/references/extensions-events-lifecycle.md), [agent events](../pi-docs/references/extensions-events-agent.md), or [tool/input events](../pi-docs/references/extensions-events-tools-input.md) |
| Schema, execution, cancellation, progress, truncation      | [Custom tools](../pi-docs/references/extensions-tools.md)                                                                                                                                                                |
| Commands, messages, registration, active tools             | [ExtensionAPI](../pi-docs/references/extensions-api.md)                                                                                                                                                                  |
| Session replacement, reload, context, persistent state     | [Command context](../pi-docs/references/extensions-command-context.md) and [context/state](../pi-docs/references/extensions-context.md)                                                                                  |
| Custom providers                                           | [Provider registration](../pi-docs/references/extensions-providers.md)                                                                                                                                                   |
| Terminal components, dialogs, tool rendering               | [UI](../pi-docs/references/extensions-ui.md), [components](../pi-docs/references/extensions-ui-components.md), or [tool rendering](../pi-docs/references/extensions-tool-rendering.md)                                   |
| Find an existing implementation                            | [Example catalog](../pi-docs/references/extensions-examples.md)                                                                                                                                                          |

Verify signatures and return shapes against the installed package's public declarations when available. Import from public package exports and reuse Pi's loader, session, tool-schema, and persistence APIs. Do not build a parallel extension host or copy upstream interfaces.

Keep factory initialization finite. Start timers, watchers, and connections in a session event or the action that needs them, and release them through idempotent `session_shutdown` cleanup. Use the event's documented return contract. Preserve cancellation, input validation, and error handling for operations that can lose data.

Use `ctx.mode` and `ctx.hasUI` appropriately. Pi TUI renderers do not create Workbench React components, and RPC mode does not guarantee every UI method is implemented by the host. For a Workbench feature, check its actual exposed commands/tools and UI bridge. Keep browser contributions in the Workbench extension platform.

## Bound every tool result

- Choose fields, range, or pagination before reading/returning data. Default to summaries; return affected fields and saved status after mutations instead of whole state snapshots.
- Read [Output Truncation](../pi-docs/references/extensions-tools.md#output-truncation) and compare its example with the installed SDK. Reuse public `truncateHead` / `truncateTail` and `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES` (50 KiB UTF-8 or 2,000 lines by default). Neither tool registration nor later compaction automatically bounds custom output. Do not modify Pi / pi-ai or deep-import a private output accumulator.
- Apply the budget to the combined text and added notices. Keep progress, errors, and `details` bounded too; never copy an oversized result into `details` to hide it from the text. The scaffold's small echo input is bounded by schema; generated/external data needs its own output handling.
- On overflow, return a marked preview/summary plus access to complete data through an existing readable source, pagination, or a private temporary file. Use valid JSON summaries for structured output, not broken JSON prefixes. Spill only the filtered, redacted result; protect sensitive files with a private directory and `0600` permissions. Give an absolute path and offset/limit guidance, or field/string-slice extraction for oversized single lines. Retain successful files after the call and clean incomplete writes on failure/cancellation.
- If an action already committed, preserve that success and its revision/status even when saving the output fails; suggest a focused read instead of repeating the mutation.

## Validate and finish

```text
python3 <extension-creator-directory>/scripts/validate_extension.py <extension-directory-or-entry>
python3 <extension-creator-directory>/scripts/validate_extension.py <extension-directory-or-entry> --load
```

The default check verifies a nonempty `.ts`/`.js` entry (or a directory's `index.ts`) and the generated single-entry package manifest when present. It is deliberately not a TypeScript parser or a general Pi-package validator. Multi-entry/glob manifests should be checked with Pi's package/resource APIs instead.

After reviewing the extension you authored, use `--load` to check it with the exact SDK and Node executable recorded in this skill's `runtime.json`. It executes the selected module and factory in a subprocess with temporary cwd/agent directories, avoids automatic discovery of unrelated extensions, and reports registered tools, commands, and events. **This is not a security sandbox.** It does not dispatch session events, invoke tools, typecheck the full extension, or prove behavior. It times out after 30 seconds. `--runtime` selects an explicit descriptor when testing outside the installed skill.

Run the smallest relevant behavior test for the feature, exercising its event/command/tool and an important failure case when applicable. Use the project's existing typecheck where available. Do not call model/provider services merely to validate registration.

For tools with nontrivial output handling, invoke the tool with small and oversized data; check UTF-8 bytes, line limits, valid structured summaries, and retrieval of the complete result. For file spill paths, also check long single lines, permissions, and failure/cancellation. Confirm that output errors do not conceal a committed mutation. `--load` alone does not verify any of these behaviors.

For auto-discovered extensions, a new session or `/reload` in an idle session picks up changes; never reload the currently running agent mid-task. For a package outside discovery directories, use the matching Workbench/Pi package installation flow in the authorized scope. Do not both auto-discover and package-install the same extension. A successful scaffold or load check does not mean the extension is installed or enabled in the user's session.

Report the actual files, registered IDs, implemented behavior, checks performed and their limits, and the appropriate next discovery/install step. Continue beyond scaffolding until the user's requested functionality is implemented.
