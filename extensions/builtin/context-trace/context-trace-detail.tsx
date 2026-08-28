"use client";

import {
  BotIcon,
  BracesIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileTextIcon,
  LockKeyholeIcon,
  RotateCwIcon,
  ShieldIcon,
  TriangleAlertIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { WorkbenchCodeView } from "@/components/code-highlighting/workbench-code-editor";
import { useI18n, type Translate } from "@/i18n";
import type {
  SessionContextTraceCaptureMetadata,
  SessionContextTraceContextUsage,
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
  SessionContextTraceJsonCapture,
  SessionContextTraceSystemPromptSource,
  SessionContextTraceTextCapture,
  SessionContextTraceTokenUsage,
  SessionContextTraceTool,
} from "@/runtime/pi/contracts/rpc";

import {
  CONTEXT_TRACE_MESSAGE_ROLES,
  groupContextTraceMessages,
  listContextTraceMessages,
  listContextTraceOutputBlocks,
  type ContextTraceMessageRole,
} from "./context-trace-messages";
import { contextTraceSelectedRawValue } from "./context-trace-detail-selection";
import { contextTraceEventLabel } from "./context-trace-event-label";

export { contextTraceEventLabel } from "./context-trace-event-label";

export type ContextTraceDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; event: SessionContextTraceEvent }
  | { status: "evicted" }
  | { status: "error" };

export type ContextTraceDetailView =
  | "summary"
  | "preview"
  | "raw"
  | "source"
  | "payload"
  | "result"
  | "schema"
  | "timing";

export type ContextTraceDetailFocus =
  | {
      type: "prompt-section";
      section:
        | "user-prompt"
        | "system-prompt"
        | "skills"
        | "context-files"
        | "tool-schema"
        | "attachments";
    }
  | { type: "system-prompt-source"; index: number }
  | { type: "prompt-tool"; toolName: string }
  | {
      type: "context-message";
      sourceIndex: number;
      role?: ContextTraceMessageRole;
    }
  | {
      type: "trace-node";
      node: "model-step" | "context" | "conversation" | "final-response";
    }
  | { type: "output-message" }
  | { type: "output-block"; contentIndex: number; section?: "arguments" }
  | {
      type: "compaction-section";
      section: "overview" | "summary" | "messages-to-summarize" | "turn-prefix";
    }
  | { type: "message-role"; role: "user" | "assistant" | "tool" };

export type ContextTraceDetailVariant = "event" | "user-message" | "tool-execution";

export interface ContextTraceToolDetailContext {
  start?: {
    summary: SessionContextTraceEventSummary;
    detail: ContextTraceDetailState;
  };
  end?: {
    summary: SessionContextTraceEventSummary;
    detail: ContextTraceDetailState;
  };
  schema?: SessionContextTraceTool;
  schemaDetail?: ContextTraceDetailState;
}

export function contextTraceDetailVariant(
  summary: SessionContextTraceEventSummary | undefined,
  focus: ContextTraceDetailFocus | undefined,
): ContextTraceDetailVariant {
  if (summary?.kind === "tool-execution-start" || summary?.kind === "tool-execution-end") {
    return "tool-execution";
  }
  if (
    (focus?.type === "prompt-section" && focus.section === "user-prompt") ||
    (focus?.type === "context-message" && focus.role === "user")
  ) {
    return "user-message";
  }
  return "event";
}

export function contextTraceDetailViews(
  summary: SessionContextTraceEventSummary | undefined,
  focus: ContextTraceDetailFocus | undefined,
): readonly ContextTraceDetailView[] {
  return contextTraceDetailVariant(summary, focus) === "tool-execution"
    ? (["summary", "payload", "result", "schema", "timing"] as const)
    : (["summary", "preview", "raw", "source"] as const);
}

function formatPrimitive(value: string | number | boolean | null | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  return String(value);
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="overflow-hidden border-b last:border-b-0">
      <h3 className="bg-muted/25 border-b px-3 py-2 text-xs font-medium">{title}</h3>
      <div className="p-3">{children}</div>
    </section>
  );
}

