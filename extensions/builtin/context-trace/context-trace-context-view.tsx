"use client";

import {
  BotIcon,
  BracesIcon,
  ChevronRightIcon,
  FileTextIcon,
  ImageIcon,
  MessageSquareIcon,
  PackageIcon,
  RotateCwIcon,
  ShieldIcon,
  SparklesIcon,
  TextIcon,
  UserIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
  SessionContextTraceJsonValue,
  SessionContextTraceContextUsage,
  SessionContextTraceTokenUsage,
} from "@/runtime/pi/rpc-contracts";

import type { ContextTraceDetailFocus, ContextTraceDetailState } from "./context-trace-detail";
import {
  listContextTraceMessages,
  listContextTraceOutputBlocks,
  type ContextTraceMessageRole,
} from "./context-trace-messages";
import {
  contextInputTokens,
  projectContextTraceTurns,
  type ContextTraceModelStep,
  type ContextTraceToolExecution,
  type ContextTraceTurn,
} from "./context-trace-tree";

interface TraceTreeNode {
  id: string;
  label: string;
  icon?: LucideIcon;
  tone?: string;
  rowTone?: string;
  badgeTone?: string;
  meta?: string;
  metaTone?: string;
  trailing?: string;
  title?: string;
  event?: SessionContextTraceEventSummary;
  focus?: ContextTraceDetailFocus;
  children?: readonly TraceTreeNode[];
  expandable?: boolean;
  loadTraceIds?: readonly string[];
}

function readyEvent(
  details: ReadonlyMap<string, ContextTraceDetailState>,
  traceId: string | undefined,
): SessionContextTraceEvent | undefined {
  if (!traceId) return undefined;
  const detail = details.get(traceId);
  return detail?.status === "ready" ? detail.event : undefined;
}

function jsonArrayLength(value: SessionContextTraceJsonValue): number {
  return Array.isArray(value) ? value.length : 0;
}

function outputMessageCapture(event: SessionContextTraceEvent | undefined) {
  if (event?.kind === "model-output" || event?.kind === "turn-end") return event.detail.message;
  return undefined;
}

function roleIcon(role: ContextTraceMessageRole): LucideIcon {
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
}

function roleTone(role: ContextTraceMessageRole): string {
  switch (role) {
    case "system":
      return EVENT_TONES.instruction;
    case "compaction":
      return EVENT_TONES.systemEvent;
    case "user":
      return EVENT_TONES.user;
    case "assistant":
      return EVENT_TONES.assistant;
    case "tool":
      return EVENT_TONES.tool;
  }
}

const EVENT_TONES = {
  turn: {
    tone: "text-sky-700 dark:text-sky-300",
    badgeTone: "bg-sky-500/12 text-sky-800 dark:text-sky-200",
    metaTone: "text-sky-900/65 dark:text-sky-200/65",
    rowTone: "bg-sky-500/[0.035] hover:bg-sky-500/[0.08]",
  },
  user: "text-blue-700 dark:text-blue-300",
  modelStep: "text-violet-700 dark:text-violet-300",
  context: "text-emerald-700 dark:text-emerald-300",
  output: "text-fuchsia-700 dark:text-fuchsia-300",
  finalResponse: "text-rose-700 dark:text-rose-300",
  assistant: "text-purple-700 dark:text-purple-300",
  instruction: "text-slate-700 dark:text-slate-300",
  skills: "text-teal-700 dark:text-teal-300",
  toolSchema: "text-cyan-700 dark:text-cyan-300",
  conversation: "text-indigo-700 dark:text-indigo-300",
  runtime: "text-lime-700 dark:text-lime-300",
  tool: "text-orange-700 dark:text-orange-300",
  systemEvent: "text-amber-700 dark:text-amber-300",
} as const;

const COMPACT_TOKEN_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactTokenNumber(value: number): string {
  return COMPACT_TOKEN_NUMBER_FORMATTER.format(value).toLowerCase();
}

export function contextTraceDetailFocusKey(focus: ContextTraceDetailFocus | undefined): string {
  if (!focus) return "event";
  switch (focus.type) {
    case "prompt-section":
      return `prompt:${focus.section}`;
    case "prompt-tool":
      return `prompt-tool:${focus.toolName}`;
    case "message-role":
      return `message-role:${focus.role}`;
    case "context-message":
      return `context-message:${focus.sourceIndex}`;
    case "trace-node":
      return `trace-node:${focus.node}`;
    case "output-message":
      return "output-message";
    case "output-block":
      return `output-block:${focus.contentIndex}:${focus.section ?? "content"}`;
    case "compaction-section":
      return `compaction:${focus.section}`;
  }
}

