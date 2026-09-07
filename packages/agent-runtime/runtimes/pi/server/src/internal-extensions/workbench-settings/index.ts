import { isDeepStrictEqual } from "node:util";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
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

export const workbenchSettingsExtension: ExtensionFactory = (pi) => {
  if (!getPiAgentHostBindings().workbenchSettings) return;
  const piSettings = new AgentSettingsService();
  pi.registerTool({
    name: "workbench_settings",
    label: "workbench_settings",
    description:
      "Read or update settings in the current Workbench host. Read the workbench-settings skill first. Default domain workbench updates UI preferences with shallow patches (null resets). Domain pi supports systemPrompt, appendSystemPrompt and user-level compaction; Pi updates require the revision from describe. Pi scope project targets this conversation's registered workspace, never the global fallback. Pi changes apply in a new session or after an idle /reload. Does not configure providers, credentials or project trust. Workbench background image reads return metadata only; UI changes may need a window refresh.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("describe"), Type.Literal("update")]),
      domain: Type.Optional(Type.Union([Type.Literal("workbench"), Type.Literal("pi")])),
      scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")])),
      patch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    executionMode: "sequential",
    async execute(
      _toolCallId,
      { action, domain = "workbench", scope, patch, expectedRevision },
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
              "Unsupported Pi settings field. Use systemPrompt, appendSystemPrompt, or compaction.enabled/reserveTokens/keepRecentTokens.",
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
        const result = { ns, target, revision, value, user, base, applies };
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      }
      if (scope !== undefined || expectedRevision !== undefined) {
        throw new Error("scope and expectedRevision are only supported for domain pi.");
      }
      if (action === "update") {
        const result = await settings.update({ patch: patch! });
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      }
      const snapshot = await settings.describe();
      const { backgroundImage, ...preferences } = snapshot.preferences;
      const result = {
        revision: snapshot.revision,
        preferences: {
          ...preferences,
          ...(backgroundImage
            ? {
                backgroundImage: { name: backgroundImage.name, mimeType: backgroundImage.mimeType },
              }
            : {}),
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
};