function KeyValueGrid({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TokenUsageView({ usage }: { usage: SessionContextTraceTokenUsage }) {
  const { number, t } = useI18n();
  const totalTokens =
    usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  const items: [string, ReactNode][] = [
    [t("extensions.contextTrace.fields.inputTokens"), number(usage.input)],
    [t("extensions.contextTrace.fields.outputTokens"), number(usage.output)],
    [t("extensions.contextTrace.fields.cacheReadTokens"), number(usage.cacheRead)],
    [t("extensions.contextTrace.fields.cacheWriteTokens"), number(usage.cacheWrite)],
  ];
  if (usage.cacheWrite1h !== undefined) {
    items.push([
      t("extensions.contextTrace.fields.cacheWrite1hTokens"),
      number(usage.cacheWrite1h),
    ]);
  }
  if (usage.reasoning !== undefined) {
    items.push([t("extensions.contextTrace.fields.reasoningTokens"), number(usage.reasoning)]);
  }
  items.push([t("extensions.contextTrace.fields.totalTokens"), number(totalTokens)]);

  return (
    <Section title={t("extensions.contextTrace.tokenUsage")}>
      <KeyValueGrid items={items} />
    </Section>
  );
}

function ContextWindowUsageView({ usage }: { usage: SessionContextTraceContextUsage }) {
  const { number, t } = useI18n();
  const percent = usage.percent === null ? undefined : Math.max(0, Math.min(100, usage.percent));
  return (
    <Section title={t("extensions.contextTrace.contextWindowOccupancy")}>
      <div className="space-y-3">
        <KeyValueGrid
          items={[
            [
              t("extensions.contextTrace.fields.contextTokens"),
              usage.tokens === null ? "—" : number(usage.tokens),
            ],
            [t("extensions.contextTrace.fields.contextWindow"), number(usage.contextWindow)],
            [
              t("extensions.contextTrace.fields.contextPercent"),
              usage.percent === null
                ? "—"
                : `${number(usage.percent, { maximumFractionDigits: 2 })}%`,
            ],
          ]}
        />
        <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden="true">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width]"
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
      </div>
    </Section>
  );
}

function CaptureMetadata({ capture }: { capture: SessionContextTraceCaptureMetadata }) {
  const { number, t } = useI18n();
  if (!capture.truncated && capture.redactedPaths.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
      {capture.truncated ? (
        <span className="border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
          <TriangleAlertIcon className="size-3" />
          {t("extensions.contextTrace.truncated", {
            captured: number(capture.capturedBytes),
            original: number(capture.originalBytes),
          })}
        </span>
      ) : null}
      {capture.redactedPaths.length > 0 ? (
        <span
          className="border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-300 inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
          title={capture.redactedPaths.join("\n")}
        >
          <LockKeyholeIcon className="size-3" />
          {t("extensions.contextTrace.redacted", { count: capture.redactedPaths.length })}
        </span>
      ) : null}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-muted/35 max-h-[32rem] overflow-auto rounded-lg p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words">
      {children}
    </pre>
  );
}

function TextCaptureView({ capture }: { capture: SessionContextTraceTextCapture }) {
  return (
    <>
      <CaptureMetadata capture={capture} />
      <CodeBlock>{capture.text}</CodeBlock>
    </>
  );
}

function JsonCaptureView({ capture }: { capture: SessionContextTraceJsonCapture }) {
  return (
    <>
      <CaptureMetadata capture={capture.capture} />
      <CodeBlock>{JSON.stringify(capture.value, null, 2)}</CodeBlock>
    </>
  );
}

function SemanticKeyValueGrid({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-sm leading-5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailNavigationValue({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {children}
        <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2"
      onClick={onClick}
    >
      {children}
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
    </button>
  );
}

function SemanticSection({
  children,
  onOpen,
  title,
}: {
  children: ReactNode;
  onOpen?: () => void;
  title: string;
}) {
  return (
    <section className="border-b px-3 py-3 last:border-b-0">
      <h3 className="text-sm font-medium">
        {onOpen ? (
          <button
            type="button"
            className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2"
            onClick={onOpen}
          >
            {title}
            <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-0.5">
            {title}
            <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
          </span>
        )}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function DetailStateMessage({ state }: { state: ContextTraceDetailState | undefined }) {
  const { t } = useI18n();
  return (
    <p className="text-muted-foreground text-xs">
      {state?.status === "loading"
        ? t("extensions.contextTrace.loadingDetail")
        : state?.status === "evicted"
          ? t("extensions.contextTrace.evictedDescription")
          : state?.status === "error"
            ? t("extensions.contextTrace.detailFailed")
            : t("extensions.contextTrace.none")}
    </p>
  );
}

function UserMessagePreview({
  event,
  focus,
}: {
  event: SessionContextTraceEvent;
  focus?: ContextTraceDetailFocus;
}) {
  const { t } = useI18n();
  if (event.kind === "prompt-composition") {
    return (
      <>
        <CaptureMetadata capture={event.detail.prompt} />
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {event.detail.prompt.text || t("extensions.contextTrace.contextContentUnavailable")}
        </p>
      </>
    );
  }
  if (event.kind === "context-snapshot" && focus?.type === "context-message") {
    const entry = listContextTraceMessages(event.detail.messages.value).find(
      (candidate) => candidate.sourceIndex === focus.sourceIndex,
    );
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-6">
        {entry?.text || t("extensions.contextTrace.contextContentUnavailable")}
      </p>
    );
  }
  return <DetailStateMessage state={{ status: "idle" }} />;
}

function UserMessageSummary({
  event,
  focus,
  onViewChange,
}: {
  event: SessionContextTraceEvent;
  focus?: ContextTraceDetailFocus;
  onViewChange?: (view: ContextTraceDetailView) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="border-b px-3 py-4">
        <SemanticKeyValueGrid
          items={[
            [
              t("extensions.contextTrace.fields.source"),
              <DetailNavigationValue
                key="user-source"
                onClick={onViewChange ? () => onViewChange("source") : undefined}
              >
                {t("extensions.contextTrace.userSource")}
              </DetailNavigationValue>,
            ],
            [t("extensions.contextTrace.fields.status"), t("extensions.contextTrace.completed")],
            [
              t("extensions.contextTrace.fields.duration"),
              t("extensions.contextTrace.duration", { value: 0 }),
            ],
          ]}
        />
      </div>
      <SemanticSection
        title={t("extensions.contextTrace.detailTabs.preview")}
        onOpen={onViewChange ? () => onViewChange("preview") : undefined}
      >
        <UserMessagePreview event={event} focus={focus} />
      </SemanticSection>
    </div>
  );
}

function UserMessageSourceDetail({ event }: { event: SessionContextTraceEvent }) {
  const { date, t } = useI18n();
  return (
    <SemanticSection title={t("extensions.contextTrace.detailTabs.source")}>
      <SemanticKeyValueGrid
        items={[
          [t("extensions.contextTrace.fields.source"), t("extensions.contextTrace.userSource")],
          [
            t("extensions.contextTrace.fields.time"),
            date(event.time, { dateStyle: "medium", timeStyle: "medium" }),
          ],
        ]}
      />
    </SemanticSection>
  );
}

type ToolExecutionStartEvent = Extract<SessionContextTraceEvent, { kind: "tool-execution-start" }>;
type ToolExecutionEndEvent = Extract<SessionContextTraceEvent, { kind: "tool-execution-end" }>;

function readyToolStart(
  event: SessionContextTraceEvent,
  context: ContextTraceToolDetailContext | undefined,
): ToolExecutionStartEvent | undefined {
  if (event.kind === "tool-execution-start") return event;
  const related = context?.start?.detail;
  return related?.status === "ready" && related.event.kind === "tool-execution-start"
    ? related.event
    : undefined;
}

function readyToolEnd(
  event: SessionContextTraceEvent,
  context: ContextTraceToolDetailContext | undefined,
): ToolExecutionEndEvent | undefined {
  if (event.kind === "tool-execution-end") return event;
  const related = context?.end?.detail;
  return related?.status === "ready" && related.event.kind === "tool-execution-end"
    ? related.event
    : undefined;
}

function ToolPayloadDetail({
  context,
  event,
}: {
  context?: ContextTraceToolDetailContext;
  event: SessionContextTraceEvent;
}) {
  const start = readyToolStart(event, context);
  return start ? (
    <JsonCaptureView capture={start.detail.args} />
  ) : (
    <DetailStateMessage state={context?.start?.detail} />
  );
}

function ToolResultDetail({
  context,
  event,
}: {
  context?: ContextTraceToolDetailContext;
  event: SessionContextTraceEvent;
}) {
  const end = readyToolEnd(event, context);
  return end ? (
    <JsonCaptureView capture={end.detail.result} />
  ) : (
    <DetailStateMessage state={context?.end?.detail} />
  );
}

function ToolExecutionSchemaDetail({
  context,
  showParameters,
}: {
  context?: ContextTraceToolDetailContext;
  showParameters: boolean;
}) {
  const { t } = useI18n();
  const tool = context?.schema;
  if (!tool) return <DetailStateMessage state={context?.schemaDetail} />;
  return (
    <div className="space-y-2 text-sm leading-6">
      <p className="font-semibold">{tool.name}</p>
      <p className="text-muted-foreground">
        {tool.description || t("extensions.contextTrace.none")}
      </p>
      {showParameters ? <JsonCaptureView capture={tool.parameters} /> : null}
    </div>
  );
}

function ToolTimingDetail({
  context,
  event,
}: {
  context?: ContextTraceToolDetailContext;
  event: SessionContextTraceEvent;
}) {
  const { date, t } = useI18n();
  const start =
    context?.start?.summary ?? (event.kind === "tool-execution-start" ? event : undefined);
  const end = context?.end?.summary ?? (event.kind === "tool-execution-end" ? event : undefined);
  const duration = start && end ? Math.max(0, end.time - start.time) : undefined;
  return (
    <SemanticKeyValueGrid
      items={[
        [
          t("extensions.contextTrace.fields.started"),
          start ? date(start.time, { dateStyle: "medium", timeStyle: "medium" }) : "—",
        ],
        [
          t("extensions.contextTrace.fields.duration"),
          duration === undefined ? "—" : t("extensions.contextTrace.duration", { value: duration }),
        ],
      ]}
    />
  );
}

function ToolExecutionSummary({
  context,
  event,
  onViewChange,
}: {
  context?: ContextTraceToolDetailContext;
  event: SessionContextTraceEvent;
  onViewChange?: (view: ContextTraceDetailView) => void;
}) {
  const { t } = useI18n();
  const end = readyToolEnd(event, context);
  const status = end?.detail.isError
    ? t("extensions.contextTrace.failed")
    : context?.end?.summary || event.kind === "tool-execution-end"
      ? t("extensions.contextTrace.completed")
      : t("extensions.contextTrace.running");
  return (
    <div>
      <div className="border-b px-3 py-4">
        <SemanticKeyValueGrid
          items={[
            [
              t("extensions.contextTrace.fields.hierarchy"),
              <DetailNavigationValue key="tool-hierarchy">
                {t("extensions.contextTrace.assistantMessage")}
              </DetailNavigationValue>,
            ],
            [t("extensions.contextTrace.fields.status"), status],
          ]}
        />
      </div>
      <SemanticSection
        title={t("extensions.contextTrace.detailTabs.payload")}
        onOpen={onViewChange ? () => onViewChange("payload") : undefined}
      >
        <ToolPayloadDetail event={event} context={context} />
      </SemanticSection>
      <SemanticSection
        title={t("extensions.contextTrace.detailTabs.result")}
        onOpen={onViewChange ? () => onViewChange("result") : undefined}
      >
        <ToolResultDetail event={event} context={context} />
      </SemanticSection>
      <SemanticSection
        title={t("extensions.contextTrace.detailTabs.schema")}
        onOpen={onViewChange ? () => onViewChange("schema") : undefined}
      >
        <ToolExecutionSchemaDetail context={context} showParameters={false} />
      </SemanticSection>
      <SemanticSection
        title={t("extensions.contextTrace.detailTabs.timing")}
        onOpen={onViewChange ? () => onViewChange("timing") : undefined}
      >
        <ToolTimingDetail event={event} context={context} />
      </SemanticSection>
    </div>
  );
}

function ToolExecutionDetailView({
  context,
  event,
  view,
}: {
  context?: ContextTraceToolDetailContext;
  event: SessionContextTraceEvent;
  view: Exclude<ContextTraceDetailView, "summary" | "preview" | "raw" | "source">;
}) {
  const { t } = useI18n();
  switch (view) {
    case "payload":
      return (
        <SemanticSection title={t("extensions.contextTrace.detailTabs.payload")}>
          <ToolPayloadDetail event={event} context={context} />
        </SemanticSection>
      );
    case "result":
      return (
        <SemanticSection title={t("extensions.contextTrace.detailTabs.result")}>
          <ToolResultDetail event={event} context={context} />
        </SemanticSection>
      );
    case "schema":
      return (
        <SemanticSection title={t("extensions.contextTrace.detailTabs.schema")}>
          <ToolExecutionSchemaDetail context={context} showParameters />
        </SemanticSection>
      );
    case "timing":
      return (
        <SemanticSection title={t("extensions.contextTrace.detailTabs.timing")}>
          <ToolTimingDetail event={event} context={context} />
        </SemanticSection>
      );
  }
}

function MessageList({
  capture,
  roles = CONTEXT_TRACE_MESSAGE_ROLES,
}: {
  capture: SessionContextTraceJsonCapture;
  roles?: readonly ContextTraceMessageRole[];
}) {
  const { number, t } = useI18n();
  if (!Array.isArray(capture.value)) return <JsonCaptureView capture={capture} />;
  const groups = groupContextTraceMessages(capture.value);
  const visibleRoles = roles.filter((role) => groups[role].length > 0);

  const roleIcon = (role: ContextTraceMessageRole) => {
    switch (role) {
      case "system":
        return ShieldIcon;
      case "compaction":
        return RotateCwIcon;
      case "user":
        return UserIcon;
      case "assistant":
        return BotIcon;
      case "tool":
        return WrenchIcon;
    }
  };

  return (
    <>
      <CaptureMetadata capture={capture.capture} />
      <div className="space-y-2">
        {visibleRoles.map((role) => {
          const Icon = roleIcon(role);
          const entries = groups[role];
          return (
            <details key={role} className="group/role overflow-hidden rounded-lg border">
              <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                <ChevronRightIcon className="text-muted-foreground size-3 shrink-0 transition-transform group-open/role:rotate-90" />
                <Icon className="text-muted-foreground size-3.5" />
                <span className="font-medium">
                  {t(`extensions.contextTrace.contextRoles.${role}`)}
                </span>
                <span className="text-muted-foreground ms-auto font-mono text-[10px]">
                  {number(entries.length)}
                </span>
              </summary>
              <div className="space-y-1.5 border-t p-2">
                {entries.length > 0 ? (
                  entries.map((entry, index) => (
                    <details
                      key={entry.id}
                      className="group/message overflow-hidden rounded-md border"
                    >
                      <summary className="hover:bg-muted/35 flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs">
                        <ChevronRightIcon className="text-muted-foreground size-3 shrink-0 transition-transform group-open/message:rotate-90" />
                        <span className="shrink-0 font-medium">
                          {entry.toolName ??
                            t("extensions.contextTrace.contextMessageNumber", {
                              index: index + 1,
                            })}
                        </span>
                        <span className="text-muted-foreground min-w-0 flex-1 truncate">
                          {entry.preview || t("extensions.contextTrace.contextContentUnavailable")}
                        </span>
                      </summary>
                      <div className="border-t p-2">
                        <CodeBlock>
                          {entry.text || t("extensions.contextTrace.contextContentUnavailable")}
                        </CodeBlock>
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="text-muted-foreground px-2 py-1 text-[11px]">
                    {t("extensions.contextTrace.noMessagesForRole")}
                  </p>
                )}
              </div>
            </details>
          );
        })}
        {visibleRoles.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("extensions.contextTrace.noMessagesForRole")}
          </p>
        ) : null}
      </div>
    </>
  );
}

type PromptCompositionEvent = Extract<SessionContextTraceEvent, { kind: "prompt-composition" }>;

function visibleSystemPrompt(event: PromptCompositionEvent): SessionContextTraceTextCapture {
  return event.detail.systemPromptWithoutSkills ?? event.detail.systemPrompt;
}

function systemPromptSourceKindLabel(
  t: Translate,
  kind: SessionContextTraceSystemPromptSource["kind"],
): string {
  return t(`extensions.contextTrace.systemPromptSourceKinds.${kind}`);
}

function systemPromptSourceScopeLabel(
  t: Translate,
  scope: SessionContextTraceSystemPromptSource["scope"],
): string {
  return t(`extensions.contextTrace.systemPromptSourceScopes.${scope}`);
}

function SystemPromptSourceView({
  event,
  index,
}: {
  event: PromptCompositionEvent;
  index: number;
}) {
  const { t } = useI18n();
  const source = event.detail.systemPromptSources?.[index];
  if (!source) {
    return <p className="text-muted-foreground p-3 text-xs">{t("extensions.contextTrace.none")}</p>;
  }
  return (
    <div className="space-y-3">
      <Section title={systemPromptSourceKindLabel(t, source.kind)}>
        <KeyValueGrid
          items={[
            [
              t("extensions.contextTrace.fields.scope"),
              systemPromptSourceScopeLabel(t, source.scope),
            ],
            [t("extensions.contextTrace.fields.path"), source.path ?? "—"],
          ]}
        />
      </Section>
      <Section title={t("extensions.contextTrace.systemPromptSourceContent")}>
        {source.content ? (
          <TextCaptureView capture={source.content} />
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("extensions.contextTrace.piDefaultPromptDescription")}
          </p>
        )}
      </Section>
    </div>
  );
}

function SkillsView({ event }: { event: PromptCompositionEvent }) {
  const { t } = useI18n();
  const skills = event.detail.systemPromptOptions.skills;
  return (
    <Section title={t("extensions.contextTrace.skills")}>
      {skills.length > 0 ? (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.name} className="rounded-lg border p-2.5 text-xs">
              <div className="flex items-center gap-2 font-medium">
                <BotIcon className="text-muted-foreground size-3.5" />
                {skill.name}
              </div>
              {skill.description ? (
                <p className="text-muted-foreground mt-1">{skill.description}</p>
              ) : null}
              {skill.filePath ? (
                <p className="text-muted-foreground mt-1 break-all font-mono text-[11px]">
                  {skill.filePath}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
      )}
    </Section>
  );
}

function ToolSchemasView({
  activeOnly = false,
  event,
}: {
  activeOnly?: boolean;
  event: PromptCompositionEvent;
}) {
  const { t } = useI18n();
  const tools = activeOnly ? event.detail.tools.filter((tool) => tool.active) : event.detail.tools;
  return (
    <Section title={t("extensions.contextTrace.toolSchemas")}>
      {tools.length > 0 ? (
        <div className="space-y-2">
          {tools.map((tool) => (
            <details key={tool.name} className="overflow-hidden rounded-lg border">
              <summary className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                <WrenchIcon className="text-muted-foreground size-3.5" />
                <span className="font-medium">{tool.name}</span>
                <span
                  className={
                    tool.active
                      ? "ms-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300"
                      : "text-muted-foreground ms-auto rounded-full bg-muted px-2 py-0.5"
                  }
                >
                  {tool.active
                    ? t("extensions.contextTrace.active")
                    : t("extensions.contextTrace.inactive")}
                </span>
              </summary>
              <div className="space-y-2 border-t p-3 text-xs">
                <p>{tool.description}</p>
                <p className="text-muted-foreground break-all font-mono text-[11px]">
                  {tool.source.path}
                </p>
                <JsonCaptureView capture={tool.parameters} />
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
      )}
    </Section>
  );
}

function ToolSchemaView({ event, toolName }: { event: PromptCompositionEvent; toolName: string }) {
  const { t } = useI18n();
  const tool = event.detail.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return <p className="text-muted-foreground p-3 text-xs">{t("extensions.contextTrace.none")}</p>;
  }
  return (
    <div className="space-y-3">
      <Section title={tool.name}>
        <p className="mb-2 text-xs">{tool.description}</p>
        <p className="text-muted-foreground break-all font-mono text-[11px]">{tool.source.path}</p>
      </Section>
      <Section title={t("extensions.contextTrace.toolSchemas")}>
        <JsonCaptureView capture={tool.parameters} />
      </Section>
    </div>
  );
}

function PromptCompositionDetail({ event }: { event: PromptCompositionEvent }) {
  const { t } = useI18n();
  const detail = event.detail;
  const sourceOptions = detail.systemPromptOptions;

  return (
    <div className="space-y-3">
      <Section title={t("extensions.contextTrace.modelAndUsage")}>
        <KeyValueGrid
          items={[
            [t("extensions.contextTrace.fields.provider"), detail.model?.provider ?? "—"],
            [t("extensions.contextTrace.fields.model"), detail.model?.model ?? "—"],
            [t("extensions.contextTrace.fields.api"), detail.model?.api ?? "—"],
            [t("extensions.contextTrace.fields.thinkingLevel"), detail.thinkingLevel ?? "—"],
            [t("extensions.contextTrace.fields.cwd"), sourceOptions.cwd],
          ]}
        />
      </Section>

      {detail.contextUsage ? <ContextWindowUsageView usage={detail.contextUsage} /> : null}

      <Section title={t("extensions.contextTrace.systemPromptWithoutSkills")}>
        <TextCaptureView capture={visibleSystemPrompt(event)} />
      </Section>

      <Section title={t("extensions.contextTrace.userPrompt")}>
        <TextCaptureView capture={detail.prompt} />
      </Section>

      {sourceOptions.contextFiles.length > 0 ? (
        <Section title={t("extensions.contextTrace.contextFiles")}>
          <div className="space-y-2">
            {sourceOptions.contextFiles.map((file) => (
              <details key={file.path} className="overflow-hidden rounded-lg border">
                <summary className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                  <FileTextIcon className="text-muted-foreground size-3.5" />
                  <span className="min-w-0 truncate font-mono">{file.path}</span>
                </summary>
                <div className="border-t p-2">
                  <TextCaptureView capture={file.content} />
                </div>
              </details>
            ))}
          </div>
        </Section>
      ) : null}

      <SkillsView event={event} />

      <ToolSchemasView event={event} />

      <Section title={t("extensions.contextTrace.images")}>
        <JsonCaptureView capture={detail.images} />
      </Section>
    </div>
  );
}

type CompactionTraceEvent = Extract<SessionContextTraceEvent, { kind: "compaction" }>;

function CompactionDetail({
  event,
  section,
}: {
  event: CompactionTraceEvent;
  section?: "overview" | "summary" | "messages-to-summarize" | "turn-prefix";
}) {
  const { number, t } = useI18n();
  const { preparation, result } = event.detail;
  const overview = (
    <>
      <Section title={t("extensions.contextTrace.compactionDetail")}>
        <KeyValueGrid
          items={[
            [t("extensions.contextTrace.fields.phase"), event.detail.phase],
            [
              t("extensions.contextTrace.fields.reason"),
              t(`extensions.contextTrace.compactionReasons.${event.detail.reason}`),
            ],
            [
              t("extensions.contextTrace.fields.tokensBefore"),
              formatPrimitive(result?.tokensBefore ?? preparation?.tokensBefore),
            ],
            [
              t("extensions.contextTrace.fields.estimatedTokensAfter"),
              formatPrimitive(result?.estimatedTokensAfter),
            ],
            [
              t("extensions.contextTrace.fields.firstKeptEntryId"),
              formatPrimitive(result?.firstKeptEntryId ?? preparation?.firstKeptEntryId),
            ],
            [
              t("extensions.contextTrace.fields.summarizedMessageCount"),
              preparation ? number(preparation.summarizedMessageCount) : "—",
            ],
            [
              t("extensions.contextTrace.fields.turnPrefixMessageCount"),
              preparation ? number(preparation.turnPrefixMessageCount) : "—",
            ],
            [
              t("extensions.contextTrace.fields.branchEntryCount"),
              preparation ? number(preparation.branchEntryCount) : "—",
            ],
            [
              t("extensions.contextTrace.fields.splitTurn"),
              preparation
                ? preparation.isSplitTurn
                  ? t("extensions.contextTrace.yes")
                  : t("extensions.contextTrace.no")
                : "—",
            ],
            [
              t("extensions.contextTrace.fields.reserveTokens"),
              preparation ? number(preparation.reserveTokens) : "—",
            ],
            [
              t("extensions.contextTrace.fields.keepRecentTokens"),
              preparation ? number(preparation.keepRecentTokens) : "—",
            ],
            [
              t("extensions.contextTrace.fields.fromExtension"),
              result?.fromExtension === undefined
                ? "—"
                : result.fromExtension
                  ? t("extensions.contextTrace.yes")
                  : t("extensions.contextTrace.no"),
            ],
            [
              t("extensions.contextTrace.fields.compactionEntryId"),
              formatPrimitive(result?.compactionEntryId),
            ],
            [t("extensions.contextTrace.fields.aborted"), formatPrimitive(event.detail.aborted)],
            [
              t("extensions.contextTrace.fields.willRetry"),
              formatPrimitive(event.detail.willRetry),
            ],
          ]}
        />
      </Section>
      {event.detail.error ? (
        <Section title={t("extensions.contextTrace.errorDetail")}>
          <TextCaptureView capture={event.detail.error} />
        </Section>
      ) : null}
    </>
  );

  if (section === "overview") return <div className="space-y-3">{overview}</div>;
  if (section === "summary") {
    return (
      <div className="space-y-3">
        <Section title={t("extensions.contextTrace.compactionSummary")}>
          {result ? (
            <TextCaptureView capture={result.summary} />
          ) : (
            <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
          )}
        </Section>
        {result?.usage ? <TokenUsageView usage={result.usage} /> : null}
      </div>
    );
  }
  if (section === "messages-to-summarize") {
    return (
      <Section title={t("extensions.contextTrace.compactionMessagesToSummarize")}>
        {preparation ? (
          <JsonCaptureView capture={preparation.messagesToSummarize} />
        ) : (
          <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
        )}
      </Section>
    );
  }
  if (section === "turn-prefix") {
    return (
      <Section title={t("extensions.contextTrace.compactionTurnPrefix")}>
        {preparation ? (
          <JsonCaptureView capture={preparation.turnPrefixMessages} />
        ) : (
          <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
        )}
      </Section>
    );
  }

  return (
    <div className="space-y-3">
      {overview}
      {result ? (
        <Section title={t("extensions.contextTrace.compactionSummary")}>
          <TextCaptureView capture={result.summary} />
        </Section>
      ) : null}
      {result?.usage ? <TokenUsageView usage={result.usage} /> : null}
      {preparation?.previousSummary ? (
        <Section title={t("extensions.contextTrace.previousCompactionSummary")}>
          <TextCaptureView capture={preparation.previousSummary} />
        </Section>
      ) : null}
      {preparation?.customInstructions ? (
        <Section title={t("extensions.contextTrace.compactionInstructions")}>
          <TextCaptureView capture={preparation.customInstructions} />
        </Section>
      ) : null}
      {preparation ? (
        <>
          <Section title={t("extensions.contextTrace.compactionMessagesToSummarize")}>
            <JsonCaptureView capture={preparation.messagesToSummarize} />
          </Section>
          <Section title={t("extensions.contextTrace.compactionTurnPrefix")}>
            <JsonCaptureView capture={preparation.turnPrefixMessages} />
          </Section>
          <Section title={t("extensions.contextTrace.compactionFileOperations")}>
            <JsonCaptureView capture={preparation.fileOperations} />
          </Section>
        </>
      ) : null}
      {result?.details ? (
        <Section title={t("extensions.contextTrace.compactionProviderDetails")}>
          <JsonCaptureView capture={result.details} />
        </Section>
      ) : null}
    </div>
  );
}

function EventSpecificDetail({ event }: { event: SessionContextTraceEvent }) {
  const { number, t } = useI18n();

  switch (event.kind) {
    case "prompt-composition":
      return <PromptCompositionDetail event={event} />;
    case "context-snapshot":
      return (
        <div className="space-y-3">
          {event.detail.contextUsage ? (
            <ContextWindowUsageView usage={event.detail.contextUsage} />
          ) : null}
          <Section title={t("extensions.contextTrace.modelContext")}>
            <MessageList capture={event.detail.messages} />
          </Section>
        </div>
      );
    case "provider-request":
      return (
        <div className="space-y-3">
          <div className="border-sky-500/20 bg-sky-500/6 text-muted-foreground rounded-lg border p-3 text-xs">
            {t("extensions.contextTrace.logicalRequestNotice")}
          </div>
          <Section title={t("extensions.contextTrace.capturedJson")}>
            <JsonCaptureView capture={event.detail.payload} />
          </Section>
        </div>
      );
    case "provider-response":
      return (
        <Section title={t("extensions.contextTrace.response")}>
          <KeyValueGrid
            items={[
              [t("extensions.contextTrace.fields.status"), number(event.detail.status)],
              [
                t("extensions.contextTrace.fields.headers"),
                Object.keys(event.detail.headers).length > 0 ? (
                  <CodeBlock>{JSON.stringify(event.detail.headers, null, 2)}</CodeBlock>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
        </Section>
      );
    case "model-output":
      return (
        <div className="space-y-3">
          <TokenUsageView usage={event.detail.usage} />
          <Section title={t("extensions.contextTrace.modelOutput")}>
            <JsonCaptureView capture={event.detail.message} />
          </Section>
        </div>
      );
    case "tool-execution-start":
      return (
        <div className="space-y-3">
          <Section title={t("extensions.contextTrace.toolExecution")}>
            <KeyValueGrid
              items={[
                [t("extensions.contextTrace.fields.toolName"), event.detail.toolName],
                [t("extensions.contextTrace.fields.toolCallId"), event.detail.toolCallId],
              ]}
            />
          </Section>
          <Section title={t("extensions.contextTrace.toolArguments")}>
            <JsonCaptureView capture={event.detail.args} />
          </Section>
        </div>
      );
    case "tool-execution-end":
      return (
        <div className="space-y-3">
          <Section title={t("extensions.contextTrace.toolExecution")}>
            <KeyValueGrid
              items={[
                [t("extensions.contextTrace.fields.toolName"), event.detail.toolName],
                [t("extensions.contextTrace.fields.toolCallId"), event.detail.toolCallId],
                [
                  t("extensions.contextTrace.fields.isError"),
                  event.detail.isError
                    ? t("extensions.contextTrace.yes")
                    : t("extensions.contextTrace.no"),
                ],
              ]}
            />
          </Section>
          <Section title={t("extensions.contextTrace.toolResult")}>
            <JsonCaptureView capture={event.detail.result} />
          </Section>
        </div>
      );
    case "turn-end":
      return (
        <div className="space-y-3">
          {event.detail.usage ? <TokenUsageView usage={event.detail.usage} /> : null}
          <Section title={t("extensions.contextTrace.turnMessage")}>
            <JsonCaptureView capture={event.detail.message} />
          </Section>
          <Section
            title={t("extensions.contextTrace.toolResults", {
              count: event.detail.toolResultCount,
            })}
          >
            <JsonCaptureView capture={event.detail.toolResults} />
          </Section>
        </div>
      );
    case "run-end":
      return (
        <Section title={t("extensions.contextTrace.lifecycle")}>
          <KeyValueGrid
            items={[
              [t("extensions.contextTrace.fields.messageCount"), number(event.detail.messageCount)],
              [
                t("extensions.contextTrace.fields.willRetry"),
                event.detail.willRetry
                  ? t("extensions.contextTrace.yes")
                  : t("extensions.contextTrace.no"),
              ],
            ]}
          />
        </Section>
      );
    case "retry":
      return (
        <div className="space-y-3">
          <Section title={t("extensions.contextTrace.retryDetail")}>
            <KeyValueGrid
              items={[
                [t("extensions.contextTrace.fields.phase"), event.detail.phase],
                [
                  t("extensions.contextTrace.fields.attempt"),
                  formatPrimitive(event.detail.attempt),
                ],
                [
                  t("extensions.contextTrace.fields.maxAttempts"),
                  formatPrimitive(event.detail.maxAttempts),
                ],
                [t("extensions.contextTrace.fields.delay"), formatPrimitive(event.detail.delayMs)],
                [t("extensions.contextTrace.fields.source"), formatPrimitive(event.detail.source)],
                [
                  t("extensions.contextTrace.fields.success"),
                  formatPrimitive(event.detail.success),
                ],
              ]}
            />
          </Section>
          {event.detail.error ? (
            <Section title={t("extensions.contextTrace.errorDetail")}>
              <TextCaptureView capture={event.detail.error} />
            </Section>
          ) : null}
        </div>
      );
    case "compaction":
      return <CompactionDetail event={event} />;
    case "round-start":
      return (
        <Section title={t("extensions.contextTrace.lifecycle")}>
          <KeyValueGrid
            items={[[t("extensions.contextTrace.fields.trigger"), event.detail.trigger]]}
          />
        </Section>
      );
    case "turn-start":
      return (
        <Section title={t("extensions.contextTrace.lifecycle")}>
          <KeyValueGrid
            items={[
              [
                t("extensions.contextTrace.fields.timestamp"),
                formatPrimitive(event.detail.timestamp),
              ],
            ]}
          />
        </Section>
      );
    case "run-start":
    case "round-settled":
      return (
        <Section title={t("extensions.contextTrace.lifecycle")}>
          <p className="text-muted-foreground text-xs">
            {t("extensions.contextTrace.noAdditionalDetail")}
          </p>
        </Section>
      );
  }
}

function FocusedContextDetail({
  event,
  focus,
}: {
  event: SessionContextTraceEvent;
  focus: ContextTraceDetailFocus;
}) {
  const { t } = useI18n();
  if (focus.type === "prompt-section" && event.kind === "prompt-composition") {
    switch (focus.section) {
      case "user-prompt":
        return (
          <Section title={t("extensions.contextTrace.userPrompt")}>
            <TextCaptureView capture={event.detail.prompt} />
          </Section>
        );
      case "system-prompt":
        return (
          <Section title={t("extensions.contextTrace.systemPromptWithoutSkills")}>
            <TextCaptureView capture={visibleSystemPrompt(event)} />
          </Section>
        );
      case "skills":
        return <SkillsView event={event} />;
      case "context-files":
        return (
          <Section title={t("extensions.contextTrace.contextFiles")}>
            {event.detail.systemPromptOptions.contextFiles.length > 0 ? (
              <div className="space-y-2">
                {event.detail.systemPromptOptions.contextFiles.map((file) => (
                  <details key={file.path} className="overflow-hidden rounded-lg border">
                    <summary className="hover:bg-muted/40 cursor-pointer px-3 py-2 font-mono text-xs">
                      {file.path}
                    </summary>
                    <div className="border-t p-2">
                      <TextCaptureView capture={file.content} />
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
            )}
          </Section>
        );
      case "tool-schema":
        return <ToolSchemasView event={event} activeOnly />;
      case "attachments":
        return (
          <Section title={t("extensions.contextTrace.images")}>
            <JsonCaptureView capture={event.detail.images} />
          </Section>
        );
    }
  }
  if (focus.type === "system-prompt-source" && event.kind === "prompt-composition") {
    return <SystemPromptSourceView event={event} index={focus.index} />;
  }
  if (focus.type === "prompt-tool" && event.kind === "prompt-composition") {
    return <ToolSchemaView event={event} toolName={focus.toolName} />;
  }
  if (focus.type === "context-message" && event.kind === "context-snapshot") {
    const entry = listContextTraceMessages(event.detail.messages.value).find(
      (candidate) => candidate.sourceIndex === focus.sourceIndex,
    );
    return (
      <Section title={entry?.toolName ?? t("extensions.contextTrace.contextMessage")}>
        {entry ? (
          <CodeBlock>{JSON.stringify(entry.value, null, 2)}</CodeBlock>
        ) : (
          <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
        )}
      </Section>
    );
  }
  if (
    (focus.type === "output-message" || focus.type === "output-block") &&
    (event.kind === "model-output" || event.kind === "turn-end")
  ) {
    if (focus.type === "output-message") return <EventSpecificDetail event={event} />;
    const message = event.detail.message.value;
    const block = listContextTraceOutputBlocks(message).find(
      (candidate) => candidate.contentIndex === focus.contentIndex,
    );
    const value =
      focus.section === "arguments" &&
      block &&
      typeof block.value === "object" &&
      block.value !== null &&
      !Array.isArray(block.value)
        ? (block.value.arguments ?? null)
        : block?.value;
    return (
      <Section title={t("extensions.contextTrace.modelOutput")}>
        {value === undefined ? (
          <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
        ) : (
          <CodeBlock>
            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          </CodeBlock>
        )}
      </Section>
    );
  }
  if (focus.type === "message-role" && event.kind === "context-snapshot") {
    return (
      <Section title={t(`extensions.contextTrace.contextRoles.${focus.role}`)}>
        <MessageList capture={event.detail.messages} roles={[focus.role]} />
      </Section>
    );
  }
  if (focus.type === "compaction-section" && event.kind === "compaction") {
    return <CompactionDetail event={event} section={focus.section} />;
  }
  if (focus.type === "trace-node") {
    if (focus.node === "conversation" && event.kind === "context-snapshot") {
      return (
        <Section title={t("extensions.contextTrace.tree.conversation")}>
          <MessageList capture={event.detail.messages} />
        </Section>
      );
    }
    if (
      focus.node === "final-response" &&
      (event.kind === "model-output" || event.kind === "turn-end")
    ) {
      return (
        <Section title={t("extensions.contextTrace.tree.finalResponse")}>
          <JsonCaptureView capture={event.detail.message} />
        </Section>
      );
    }
    return <EventSpecificDetail event={event} />;
  }

  const selectedValue = contextTraceSelectedRawValue(event, focus);
  return (
    <Section title={contextTraceEventLabel(t, event.kind)}>
      <CodeBlock>
        {typeof selectedValue === "string"
          ? selectedValue
          : (JSON.stringify(selectedValue, null, 2) ?? "")}
      </CodeBlock>
    </Section>
  );
}

function EventOverview({ summary }: { summary: SessionContextTraceEventSummary }) {
  const { date, number, t } = useI18n();
  const flags = [
    summary.truncated ? t("extensions.contextTrace.flagTruncated") : undefined,
    summary.redacted ? t("extensions.contextTrace.flagRedacted") : undefined,
  ].filter(Boolean);
  const usageItems: [string, ReactNode][] = summary.usage
    ? [
        [t("extensions.contextTrace.fields.inputTokens"), number(summary.usage.input)],
        [t("extensions.contextTrace.fields.outputTokens"), number(summary.usage.output)],
        [t("extensions.contextTrace.fields.cacheReadTokens"), number(summary.usage.cacheRead)],
        [t("extensions.contextTrace.fields.cacheWriteTokens"), number(summary.usage.cacheWrite)],
      ]
    : [];

  return (
    <Section title={t("extensions.contextTrace.overview")}>
      <KeyValueGrid
        items={[
          [t("extensions.contextTrace.fields.session"), summary.sessionId],
          [t("extensions.contextTrace.fields.activation"), summary.activationId],
          [t("extensions.contextTrace.fields.round"), formatPrimitive(summary.roundId)],
          [
            t("extensions.contextTrace.fields.run"),
            summary.runId ? `${summary.runId} · #${formatPrimitive(summary.runIndex)}` : "—",
          ],
          [
            t("extensions.contextTrace.fields.turn"),
            summary.turnId ? `${summary.turnId} · #${formatPrimitive(summary.turnIndex)}` : "—",
          ],
          [
            t("extensions.contextTrace.fields.request"),
            summary.requestId
              ? `${summary.requestId} · #${formatPrimitive(summary.requestIndex)}`
              : "—",
          ],
          [t("extensions.contextTrace.fields.toolName"), formatPrimitive(summary.toolName)],
          [t("extensions.contextTrace.fields.toolCallId"), formatPrimitive(summary.toolCallId)],
          [t("extensions.contextTrace.fields.provider"), formatPrimitive(summary.model?.provider)],
          [t("extensions.contextTrace.fields.model"), formatPrimitive(summary.model?.model)],
          [
            t("extensions.contextTrace.fields.thinkingLevel"),
            formatPrimitive(summary.thinkingLevel),
          ],
          [
            t("extensions.contextTrace.fields.contextTokens"),
            formatPrimitive(summary.contextUsage?.tokens),
          ],
          [
            t("extensions.contextTrace.fields.contextWindow"),
            formatPrimitive(summary.contextUsage?.contextWindow),
          ],
          [
            t("extensions.contextTrace.fields.contextPercent"),
            summary.contextUsage?.percent === null || summary.contextUsage?.percent === undefined
              ? "—"
              : `${number(summary.contextUsage.percent, { maximumFractionDigits: 2 })}%`,
          ],
          [t("extensions.contextTrace.fields.agentAttempt"), formatPrimitive(summary.agentAttempt)],
          ...usageItems,
          [t("extensions.contextTrace.fields.sequence"), number(summary.seq)],
          [
            t("extensions.contextTrace.fields.time"),
            date(summary.time, { dateStyle: "medium", timeStyle: "medium" }),
          ],
          [t("extensions.contextTrace.fields.detailBytes"), number(summary.detailBytes)],
          [t("extensions.contextTrace.fields.flags"), flags.join(", ") || "—"],
          [t("extensions.contextTrace.fields.traceId"), summary.traceId],
        ]}
      />
    </Section>
  );
}

function SourceList({ items }: { items: readonly { label: string; path?: string }[] }) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map((item, index) => (
        <div key={`${item.label}:${item.path ?? index}`} className="px-3 py-2 text-xs">
          <p className="font-medium">{item.label}</p>
          {item.path ? (
            <p className="text-muted-foreground mt-0.5 break-all font-mono text-[11px]">
              {item.path}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface PromptSourceSelection {
  resources: readonly { label: string; path?: string }[];
  scoped: boolean;
  title: string;
}

function selectPromptSources(
  event: PromptCompositionEvent,
  focus: ContextTraceDetailFocus | undefined,
  t: Translate,
): PromptSourceSelection {
  const options = event.detail.systemPromptOptions;
  const systemPromptSources = (event.detail.systemPromptSources ?? []).map((source) => ({
    label: systemPromptSourceKindLabel(t, source.kind),
    path: source.path,
  }));
  const contextFiles = options.contextFiles.map((file) => ({
    label: file.path,
    path: file.path,
  }));
  const skills = options.skills.map((skill) => ({
    label: skill.name,
    path: skill.filePath,
  }));
  const tools = event.detail.tools.map((tool) => ({
    active: tool.active,
    label: tool.name,
    path: tool.source.path,
  }));

  if (focus?.type === "system-prompt-source") {
    const source = systemPromptSources[focus.index];
    return {
      resources: source ? [source] : [],
      scoped: true,
      title: t("extensions.contextTrace.fields.source"),
    };
  }
  if (focus?.type === "prompt-tool") {
    const tool = tools.find((candidate) => candidate.label === focus.toolName);
    return {
      resources: tool ? [tool] : [],
      scoped: true,
      title: t("extensions.contextTrace.toolSchemas"),
    };
  }
  if (focus?.type === "prompt-section") {
    switch (focus.section) {
      case "system-prompt":
        return {
          resources: systemPromptSources,
          scoped: true,
          title: t("extensions.contextTrace.fields.source"),
        };
      case "skills":
        return {
          resources: skills,
          scoped: true,
          title: t("extensions.contextTrace.skills"),
        };
      case "context-files":
        return {
          resources: contextFiles,
          scoped: true,
          title: t("extensions.contextTrace.contextFiles"),
        };
      case "tool-schema":
        return {
          resources: tools.filter((tool) => tool.active),
          scoped: true,
          title: t("extensions.contextTrace.toolSchemas"),
        };
      case "attachments":
        return {
          resources: [],
          scoped: true,
          title: t("extensions.contextTrace.images"),
        };
      case "user-prompt":
        return {
          resources: [],
          scoped: true,
          title: t("extensions.contextTrace.fields.source"),
        };
    }
  }

  return {
    resources: [...systemPromptSources, ...contextFiles, ...skills, ...tools],
    scoped: false,
    title: t("extensions.contextTrace.sourceResources"),
  };
}

function EventSourceDetail({
  event,
  focus,
}: {
  event: SessionContextTraceEvent;
  focus?: ContextTraceDetailFocus;
}) {
  const { t } = useI18n();
  if (event.kind !== "prompt-composition") {
    return (
      <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <FileTextIcon className="size-6 opacity-45" />
        <p className="text-foreground font-medium">
          {t("extensions.contextTrace.noSourceMetadataTitle")}
        </p>
        <p>{t("extensions.contextTrace.noSourceMetadataDescription")}</p>
      </div>
    );
  }

  const options = event.detail.systemPromptOptions;
  const selection = selectPromptSources(event, focus, t);

  return (
    <div>
      {selection.scoped ? null : (
        <Section title={t("extensions.contextTrace.sourceEnvironment")}>
          <KeyValueGrid items={[[t("extensions.contextTrace.fields.cwd"), options.cwd]]} />
        </Section>
      )}
      <Section title={selection.title}>
        {selection.resources.length > 0 ? (
          <SourceList items={selection.resources} />
        ) : (
          <p className="text-muted-foreground text-xs">{t("extensions.contextTrace.none")}</p>
        )}
      </Section>
    </div>
  );
}

export function ContextTraceDetail({
  detail,
  focus,
  onViewChange,
  summary,
  toolContext,
  view = "preview",
}: {
  detail: ContextTraceDetailState;
  focus?: ContextTraceDetailFocus;
  onViewChange?: (view: ContextTraceDetailView) => void;
  summary?: SessionContextTraceEventSummary;
  toolContext?: ContextTraceToolDetailContext;
  view?: ContextTraceDetailView;
}) {
  const { t } = useI18n();

  if (!summary || detail.status === "idle") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <BracesIcon className="size-7 opacity-45" />
        <p className="text-foreground font-medium">{t("extensions.contextTrace.selectEvent")}</p>
        <p>{t("extensions.contextTrace.selectEventDescription")}</p>
      </div>
    );
  }

  if (detail.status === "loading") {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 p-8 text-xs">
        <DatabaseIcon className="size-4 animate-pulse" />
        {t("extensions.contextTrace.loadingDetail")}
      </div>
    );
  }

  if (detail.status === "evicted") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <TriangleAlertIcon className="size-7 text-amber-500" />
        <p className="text-foreground font-medium">{t("extensions.contextTrace.evictedTitle")}</p>
        <p>{t("extensions.contextTrace.evictedDescription")}</p>
      </div>
    );
  }

  if (detail.status === "error") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <TriangleAlertIcon className="text-destructive size-7" />
        <p className="text-foreground font-medium">{t("extensions.contextTrace.detailFailed")}</p>
      </div>
    );
  }

  const variant = contextTraceDetailVariant(summary, focus);
  if (view === "summary") {
    if (variant === "user-message") {
      return <UserMessageSummary event={detail.event} focus={focus} onViewChange={onViewChange} />;
    }
    if (variant === "tool-execution") {
      return (
        <ToolExecutionSummary
          context={toolContext}
          event={detail.event}
          onViewChange={onViewChange}
        />
      );
    }
    return <EventOverview summary={summary} />;
  }
  if (
    variant === "tool-execution" &&
    (view === "payload" || view === "result" || view === "schema" || view === "timing")
  ) {
    return <ToolExecutionDetailView context={toolContext} event={detail.event} view={view} />;
  }
  if (view === "preview") {
    if (variant === "user-message") {
      return (
        <SemanticSection title={t("extensions.contextTrace.detailTabs.preview")}>
          <UserMessagePreview event={detail.event} focus={focus} />
        </SemanticSection>
      );
    }
    return focus ? (
      <FocusedContextDetail event={detail.event} focus={focus} />
    ) : (
      <EventSpecificDetail event={detail.event} />
    );
  }
  if (view === "source") {
    return variant === "user-message" ? (
      <UserMessageSourceDetail event={detail.event} />
    ) : (
      <EventSourceDetail event={detail.event} focus={focus} />
    );
  }

  return (
    <WorkbenchCodeView
      ariaLabel={t("extensions.contextTrace.detailTabs.raw")}
      name="context-trace.json"
      value={JSON.stringify(contextTraceSelectedRawValue(detail.event, focus), null, 2) ?? ""}
      className="min-h-full"
    />
  );
}