function filterTreeNodes(
  nodes: readonly TraceTreeNode[],
  normalizedQuery: string,
): readonly TraceTreeNode[] {
  if (!normalizedQuery) return nodes;
  return nodes.flatMap((node) => {
    if (
      [node.label, node.meta, node.trailing, node.event?.toolName, node.event?.model?.model].some(
        (value) => value?.toLowerCase().includes(normalizedQuery),
      )
    ) {
      return [node];
    }
    const children = node.children ? filterTreeNodes(node.children, normalizedQuery) : [];
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

function TraceTree({
  expanded,
  forceExpanded,
  nodes,
  onLoadDetail,
  onSelect,
  onToggle,
  selectedFocusKey,
  selectedTraceId,
}: {
  expanded: ReadonlySet<string>;
  forceExpanded: boolean;
  nodes: readonly TraceTreeNode[];
  onLoadDetail(traceId: string): void;
  onSelect(event: SessionContextTraceEventSummary, focus?: ContextTraceDetailFocus): void;
  onToggle(id: string): void;
  selectedFocusKey: string;
  selectedTraceId?: string;
}) {
  return nodes.map((node) => {
    const Icon = node.icon;
    const canExpand = node.expandable ?? Boolean(node.children?.length);
    const open = canExpand && (forceExpanded || expanded.has(node.id));
    const selected =
      node.event?.traceId === selectedTraceId &&
      contextTraceDetailFocusKey(node.focus) === selectedFocusKey;
    return (
      <div key={node.id}>
        <button
          type="button"
          className={cn(
            "hover:bg-muted/45 focus-visible:ring-ring relative flex min-h-7 w-full items-center gap-1.5 px-2 text-start text-xs outline-none focus-visible:ring-2",
            node.rowTone,
            selected && "bg-blue-500/8",
          )}
          aria-expanded={canExpand ? open : undefined}
          aria-pressed={node.event ? selected : undefined}
          title={node.title}
          onClick={() => {
            if (canExpand && !forceExpanded) onToggle(node.id);
            node.loadTraceIds?.forEach(onLoadDetail);
            if (node.event) onSelect(node.event, node.focus);
          }}
        >
          {selected ? <span className="absolute inset-y-0 start-0 w-0.5 bg-blue-500" /> : null}
          <span
            className={cn(
              "text-muted-foreground flex w-4 shrink-0 items-center justify-center",
              node.tone,
            )}
          >
            {canExpand ? (
              <ChevronRightIcon
                className={cn("size-3 transition-transform", open && "rotate-90")}
              />
            ) : null}
          </span>
          {Icon ? <Icon className={cn("size-3.5 shrink-0", node.tone)} /> : null}
          <span
            className={cn(
              "shrink-0 font-medium",
              node.badgeTone ? "rounded px-1.5 py-0.5" : node.tone,
              node.badgeTone,
            )}
          >
            {node.label}
          </span>
          {node.meta ? (
            <span
              className={cn("text-muted-foreground min-w-0 truncate text-[11px]", node.metaTone)}
            >
              {node.meta}
            </span>
          ) : null}
          {node.trailing ? (
            <span className="text-muted-foreground ms-auto shrink-0 font-mono text-[10px] tabular-nums">
              {node.trailing}
            </span>
          ) : null}
        </button>
        {open && node.children ? (
          <div className="border-border/60 ms-4 border-s ps-1">
            <TraceTree
              expanded={expanded}
              forceExpanded={forceExpanded}
              nodes={node.children}
              onLoadDetail={onLoadDetail}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedFocusKey={selectedFocusKey}
              selectedTraceId={selectedTraceId}
            />
          </div>
        ) : null}
      </div>
    );
  });
}

export function ContextTraceContextView({
  detailByTraceId,
  events,
  onLoadDetail,
  onSelect,
  query,
  selectedFocus,
  selectedTraceId,
}: {
  detailByTraceId: ReadonlyMap<string, ContextTraceDetailState>;
  events: readonly SessionContextTraceEventSummary[];
  firstTime: number;
  onLoadDetail(traceId: string): void;
  onSelect(event: SessionContextTraceEventSummary, focus?: ContextTraceDetailFocus): void;
  query: string;
  selectedFocus?: ContextTraceDetailFocus;
  selectedTraceId?: string;
}) {
  const { number, t } = useI18n();
  const turns = useMemo(() => projectContextTraceTurns(events), [events]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const initializedTurnRef = useRef<string | undefined>(undefined);
  const initializedStepRef = useRef<string | undefined>(undefined);
  const latestTurn = turns.at(-1);
  const defaultStep = latestTurn?.steps[0];

  useEffect(() => {
    if (!latestTurn || initializedTurnRef.current === latestTurn.id) return;
    initializedTurnRef.current = latestTurn.id;
    initializedStepRef.current = undefined;
    setExpanded(new Set([`turn:${latestTurn.id}`]));
  }, [latestTurn]);

  useEffect(() => {
    if (!defaultStep || initializedStepRef.current === defaultStep.id) return;
    initializedStepRef.current = defaultStep.id;
    setExpanded((current) => new Set([...current, `step:${defaultStep.id}`]));
  }, [defaultStep]);

  const tokenLabel = (value: number | undefined) =>
    value === undefined
      ? undefined
      : t("extensions.contextTrace.tokenCount", { value: formatCompactTokenNumber(value) });
  const estimatedTokenLabel = (value: number | undefined) =>
    value === undefined
      ? undefined
      : t("extensions.contextTrace.estimatedTokenCount", {
          value: formatCompactTokenNumber(value),
        });
  const durationLabel = (value: number | undefined) =>
    value === undefined ? undefined : t("extensions.contextTrace.duration", { value });
  const contextWindowLabel = (usage: SessionContextTraceContextUsage | undefined) => {
    if (!usage) return undefined;
    return t("extensions.contextTrace.contextWindowUsage", {
      used: usage.tokens === null ? "—" : formatCompactTokenNumber(usage.tokens),
      window: formatCompactTokenNumber(usage.contextWindow),
      percent:
        usage.percent === null ? "—" : `${number(usage.percent, { maximumFractionDigits: 1 })}%`,
    });
  };
  const usageTitle = (usage: SessionContextTraceTokenUsage | undefined, duration?: number) => {
    if (!usage) return undefined;
    const prompt = contextInputTokens(usage) ?? 0;
    const cached = usage.cacheRead;
    const uncached = usage.input + usage.cacheWrite;
    return t("extensions.contextTrace.modelStepTokenBreakdown", {
      input: number(prompt),
      cached: number(cached),
      uncached: number(uncached),
      output: number(usage.output),
      reasoning: usage.reasoning === undefined ? "—" : number(usage.reasoning),
      duration: duration === undefined ? "—" : durationLabel(duration)!,
    });
  };

  const loadingNode = (id: string): TraceTreeNode => ({
    id,
    label: t("extensions.contextTrace.loadingTreeData"),
    tone: "text-muted-foreground",
  });

  const executionNode = (
    step: ContextTraceModelStep,
    execution: ContextTraceToolExecution | undefined,
    parentId: string,
  ): TraceTreeNode | undefined => {
    if (!execution) return undefined;
    const event = execution.end ?? execution.start;
    if (!event) return undefined;
    return {
      id: `${parentId}:execution`,
      label: t("extensions.contextTrace.tree.execution"),
      icon: WrenchIcon,
      tone: EVENT_TONES.tool,
      trailing:
        execution.end === undefined
          ? t("extensions.contextTrace.running")
          : durationLabel(execution.duration),
      event,
      loadTraceIds: [event.traceId],
    };
  };

  const outputChildren = (step: ContextTraceModelStep): readonly TraceTreeNode[] => {
    const output = step.output;
    if (!output) return [];
    const detail = readyEvent(detailByTraceId, output.traceId);
    const capture = outputMessageCapture(detail);
    if (!capture) return [loadingNode(`output:${step.id}:loading`)];
    return listContextTraceOutputBlocks(capture.value).map((block): TraceTreeNode => {
      const id = `output:${step.id}:${block.contentIndex}`;
      if (block.kind === "tool-call") {
        const execution = step.toolExecutions.find(
          (candidate) => candidate.toolCallId === block.toolCallId,
        );
        const executionChild = executionNode(step, execution, id);
        return {
          id,
          label: t("extensions.contextTrace.tree.toolCall", { name: block.toolName ?? "—" }),
          icon: WrenchIcon,
          tone: EVENT_TONES.tool,
          event: output,
          focus: { type: "output-block", contentIndex: block.contentIndex },
          expandable: true,
          loadTraceIds: [
            output.traceId,
            ...(execution?.start ? [execution.start.traceId] : []),
            ...(execution?.end ? [execution.end.traceId] : []),
          ],
          children: [
            {
              id: `${id}:arguments`,
              label: t("extensions.contextTrace.tree.arguments"),
              icon: BracesIcon,
              event: output,
              focus: {
                type: "output-block",
                contentIndex: block.contentIndex,
                section: "arguments",
              },
              loadTraceIds: [output.traceId],
            },
            ...(executionChild ? [executionChild] : []),
          ],
        };
      }
      return {
        id,
        label:
          block.kind === "reasoning"
            ? t("extensions.contextTrace.tree.reasoningSummary")
            : t("extensions.contextTrace.tree.text"),
        icon: block.kind === "reasoning" ? SparklesIcon : TextIcon,
        tone: block.kind === "reasoning" ? EVENT_TONES.modelStep : EVENT_TONES.output,
        event: output,
        focus: { type: "output-block", contentIndex: block.contentIndex },
        loadTraceIds: [output.traceId],
      };
    });
  };

  const contextChildren = (turn: ContextTraceTurn, step: ContextTraceModelStep) => {
    const prompt = turn.prompt;
    const promptDetail = readyEvent(detailByTraceId, prompt?.traceId);
    const composition = promptDetail?.kind === "prompt-composition" ? promptDetail : undefined;
    const snapshot = step.context;
    const snapshotDetail = readyEvent(detailByTraceId, snapshot?.traceId);
    const context = snapshotDetail?.kind === "context-snapshot" ? snapshotDetail : undefined;
    const activeTools = composition?.detail.tools.filter((tool) => tool.active);
    const messages = context
      ? listContextTraceMessages(
          context.detail.messages.value,
          context.detail.messageTokenEstimates?.tokens,
        )
      : undefined;
    const attachments = composition ? jsonArrayLength(composition.detail.images.value) : undefined;

    const instructionChildren: TraceTreeNode[] = prompt
      ? [
          {
            id: `instructions:${step.id}:system`,
            label: t("extensions.contextTrace.tree.system"),
            icon: ShieldIcon,
            tone: EVENT_TONES.instruction,
            event: prompt,
            focus: { type: "prompt-section", section: "system-prompt" },
            loadTraceIds: [prompt.traceId],
          },
          {
            id: `instructions:${step.id}:skills`,
            label: t("extensions.contextTrace.tree.skills"),
            icon: PackageIcon,
            tone: EVENT_TONES.skills,
            trailing:
              composition === undefined
                ? t("extensions.contextTrace.contextCountPending")
                : number(composition.detail.systemPromptOptions.skills.length),
            event: prompt,
            focus: { type: "prompt-section", section: "skills" },
            loadTraceIds: [prompt.traceId],
          },
          ...(composition?.detail.systemPromptOptions.contextFiles.length
            ? [
                {
                  id: `instructions:${step.id}:context-files`,
                  label: t("extensions.contextTrace.tree.contextFiles"),
                  icon: FileTextIcon,
                  tone: EVENT_TONES.instruction,
                  trailing: number(composition.detail.systemPromptOptions.contextFiles.length),
                  event: prompt,
                  focus: { type: "prompt-section" as const, section: "context-files" as const },
                  loadTraceIds: [prompt.traceId],
                },
              ]
            : []),
        ]
      : [];

    const toolChildren: TraceTreeNode[] =
      prompt && activeTools
        ? activeTools.map((tool) => ({
            id: `tools:${step.id}:${tool.name}`,
            label: tool.name,
            icon: WrenchIcon,
            tone: EVENT_TONES.toolSchema,
            event: prompt,
            focus: { type: "prompt-tool", toolName: tool.name },
            loadTraceIds: [prompt.traceId],
          }))
        : [loadingNode(`tools:${step.id}:loading`)];

    const conversationChildren: TraceTreeNode[] = snapshot
      ? messages
        ? messages.map((message) => ({
            id: `conversation:${step.id}:${message.sourceIndex}`,
            label:
              message.role === "tool"
                ? t("extensions.contextTrace.tree.toolResult", {
                    name: message.toolName ?? "—",
                  })
                : message.role === "compaction"
                  ? t("extensions.contextTrace.tree.compactionSummary")
                  : t(`extensions.contextTrace.contextRoles.${message.role}`),
            icon: roleIcon(message.role),
            tone: roleTone(message.role),
            meta:
              message.role === "compaction"
                ? t("extensions.contextTrace.compactionInsertionPosition", {
                    index: message.sourceIndex + 1,
                  })
                : t("extensions.contextTrace.contextMessageNumber", {
                    index: message.sourceIndex + 1,
                  }),
            title: message.preview || undefined,
            trailing: estimatedTokenLabel(message.estimatedTokens),
            event: snapshot,
            focus: { type: "context-message", sourceIndex: message.sourceIndex },
            loadTraceIds: [snapshot.traceId],
          }))
        : [loadingNode(`conversation:${step.id}:loading`)]
      : [];

    const runtimeChildren: TraceTreeNode[] = prompt
      ? composition
        ? attachments && attachments > 0
          ? [
              {
                id: `runtime:${step.id}:attachments`,
                label: t("extensions.contextTrace.tree.attachments"),
                icon: ImageIcon,
                tone: EVENT_TONES.runtime,
                trailing: number(attachments),
                event: prompt,
                focus: { type: "prompt-section", section: "attachments" },
                loadTraceIds: [prompt.traceId],
              },
            ]
          : []
        : [loadingNode(`runtime:${step.id}:loading`)]
      : [];

    const contextLoadIds = [prompt?.traceId, snapshot?.traceId].filter((value): value is string =>
      Boolean(value),
    );
    return [
      {
        id: `instructions:${step.id}`,
        label: t("extensions.contextTrace.tree.instructions"),
        icon: ShieldIcon,
        tone: EVENT_TONES.instruction,
        trailing:
          composition === undefined
            ? t("extensions.contextTrace.contextCountPending")
            : number(
                1 +
                  composition.detail.systemPromptOptions.skills.length +
                  composition.detail.systemPromptOptions.contextFiles.length,
              ),
        event: prompt,
        expandable: Boolean(prompt),
        loadTraceIds: prompt ? [prompt.traceId] : [],
        children: instructionChildren,
      },
      {
        id: `tools:${step.id}`,
        label: t("extensions.contextTrace.tree.tools"),
        icon: BracesIcon,
        tone: EVENT_TONES.toolSchema,
        trailing:
          activeTools === undefined
            ? t("extensions.contextTrace.contextCountPending")
            : number(activeTools.length),
        event: prompt,
        focus: { type: "prompt-section", section: "tool-schema" },
        expandable: Boolean(prompt),
        loadTraceIds: prompt ? [prompt.traceId] : [],
        children: toolChildren,
      },
      {
        id: `conversation:${step.id}`,
        label: t("extensions.contextTrace.tree.conversation"),
        icon: MessageSquareIcon,
        tone: EVENT_TONES.conversation,
        trailing:
          messages === undefined
            ? snapshot
              ? t("extensions.contextTrace.contextCountPending")
              : "0"
            : number(messages.length),
        event: snapshot,
        focus: { type: "trace-node", node: "conversation" },
        expandable: Boolean(snapshot),
        loadTraceIds: snapshot ? [snapshot.traceId] : [],
        children: conversationChildren,
      },
      {
        id: `runtime:${step.id}`,
        label: t("extensions.contextTrace.tree.runtime"),
        icon: PackageIcon,
        tone: EVENT_TONES.runtime,
        trailing:
          attachments === undefined
            ? prompt
              ? t("extensions.contextTrace.contextCountPending")
              : "0"
            : number(attachments),
        event: prompt,
        focus: { type: "prompt-section", section: "attachments" },
        expandable: Boolean(prompt && (composition === undefined || runtimeChildren.length > 0)),
        loadTraceIds: contextLoadIds,
        children: runtimeChildren,
      },
    ] satisfies readonly TraceTreeNode[];
  };

  const stepNode = (turn: ContextTraceTurn, step: ContextTraceModelStep): TraceTreeNode => {
    const model = step.model?.model;
    const thinking = step.thinkingLevel;
    const input = contextInputTokens(step.usage);
    const contextUsage = step.context?.contextUsage ?? turn.prompt?.contextUsage;
    const occupancy = contextWindowLabel(contextUsage);
    const flow = step.usage
      ? t("extensions.contextTrace.tokenFlow", {
          input: formatCompactTokenNumber(input ?? 0),
          output: formatCompactTokenNumber(step.usage.output),
        })
      : undefined;
    const output = step.output;
    return {
      id: `step:${step.id}`,
      label: t("extensions.contextTrace.tree.modelStep", { index: step.index }),
      icon: BotIcon,
      tone: EVENT_TONES.modelStep,
      meta: [model, thinking].filter(Boolean).join(" · ") || undefined,
      trailing: [flow, durationLabel(step.duration)].filter(Boolean).join(" · ") || undefined,
      title:
        [usageTitle(step.usage, step.duration), occupancy].filter(Boolean).join("\n") || undefined,
      event: output ?? step.context ?? step.start,
      focus: { type: "trace-node", node: "model-step" },
      expandable: true,
      children: [
        {
          id: `context:${step.id}`,
          label: t("extensions.contextTrace.tree.context"),
          icon: BracesIcon,
          tone: EVENT_TONES.context,
          trailing: occupancy ?? tokenLabel(input),
          event: step.context ?? turn.prompt,
          focus: { type: "trace-node", node: "context" },
          expandable: true,
          loadTraceIds: [turn.prompt?.traceId, step.context?.traceId].filter(
            (value): value is string => Boolean(value),
          ),
          children: contextChildren(turn, step),
        },
        {
          id: `output:${step.id}`,
          label: t("extensions.contextTrace.tree.output"),
          icon: SparklesIcon,
          tone: EVENT_TONES.output,
          trailing: tokenLabel(step.usage?.output),
          event: output,
          focus: output ? { type: "output-message" } : undefined,
          expandable: Boolean(output),
          loadTraceIds: output ? [output.traceId] : [],
          children: outputChildren(step),
        },
      ],
    };
  };

  const turnNodes: readonly TraceTreeNode[] = turns.map((turn) => {
    const prompt = turn.prompt;
    const promptPreview = prompt?.promptPreview;
    const children: TraceTreeNode[] = [];
    if (prompt) {
      children.push({
        id: `user:${turn.id}`,
        label: t("extensions.contextTrace.tree.userMessage"),
        icon: UserIcon,
        tone: EVENT_TONES.user,
        event: prompt,
        focus: { type: "prompt-section", section: "user-prompt" },
        loadTraceIds: [prompt.traceId],
      });
    }
    for (const item of turn.items) {
      if (item.type === "model-step") {
        children.push(stepNode(turn, item.step));
      } else if (item.type === "system-event") {
        children.push({
          id: `system-event:${item.event.traceId}`,
          label: t("extensions.contextTrace.tree.retry"),
          icon: RotateCwIcon,
          tone: EVENT_TONES.systemEvent,
          event: item.event,
          loadTraceIds: [item.event.traceId],
        });
      } else {
        const event = item.end ?? item.start;
        if (!event) continue;
        const data = item.end?.compaction ?? item.start?.compaction;
        const before = data?.tokensBefore;
        const after = data?.estimatedTokensAfter;
        const transition =
          before === undefined
            ? undefined
            : after === undefined
              ? tokenLabel(before)
              : t("extensions.contextTrace.tokenFlow", {
                  input: formatCompactTokenNumber(before),
                  output: formatCompactTokenNumber(after),
                });
        const detailEvent = item.end ?? item.start;
        const detailTraceIds = detailEvent ? [detailEvent.traceId] : [];
        const compactionChildren: TraceTreeNode[] = item.end
          ? [
              {
                id: `compaction:${item.firstSeq}:overview`,
                label: t("extensions.contextTrace.tree.compactionOverview"),
                icon: RotateCwIcon,
                tone: EVENT_TONES.systemEvent,
                event: item.end,
                focus: { type: "compaction-section", section: "overview" },
                loadTraceIds: [item.end.traceId],
              },
              ...(data?.firstKeptEntryId
                ? [
                    {
                      id: `compaction:${item.firstSeq}:summary`,
                      label: t("extensions.contextTrace.tree.compactionSummary"),
                      icon: FileTextIcon,
                      tone: EVENT_TONES.systemEvent,
                      event: item.end,
                      focus: { type: "compaction-section" as const, section: "summary" as const },
                      loadTraceIds: [item.end.traceId],
                    },
                  ]
                : []),
              ...(data?.summarizedMessageCount
                ? [
                    {
                      id: `compaction:${item.firstSeq}:messages`,
                      label: t("extensions.contextTrace.tree.compactionMessages"),
                      icon: MessageSquareIcon,
                      tone: EVENT_TONES.conversation,
                      trailing: number(data.summarizedMessageCount),
                      event: item.end,
                      focus: {
                        type: "compaction-section" as const,
                        section: "messages-to-summarize" as const,
                      },
                      loadTraceIds: [item.end.traceId],
                    },
                  ]
                : []),
              ...(data?.turnPrefixMessageCount
                ? [
                    {
                      id: `compaction:${item.firstSeq}:turn-prefix`,
                      label: t("extensions.contextTrace.tree.compactionTurnPrefix"),
                      icon: MessageSquareIcon,
                      tone: EVENT_TONES.conversation,
                      trailing: number(data.turnPrefixMessageCount),
                      event: item.end,
                      focus: {
                        type: "compaction-section" as const,
                        section: "turn-prefix" as const,
                      },
                      loadTraceIds: [item.end.traceId],
                    },
                  ]
                : []),
            ]
          : [];
        children.push({
          id: `compaction:${item.firstSeq}`,
          label: t("extensions.contextTrace.tree.compaction"),
          icon: RotateCwIcon,
          tone: EVENT_TONES.systemEvent,
          meta: data ? t(`extensions.contextTrace.compactionReasons.${data.reason}`) : undefined,
          trailing:
            transition ??
            (item.end
              ? t("extensions.contextTrace.completed")
              : t("extensions.contextTrace.running")),
          event: detailEvent,
          expandable: compactionChildren.length > 0,
          loadTraceIds: detailTraceIds,
          children: compactionChildren,
        });
      }
    }
    if (turn.finalOutput) {
      children.push({
        id: `final:${turn.id}`,
        label: t("extensions.contextTrace.tree.finalResponse"),
        icon: SparklesIcon,
        tone: EVENT_TONES.finalResponse,
        trailing: tokenLabel(turn.finalOutput.usage?.output),
        event: turn.finalOutput,
        focus: { type: "trace-node", node: "final-response" },
        loadTraceIds: [turn.finalOutput.traceId],
      });
    }
    return {
      id: `turn:${turn.id}`,
      label: t("extensions.contextTrace.tree.turn", { index: turn.index }),
      icon: MessageSquareIcon,
      tone: EVENT_TONES.turn.tone,
      badgeTone: EVENT_TONES.turn.badgeTone,
      metaTone: EVENT_TONES.turn.metaTone,
      rowTone: EVENT_TONES.turn.rowTone,
      meta: promptPreview ?? t("extensions.contextTrace.tree.userInteraction"),
      trailing: durationLabel(turn.duration),
      title: promptPreview,
      event: turn.start,
      expandable: true,
      children,
    };
  });

  const normalizedQuery = query.trim().toLowerCase();
  const visibleNodes = filterTreeNodes(turnNodes, normalizedQuery);
  if (turns.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <MessageSquareIcon className="size-7 opacity-45" />
        <p className="text-foreground font-medium">
          {t("extensions.contextTrace.noContextSnapshots")}
        </p>
        <p>{t("extensions.contextTrace.noContextSnapshotsDescription")}</p>
      </div>
    );
  }
  if (visibleNodes.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-xs">
        {t("extensions.contextTrace.noMatches")}
      </div>
    );
  }

  return (
    <div className="divide-y">
      <TraceTree
        nodes={visibleNodes}
        expanded={expanded}
        forceExpanded={Boolean(normalizedQuery)}
        selectedTraceId={selectedTraceId}
        selectedFocusKey={contextTraceDetailFocusKey(selectedFocus)}
        onLoadDetail={onLoadDetail}
        onSelect={onSelect}
        onToggle={(id) =>
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    </div>
  );
}
