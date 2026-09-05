"use client";

import { useState } from "react";
import { ScanSearchIcon } from "lucide-react";

import type { DataRendererComponent } from "@workbench/extension-sdk";
import { field, mono } from "@workbench/shell/ui";
import { ToolCall } from "@workbench/shell/elements";
import { Button } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import {
  parsePiContextTraceData,
  usePiContextTraceClient,
} from "@workbench/agent-runtime-pi-client/context-trace";
import type {
  SessionContextTraceEventSummary,
  SessionContextTracePromptResources,
  SessionContextTraceSystemPromptSourceSummary,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import { contextTraceSystemPromptCapture } from "./context-trace-detail-selection";

const SYSTEM_PROMPT_SOURCE_KINDS = new Set(["builtin", "replacement", "append", "extension"]);
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
    (source.path === undefined || typeof source.path === "string") &&
    (source.hook === undefined || source.hook === "before_agent_start") &&
    (source.handlerIndex === undefined ||
      (typeof source.handlerIndex === "number" &&
        Number.isInteger(source.handlerIndex) &&
        source.handlerIndex >= 0))
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
    cwd: typeof resources.cwd === "string" ? resources.cwd : undefined,
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

type SystemPromptContentState =
  | { traceId: string; status: "loading" | "error" }
  | { traceId: string; status: "ready"; text: string };

export const ContextTraceMessagePart: DataRendererComponent = ({ block }) => {
  const { number, t } = usePiI18n();
  const traceClient = usePiContextTraceClient();
  const [open, setOpen] = useState(false);
  const [systemPromptContent, setSystemPromptContent] = useState<SystemPromptContentState>();
  const parsed = parsePiContextTraceData(block.data);
  if (!parsed || parsed.event.kind !== "prompt-composition") return null;

  const event = parsed.event;
  const resources = promptResources(event);
  const visibleExtensions = resources?.extensions.filter((extension) => !extension.hidden) ?? [];
  const systemPromptSources =
    resources?.systemPromptSources
      .map((source) => {
        const identity = `${t(
          `extensions.contextTrace.systemPromptSourceKinds.${source.kind}`,
        )} · ${t(`extensions.contextTrace.systemPromptSourceScopes.${source.scope}`)}`;
        return source.path ? `${identity}\n${source.path}` : identity;
      })
      .join("\n\n") ?? "";
  if (parsed.promptInjection === "workspace" || parsed.promptInjection === "skills") return null;
  const section = parsed.promptInjection;
  const presentation = {
    "system-prompt": {
      query: t("extensions.contextTrace.messagePart.systemPromptInjected"),
      rows: resources
        ? [
            ...(systemPromptSources
              ? [
                  {
                    label: t("extensions.contextTrace.messagePart.systemPromptSources"),
                    value: systemPromptSources,
                  },
                ]
              : []),
            ...(resources.systemPromptCharacters > 0
              ? [
                  {
                    label: t("extensions.contextTrace.messagePart.systemPromptCharacters"),
                    value: number(resources.systemPromptCharacters),
                  },
                ]
              : []),
          ]
        : [],
    },
    tools: {
      query: t("extensions.contextTrace.messagePart.toolsInjected", {
        count: resources?.tools.active.length ?? 0,
      }),
      rows: resources?.tools.active.length
        ? [
            {
              label: t("extensions.contextTrace.messagePart.modelTools"),
              value: resources.tools.active.join(", "),
            },
          ]
        : [],
    },
    extensions: {
      query: t("extensions.contextTrace.messagePart.extensionsLoaded", {
        count: visibleExtensions.length,
      }),
      rows: visibleExtensions.length
        ? [
            {
              label: t("extensions.contextTrace.messagePart.extensions"),
              value: visibleExtensions.map((extension) => extension.name).join(", "),
            },
          ]
        : [],
    },
  }[section ?? "system-prompt"];
  const rows = presentation.rows;
  if (rows.length === 0) return null;
  const currentSystemPromptContent =
    systemPromptContent?.traceId === event.traceId ? systemPromptContent : undefined;
  const loadSystemPrompt = () => {
    if (
      section !== "system-prompt" ||
      currentSystemPromptContent?.status === "loading" ||
      currentSystemPromptContent?.status === "ready"
    ) {
      return;
    }
    const traceId = event.traceId;
    setSystemPromptContent({ traceId, status: "loading" });
    void traceClient
      .read({ sessionId: event.sessionId, traceId })
      .then((value) => {
        const capture = contextTraceSystemPromptCapture(value.event);
        setSystemPromptContent((current) =>
          current?.traceId === traceId
            ? capture
              ? { traceId, status: "ready", text: capture.text }
              : { traceId, status: "error" }
            : current,
        );
      })
      .catch(() =>
        setSystemPromptContent((current) =>
          current?.traceId === traceId ? { traceId, status: "error" } : current,
        ),
      );
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) loadSystemPrompt();
  };

  return (
    <div data-slot="pi-context-trace-timeline-step" className="w-full">
      <ToolCall
        label={t("extensions.contextTrace.messagePart.composeContext")}
        activeLabel={t("extensions.contextTrace.messagePart.composeContext")}
        query={presentation.query}
        request=""
        result=""
        requestLabel=""
        resultLabel=""
        icon={ScanSearchIcon}
        iconClassName="[--chat-icon-size:var(--icon-size-md)]"
        running={false}
        showCompletionIcon={false}
        expandable={rows.length > 0}
        open={rows.length > 0 && open}
        onOpenChange={handleOpenChange}
      >
        {rows.length > 0 ? (
          <div className="space-y-3">
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
            {section === "system-prompt" ? (
              <section className="space-y-2">
                <p className="text-foreground/45 text-xs">
                  {t("extensions.contextTrace.systemPromptSourceContent")}
                </p>
                {currentSystemPromptContent?.status === "ready" ? (
                  <pre
                    tabIndex={0}
                    className="bg-muted/35 text-foreground/80 max-h-72 overflow-auto rounded-lg p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words"
                  >
                    {currentSystemPromptContent.text}
                  </pre>
                ) : currentSystemPromptContent?.status === "error" ? (
                  <div
                    role="alert"
                    className="text-muted-foreground flex items-center justify-between gap-3 text-xs"
                  >
                    <span>{t("extensions.contextTrace.detailFailed")}</span>
                    <Button type="button" variant="outline" size="sm" onClick={loadSystemPrompt}>
                      {t("extensions.contextTrace.retry")}
                    </Button>
                  </div>
                ) : (
                  <p role="status" className="text-muted-foreground text-xs">
                    {t("extensions.contextTrace.loadingDetail")}
                  </p>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </ToolCall>
    </div>
  );
};
