"use client";

import { useState } from "react";
import type { DataMessagePartComponent } from "@assistant-ui/react";
import { ScanSearchIcon } from "lucide-react";

import { field, mono } from "@/components/elements/surfaces";
import { ToolCall } from "@/components/elements/tool-call";
import { useI18n } from "@/i18n";
import { parsePiContextTraceData } from "@/runtime/pi/client/context-trace/data-part";
import type {
  SessionContextTraceEventSummary,
  SessionContextTracePromptResources,
  SessionContextTraceSystemPromptSourceSummary,
} from "@/runtime/pi/contracts/rpc";

import { contextTraceEventLabel } from "./context-trace-event-label";

const SYSTEM_PROMPT_SOURCE_KINDS = new Set(["builtin", "replacement", "append"]);
const SYSTEM_PROMPT_SOURCE_SCOPES = new Set(["builtin", "user", "project", "temporary"]);

function isSystemPromptSource(
  value: unknown,
): value is SessionContextTraceSystemPromptSourceSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.kind === "string" &&
    SYSTEM_PROMPT_SOURCE_KINDS.has(source.kind) &&
    typeof source.scope === "string" &&
    SYSTEM_PROMPT_SOURCE_SCOPES.has(source.scope) &&
    (source.path === undefined || typeof source.path === "string")
  );
}

function promptResources(
  event: SessionContextTraceEventSummary,
): SessionContextTracePromptResources | undefined {
  const resources = event.promptResources;
  if (
    !resources ||
    !Array.isArray(resources.skills) ||
    !Array.isArray(resources.extensions) ||
    !resources.tools ||
    !Array.isArray(resources.tools.active)
  ) {
    return undefined;
  }
  return {
    ...resources,
    systemPromptSources: Array.isArray(resources.systemPromptSources)
      ? resources.systemPromptSources.filter(isSystemPromptSource)
      : [],
    contextFiles: Array.isArray(resources.contextFiles)
      ? resources.contextFiles.filter(
          (filePath): filePath is string => typeof filePath === "string" && filePath.length > 0,
        )
      : [],
  };
}

export const ContextTraceMessagePart: DataMessagePartComponent = ({ data }) => {
  const { number, t } = useI18n();
  const [open, setOpen] = useState(false);
  const parsed = parsePiContextTraceData(data);
  if (!parsed || parsed.event.kind !== "prompt-composition") return null;

  const event = parsed.event;
  const resources = promptResources(event);
  const visibleExtensions = resources?.extensions.filter((extension) => !extension.hidden) ?? [];
  const rows = resources
    ? [
        {
          label: t("extensions.contextTrace.messagePart.systemPromptSources"),
          value:
            resources.systemPromptSources
              .map((source) => {
                const identity = `${t(
                  `extensions.contextTrace.systemPromptSourceKinds.${source.kind}`,
                )} · ${t(`extensions.contextTrace.systemPromptSourceScopes.${source.scope}`)}`;
                return source.path ? `${identity}\n${source.path}` : identity;
              })
              .join("\n\n") || t("extensions.contextTrace.none"),
        },
        {
          label: t("extensions.contextTrace.messagePart.systemPromptCharacters"),
          value: number(resources.systemPromptCharacters),
        },
        {
          label: t("extensions.contextTrace.skills"),
          value:
            resources.skills.map((skill) => skill.name).join(", ") ||
            t("extensions.contextTrace.none"),
        },
        {
          label: t("extensions.contextTrace.messagePart.extensions"),
          value:
            visibleExtensions.map((extension) => extension.name).join(", ") ||
            t("extensions.contextTrace.none"),
        },
        {
          label: t("extensions.contextTrace.messagePart.activeTools"),
          value: resources.tools.active.join(", ") || t("extensions.contextTrace.none"),
        },
        {
          label: t("extensions.contextTrace.contextFiles"),
          value: resources.contextFiles.join("\n\n") || t("extensions.contextTrace.none"),
        },
      ]
    : [];

  return (
    <div data-slot="pi-context-trace-timeline-step" className="w-full">
      <ToolCall
        label={contextTraceEventLabel(t, event.kind)}
        activeLabel={contextTraceEventLabel(t, event.kind)}
        query=""
        request=""
        result=""
        requestLabel=""
        resultLabel=""
        icon={ScanSearchIcon}
        iconClassName="size-4"
        running={false}
        showCompletionIcon={false}
        expandable={rows.length > 0}
        open={rows.length > 0 && open}
        onOpenChange={setOpen}
      >
        {rows.length > 0 ? (
          <dl className={`${field} divide-foreground/10 divide-y rounded-2xl px-3.5`}>
            {rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="text-foreground/45 text-xs">{row.label}</dt>
                <dd
                  className={`${mono} text-foreground/80 max-w-[70%] whitespace-pre-wrap break-words text-right`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </ToolCall>
    </div>
  );
};
