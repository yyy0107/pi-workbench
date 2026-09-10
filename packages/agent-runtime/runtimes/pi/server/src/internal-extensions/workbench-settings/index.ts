import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { truncateHead, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  PI_AGENT_SETTINGS_NAMESPACE,
  type PiResourceCatalogTarget,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import { getPiAgentHostBindings } from "../../agent-runtime/pi-agent-host-bindings";
import { AgentSettingsService } from "../../settings/agent-settings-service";
import { scopedUpdatePayload } from "../../transport/agent-settings-rpc-validators";
import { getWorkspaceStore } from "../../workspaces/workspace-registry";
import { validateWorkspace } from "../../workspaces/workspace-paths";

const WORKBENCH_STATE_KEYS = [
  "rightWorkspace",
  "sidebarExpandedWorkspaceIds",
  "sidebarSelectedThreadId",
  "sidebarThreadOrderByScope",
  "toolboxScope",
];
const PI_PROMPT_KEYS = ["systemPrompt", "appendSystemPrompt"];

/** Default reads are an overview; large values require an explicit field selection. */
function selectSettingsFields(value: object, keys?: string[], omitByDefault: string[] = []) {
  const entries = Object.entries(value);
  const omittedKeys = keys
    ? []
    : entries
        .filter(
          ([key, value]) => omitByDefault.includes(key) || JSON.stringify(value).length > 4_000,
        )
        .map(([key]) => key);
  return {
    value: Object.fromEntries(
      entries.filter(([key]) => (keys ? keys.includes(key) : !omittedKeys.includes(key))),
    ),
    omittedKeys,
  };
}

async function settingsToolResult(
  result: { revision: number; applies?: string },
  signal?: AbortSignal,
) {
  const text = JSON.stringify(result, null, 2);
  const truncation = truncateHead(text);
  if (!truncation.truncated) {
    return { content: [{ type: "text" as const, text }], details: result };
  }

  // Preserve valid JSON and the committed revision; never duplicate oversized values in details.
  const summary = {
    revision: result.revision,
    ...(result.applies ? { applies: result.applies } : {}),
    truncated: true,
    truncatedBy: truncation.truncatedBy,
    totalBytes: truncation.totalBytes,
    totalLines: truncation.totalLines,
  };
  let directory: string | undefined;
  let output;
  try {
    directory = await mkdtemp(join(tmpdir(), "pi-workbench-settings-"));
    const fullOutputPath = join(directory, "result.json");
    await writeFile(fullOutputPath, text, { encoding: "utf8", mode: 0o600, signal });
    output = {
      ...summary,
      fullOutputPath,
      message:
        "Settings operation completed. Full JSON is in fullOutputPath. Use read with offset/limit; for a very long JSON string, use bash to extract a field or string slice. Do not repeat an update to retrieve its output.",
    };
  } catch {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    output = {
      ...summary,
      outputError:
        "Settings operation completed, but saving the full result failed or was cancelled. Describe fewer keys to inspect the saved state; do not repeat the update.",
    };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], details: output };
}

