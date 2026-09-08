# Pi Agent Settings

Use `workbench_settings` with `domain: "pi"`. It delegates to Workbench's existing `pi.agent` settings service; it does not expose every field in Pi's `settings.json`.

## Scope and reads

- `scope: "user"` is the default and targets this Runtime's Pi user directory, including a configured `PI_CODING_AGENT_DIR`.
- `scope: "project"` targets the registered workspace matching the current conversation's working directory. The tool resolves its authoritative workspace ID and the service writes that project's `.pi` directory. A missing workspace is an error, never a fallback to user scope. It does not configure another project by name or accept a filesystem path.
- Use project scope only for an explicitly project-specific request. Saving does not grant project trust; Pi's normal trust rules still control whether project resources load.

Read the chosen scope first:

```json
{ "action": "describe", "domain": "pi", "scope": "user" }
```

The result contains `ns: "pi.agent"`, the resolved `target`, `revision`, `value`, `user`, `base`, and `applies`. `user` contains explicit overrides in the selected scope. `value` contains its prompt strings and compaction values; empty prompt strings mean no local prompt override. For a project, `base` contains inherited user settings. Do not mistake an empty project prompt for the absence of an inherited prompt.

## Supported patches

| Field                         | Values                                                                           | Scope           |
| ----------------------------- | -------------------------------------------------------------------------------- | --------------- |
| `systemPrompt`                | String, at most 500,000 characters; replaces the scope's custom system prompt    | User or project |
| `appendSystemPrompt`          | String, at most 500,000 characters; replaces the scope's additional instructions | User or project |
| `compaction.enabled`          | Boolean                                                                          | User only       |
| `compaction.reserveTokens`    | Integer, 1–10,000,000                                                            | User only       |
| `compaction.keepRecentTokens` | Integer, 1–10,000,000                                                            | User only       |

Prompt strings replace existing content. If the user asks to add an instruction, preserve the existing instructions and append the requested text. Pi chooses the project's append file over the user's append file; they are not automatically concatenated. `systemPrompt: ""` or `appendSystemPrompt: ""` removes that scope's override and restores inheritance/default behavior. Unlike Workbench preference resets, Pi patches do not accept `null`.

Compaction patches merge only supplied subfields and preserve unrelated Pi settings. To restore a compaction field's default value, use the corresponding value from a user-scope read's `base.compaction`. This sets an explicit value; the tool does not delete individual compaction overrides. Model context capacity and maximum output tokens are separate settings and are not controlled by these fields.

## Write and verify

Every Pi update requires `expectedRevision` from the latest read of the **same scope**. Revisions are opaque numbers, not counters to increment or values to guess. In the examples below, replace `123456` with the actual returned revision.

Disable automatic compaction for this Runtime's user settings:

```json
{
  "action": "update",
  "domain": "pi",
  "scope": "user",
  "expectedRevision": 123456,
  "patch": { "compaction": { "enabled": false } }
}
```

After a project-scope read, set the project's additional instructions:

```json
{
  "action": "update",
  "domain": "pi",
  "scope": "project",
  "expectedRevision": 123456,
  "patch": { "appendSystemPrompt": "Run the relevant targeted checks before finishing changes." }
}
```

A stale revision rejects the write. Read again, reconcile the user's requested change with the new content, and retry with that revision; never drop the revision to force an overwrite. Unknown fields, invalid values, and project compaction updates fail before saving. Never retry a failed project request as user scope.

Read back with the same domain and scope to verify persistence. Pi settings report `applies: "restart"`: they take effect in a new session or after `/reload` in an idle session. Do not reload the currently running agent or claim its system prompt/compaction behavior has already changed. This tool does not change providers, credentials, model selection, skills/packages, or trust decisions; use `pi-docs` and the corresponding host capabilities for those tasks.
