---
name: pi-docs
description: Answer Pi coding agent and Pi Workbench questions using version-matched documentation, including setup, settings, providers, models, sessions, skills, extensions, packages, SDK integration, troubleshooting, and self-knowledge when "you" or "this app" refers to Pi Workbench. Use also when implementing Pi extensions or SDK integrations. Do not use for unrelated software tasks merely performed inside Pi.
---

# Pi Docs

Provide accurate, cited guidance for the user's Pi version and host. Follow the useful pattern of a documentation skill: find the authoritative source, read the relevant topic, then answer or implement. Read one primary document first; follow additional references only for unresolved parts of the task.

## Locate the running version's documentation

First read `runtime.json` beside this skill's `SKILL.md`. Workbench writes it when installing bundled resources, recording the embedded Pi `version`, `packageDir`, `readme`, `docs`, and `examples` as actual installation paths. Resolve the skill directory from the loaded skill's absolute path, not the current project directory.

- Use these paths even when the user's project has no Pi dependency. The global `pi` executable or a separate source checkout may run a different version.
- If the descriptor is missing or its paths are unavailable, use Pi documentation paths supplied in the current system context. If necessary, locate the host's installed `@earendil-works/pi-coding-agent` package and confirm its version before using its README, docs, examples, and public declarations.
- Do not assume a developer checkout, a fixed home directory, or repository sources exist in a packaged installation. Do not scan sessions, credentials, or unrelated user directories to find public documentation.
- If the running version cannot be established, the bundled extension references can still explain Pi 0.84.2; disclose that compatibility with the running host is unverified. For other documentation gaps, use the official-source fallback below. Do not install or upgrade Pi just to answer a documentation question.

## Choose the topic

Bare document paths below are relative to the descriptor's `docs` directory; linked references are bundled with this skill. For a narrow question, search the exact setting, command, event, symbol, or error in the matching document and read the surrounding section. Do not load the whole manual or examples tree.