export const workbenchSettingsExtension: ExtensionFactory = (pi) => {
  if (!getPiAgentHostBindings().workbenchSettings) return;
  const piSettings = new AgentSettingsService();
  pi.registerTool({
    name: "workbench_settings",
    label: "workbench_settings",
    description:
      "Read or update settings in the current Workbench host. For available settings, read the workbench-settings skill references; no settings read is needed just to list options. Describe returns a compact overview; use keys to read only relevant top-level fields, including omittedKeys when needed. Default domain workbench updates UI preferences with shallow patches (null resets). Domain pi supports systemPrompt, appendSystemPrompt, showCacheMissNotices and user-level compaction; Pi updates require the revision from describe. Scope defaults to user; project is Pi-only and targets this conversation's registered workspace. Updates return only affected fields; no extra readback is needed. Results exceeding Pi's 50 KiB or 2000-line limit return a summary and fullOutputPath to the complete JSON. Pi changes apply in a new session or after an idle /reload. Does not configure providers, credentials or project trust. Background images return metadata only; UI changes may need a window refresh.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("describe"), Type.Literal("update")]),
      domain: Type.Optional(Type.Union([Type.Literal("workbench"), Type.Literal("pi")])),
      scope: Type.Optional(
        Type.Union([Type.Literal("user"), Type.Literal("project")], {
          description: "Defaults to user in both domains. Project is supported only for domain pi.",
        }),
      ),
      keys: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
          minItems: 1,
          maxItems: 50,
          description:
            "Describe only: top-level field names, e.g. [locale], [appearance], or Pi [compaction, appendSystemPrompt]. Unmatched fields are omitted. Without keys, prompts, window state and values over 4000 characters are omitted and listed in omittedKeys.",
        }),
      ),
      patch: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            "Update only: requested top-level settings, without a preferences/value wrapper. Workbench object fields replace the whole object: read that key and merge first. Pi compaction merges supplied subfields.",
        }),
      ),
      expectedRevision: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "Required only for Pi updates: revision from describe.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(
      _toolCallId,
      { action, domain = "workbench", scope, keys, patch, expectedRevision },
      signal,
      _onUpdate,
      ctx,
    ) {
      signal?.throwIfAborted();
      const settings = getPiAgentHostBindings().workbenchSettings;
      if (!settings) throw new Error("Workbench settings are unavailable in this host.");
      if (action === "describe" && (patch !== undefined || expectedRevision !== undefined)) {
        throw new Error("Use the update action to apply a patch or expectedRevision.");
      }
      if (action === "update" && !patch) throw new Error("Updating settings requires a patch.");
      if (action === "update" && keys !== undefined)
        throw new Error("keys is only supported for describe; updates return the patched fields.");
      const selectedKeys = action === "update" ? Object.keys(patch!) : keys;
      if (domain === "pi") {
        let target: PiResourceCatalogTarget = { scope: "user" };
        if (scope === "project") {
          const cwd = validateWorkspace(ctx.cwd).cwd;
          const workspace = (await getWorkspaceStore().list()).items.find(
            (entry) => entry.path === cwd,
          );
          if (!workspace)
            throw new Error("The current conversation has no registered project workspace.");
          target = { scope: "project", workspaceId: workspace.workspaceId };
        }
        signal?.throwIfAborted();
        let snapshot;
        if (action === "update") {
          if (expectedRevision === undefined)
            throw new Error("Describe Pi settings first and pass its expectedRevision.");
          const parsed = scopedUpdatePayload({
            ns: PI_AGENT_SETTINGS_NAMESPACE,
            target,
            patch,
            expectedRevision,
          });
          if (!parsed.ok) {
            throw new TypeError(
              `Invalid Pi settings: ${parsed.issues.map((issue) => issue.path.join(".")).join(", ")}`,
            );
          }
          if (!isDeepStrictEqual(parsed.value.patch, patch)) {
            throw new TypeError(
              "Unsupported Pi settings field. Use systemPrompt, appendSystemPrompt, showCacheMissNotices, or compaction.enabled/reserveTokens/keepRecentTokens.",
            );
          }
          snapshot = await piSettings.update(parsed.value);
        } else {
          snapshot = (await piSettings.describe(target)).namespaces.find(
            (entry) => entry.ns === PI_AGENT_SETTINGS_NAMESPACE,
          );
        }
        if (!snapshot) throw new Error("Pi agent settings are unavailable in this host.");
        const { ns, revision, value, user, base, applies } = snapshot;
        const selected = selectSettingsFields(value, selectedKeys, PI_PROMPT_KEYS);
        const inherited = selectSettingsFields(base ?? {}, selectedKeys, PI_PROMPT_KEYS);
        const result = {
          ns,
          target,
          revision,
          value: selected.value,
          base: inherited.value,
          overriddenKeys: Object.keys(user ?? {}),
          omittedKeys: [...new Set([...selected.omittedKeys, ...inherited.omittedKeys])],
          applies,
        };
        return settingsToolResult(result, signal);
      }
      if (scope === "project" || expectedRevision !== undefined) {
        throw new Error("Project scope and expectedRevision are only supported for domain pi.");
      }
      if (action === "update") {
        await settings.update({ patch: patch! });
      }
      const snapshot = await settings.describe();
      const { backgroundImage, ...preferences } = snapshot.preferences;
      const selected = selectSettingsFields(
        {
          ...preferences,
          ...(backgroundImage
            ? {
                backgroundImage: { name: backgroundImage.name, mimeType: backgroundImage.mimeType },
              }
            : {}),
        },
        selectedKeys,
        WORKBENCH_STATE_KEYS,
      );
      const result = {
        revision: snapshot.revision,
        preferences: selected.value,
        omittedKeys: selected.omittedKeys,
        ...(action === "update"
          ? { resetKeys: selectedKeys!.filter((key) => !Object.hasOwn(selected.value, key)) }
          : {}),
      };
      return settingsToolResult(result, signal);
    },
  });
};
