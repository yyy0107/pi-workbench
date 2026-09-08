# Workbench Preferences

Use `domain: "workbench"` or omit `domain`. This domain does not accept `scope` or `expectedRevision`. Missing preferences use application defaults; top-level `null` removes an override, while `false` explicitly disables a boolean. Object and array preferences are replaced as a whole, so preserve other fields before sending an object patch. Open windows may need refreshing to show saved preferences.

## Preference fields

`describe` returns the saved `revision` and `preferences`. Updates put these fields directly in `patch`, not under a `preferences` wrapper.

| Request                                 | Field and supported values                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface language                      | `locale`: `en-US` or `zh-CN`                                                                                                                |
| New messages while the agent is working | `runningMessageMode`: `queue` or `steer`                                                                                                    |
| Show reasoning or todos                 | `showReasoning`, `showTodos`: boolean                                                                                                       |
| Group tool results                      | `groupParallelTools`, `groupExplorationTools`, `groupTerminalTools`, `groupFileChanges`: boolean                                            |
| Ask User tool and timed continuation    | `askUserEnabled`, `askUserAutoContinue`: boolean                                                                                            |
| Task management tool                    | `todoEnabled`: boolean; absent defaults to disabled                                                                                         |
| Native tool availability                | `readToolEnabled`, `bashToolEnabled`, `editToolEnabled`, `writeToolEnabled`, `grepToolEnabled`, `findToolEnabled`, `lsToolEnabled`: boolean |
| Enhanced search                         | `enhancedSearch`: boolean; also supplies defaults for grep/find when their explicit switches are absent                                     |
| Retain model I/O                        | `retainAllModelIO`: boolean                                                                                                                 |
| Built-in lifecycle extensions           | `messageTerminationExtensionEnabled`, `composerContextExtensionEnabled`, `contextTraceExtensionEnabled`: boolean                            |
| Sidebar visibility and sorting          | `sidebarOpen`: boolean; `sidebarThreadSortMode`: `priority`, `recent`, or `manual`                                                          |
| Remember model-picker choice            | `modelSelector`: `{ "modelId": "<verified picker ID>", "reasoningEffort": "<supported effort>" }`; effort is optional                       |

Tool switches and lifecycle-extension switches are read by the running host. Session construction preferences such as enhanced search and retained model I/O may need a new session or an idle `/reload`. Changing `modelSelector` only changes the UI's remembered selection; it does not switch the current session's model, configure a provider, or change Pi's global defaults. Do not invent model IDs or supported reasoning levels.

Other existing preferences include `toolboxPins`, `toolboxScope`, `backgroundImage`, `rightWorkspace`, and sidebar organization state. Preserve them unless requested. Workspace, thread, and toolbox IDs must come from the current host's catalog, not guessed names. `backgroundImage` reads omit image bytes; never write the returned metadata object back as if it were a complete image.

A language change needs only:

```json
{ "action": "update", "patch": { "locale": "zh-CN" } }
```

## Configuration domains and fallback

- Workbench preferences use this tool and the shared `workbench-settings.json` service. Its cross-process lock and atomic writes preserve workspace state and attachment-understanding secrets in other sections of the same file. Never read or overwrite the whole physical document to perform a preference change.
- Pi system prompts and compaction use this tool's separate `domain: "pi"`; read [pi-settings.md](pi-settings.md). Providers/models, authentication, skills/packages, project trust, and other Pi settings use `pi-docs` and their corresponding services. Do not put their settings into `appearance` or another arbitrary JSON preference.
- Browser localStorage is legacy migration input, not the authoritative settings store. Pi TUI themes and `pi` CLI flags do not configure Workbench's GUI.
- This Workbench version has no general `workbench config` CLI. Its Runtime CLI controls host startup. Do not invent a CLI command or assume the HTTP API is available to shell tools without host authentication.
- If `workbench_settings` is unavailable, explain that this host does not expose direct agent configuration and provide the exact UI setting the user can change. Do not obtain credentials, edit an assumed home-directory file, install a second Runtime, or claim a setting was changed.