| Request                                            | Primary document                                          | Follow only when needed                                                   |
| -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| What Pi is, setup, first use                       | `index.md` or `quickstart.md`                             | Descriptor's `readme`                                                     |
| Commands, CLI flags, context files, system prompts | `usage.md`                                                | `environment-variables.md`                                                |
| Settings, scope, defaults                          | `settings.md`                                             | `security.md` for project trust                                           |
| Authentication and built-in providers              | `providers.md`                                            | `models.md` for custom model configuration                                |
| Custom model endpoints or provider implementations | `models.md` or `custom-provider.md`                       | [Provider registration](references/extensions-providers.md)               |
| Extensions, hooks, tools, commands                 | [Extension reference topics](#extension-reference-topics) | Relevant example and public declarations                                  |
| Skill discovery, format, invocation                | `skills.md`                                               | Use the available `skill-creator` skill when creating a skill             |
| Reusable prompt commands                           | `prompt-templates.md`                                     | `packages.md` for distribution                                            |
| Install, update, distribute Pi packages            | `packages.md`                                             | The package's own manifest and docs                                       |
| Sessions, branches, resume                         | `sessions.md`                                             | `session-format.md` for persistence APIs                                  |
| Context limits and compaction                      | `compaction.md`                                           | `settings.md`                                                             |
| Embed Pi or manage AgentSession                    | `sdk.md`                                                  | Relevant file under `sdk/` in the examples directory; public declarations |
| Pi stdin/stdout RPC or JSON output                 | `rpc.md` or `json.md`                                     | `sdk.md` if embedding is the actual goal                                  |
| Terminal UI, themes, shortcuts                     | `tui.md`, `themes.md`, or `keybindings.md`                | `terminal-setup.md` or the relevant platform guide                        |

The example paths above are relative to the descriptor's `examples` directory. If a document is absent in this version, consult its `index.md` or README for the correct topic instead of inventing a path. A broad orientation can start from the README and follow its topic links.

## Extension reference topics

These references contain the complete **Pi 0.84.2** extension guide, split by topic with its API descriptions and code examples preserved. The original table of contents is replaced by the routes below. Read the matching reference directly instead of loading the full `extensions.md`; follow cross-links only when needed.

Compare `runtime.json`'s version first. When it differs, use that runtime's `docs/extensions.md` and public declarations as authoritative; these snapshots are navigation aids, not evidence for another version. Source ranges and release links are recorded in each file, with provenance in `NOTICE` and the upstream license in `LICENSE.pi`. External documentation and example links are pinned to that release; prefer their installed equivalents when available.

| Topic                                                                                                                                | Reference                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| First extension, discovery paths, imports, async factories, shutdown, errors, TUI/RPC/print modes                                    | [Getting started](references/extensions-getting-started.md)                  |
| Lifecycle ordering, project trust, resource discovery, session start/switch/fork/compact/tree/shutdown                               | [Lifecycle and session events](references/extensions-events-lifecycle.md)    |
| Agent/turn/message/tool execution events, context injection, provider request/response hooks, model and thinking changes             | [Agent and model events](references/extensions-events-agent.md)              |
| Intercept tool calls/results, custom input typing, user Bash, input transformation                                                   | [Tool, shell, and input events](references/extensions-events-tools-input.md) |
| `ExtensionContext`, cancellation, model/session access, context usage, compaction, persistent branch state                           | [Context and state](references/extensions-context.md)                        |
| `ExtensionCommandContext`, idle waits, new/fork/switch/tree/reload, replacement-session lifecycle                                    | [Command context](references/extensions-command-context.md)                  |
| Register tools/commands/renderers/shortcuts/flags, send messages, append entries, labels, execution, active tools, models, event bus | [ExtensionAPI methods](references/extensions-api.md)                         |
| Register/unregister providers, dynamic model refresh, authentication                                                                 | [Provider registration](references/extensions-providers.md)                  |
| Tool schema and execution contract, streaming results, termination, built-in overrides, remote execution, output truncation          | [Custom tools](references/extensions-tools.md)                               |
| `renderCall`, `renderResult`, rendering context, keybinding hints and fallbacks                                                      | [Tool rendering](references/extensions-tool-rendering.md)                    |
| Deferred tool loading, native model support, fallback discovery, search tool example                                                 | [Dynamic tool loading](references/extensions-dynamic-tools.md)               |
| Dialogs, timeout/cancellation, widgets, status, footer/header, autocomplete                                                          | [Dialogs and widgets](references/extensions-ui.md)                           |
| Custom TUI components, overlays, editor replacement, message/entry rendering, theme colors                                           | [UI components](references/extensions-ui-components.md)                      |
| Find an existing implementation by use case and key API                                                                              | [Example catalog](references/extensions-examples.md)                         |

## Distinguish Pi from its host

"You" and "this app" refer to the current Pi Workbench environment only when the conversation establishes that meaning. Pi's model/provider, the Pi coding agent, installed extensions, and the Workbench interface are separate sources of capabilities.

- Pi's terminal commands, themes, keybindings, and `ctx.ui` features are not automatically available in Workbench. Check the current host's exposed tools and command catalog before prescribing a terminal workflow in the GUI.
- Pi's `rpc.md` describes its stdin/stdout protocol, not Workbench's HTTP/WebSocket transport. Pi TypeScript extensions are distinct from Workbench frontend Slot/Panel/Command contributions.
- For Workbench-specific UI, automations, resource management, or transport behavior, use the current host capabilities and matching Workbench documentation. When its source repository is available, start with `packages/agent-runtime/runtimes/pi/README.md`; frontend extension guidance is in `docs/extensions.md`. Resolve these from the verified repository root, never from this installed skill directory.
- If Workbench sources or documentation are unavailable, explain the verified Pi behavior and the host-specific uncertainty. Do not infer that Pi lacks a capability merely because a host tool is absent, or claim the GUI exposes every SDK feature.

## Implementation and troubleshooting

For code, verify signatures against the installed package's `dist/index.d.ts` and referenced declarations. Packaged hosts may omit declarations; in that case use bundled SDK docs and matching upstream release sources, and disclose any unverified signature. Import supported APIs through public package exports; internal declaration files are for inspection, not deep imports. Match examples to the installed version and preserve a user-requested version or provider/model ID.

For discovery problems, inspect only the relevant resource and scope: user resources use `$PI_CODING_AGENT_DIR` when configured, otherwise `~/.pi/agent`; project resources use `.pi` and the documented trust rules. Check enabled filters and reported load errors before proposing reinstalls. Workbench owns `.builtin` resources; place user customizations outside those directories. Use a new session or `/reload` in an idle session when refresh is needed, not in the middle of the current agent's work.

## Official-source fallback and citations

For latest releases, migrations, or gaps in bundled docs, search the exact topic in official Pi sources and actually open the relevant page. Start with `https://pi.dev` and the upstream repository `https://github.com/earendil-works/pi`, whose coding-agent documentation lives under `packages/coding-agent/docs/`. Prefer a matching release tag when explaining an installed version; distinguish current upstream behavior from that version. A search snippet or unopened link is not evidence.

For current model pricing, provider availability, or account limits, use the provider's official documentation or an authorized live capability; Pi's model metadata is not proof of current billing or account access. Keep credentials out of output.

Cite the document and section actually read: an absolute local file link for bundled docs, or the precise official page for web sources. State material version mismatches and separate documented facts from implementation inferences. Answer in the user's language with the smallest useful example or next action; when documentation supports a larger implementation task, continue that task.
