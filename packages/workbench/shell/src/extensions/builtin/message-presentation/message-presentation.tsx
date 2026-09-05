"use client";

import { useMemo, type PropsWithChildren, type ReactNode } from "react";

import type { DataBlock, MessageBlock } from "@workbench/agent-runtime-contracts/conversation";
import {
  parseWorkbenchMessageTermination,
  readWorkbenchTurnTiming,
  resolveWorkbenchTurnDuration,
} from "@workbench/agent-runtime-contracts/message-metadata";
import type { DataPresentationDefinition, MessageRendererProps } from "@workbench/extension-sdk";
import {
  RendererHost,
  useDataPresentationMap,
} from "@workbench/extension-host/hosts/renderer-host";

import {
  WorkbenchMessageDataBlock,
  WorkbenchMessageFileBlock,
  WorkbenchMessageReasoningBlock,
  WorkbenchMessageSourceBlock,
  WorkbenchMessageTextBlock,
  WorkbenchMessageToolBlock,
} from "../../../chat/renderers/message-blocks";
import { ReasoningPanel } from "../../../elements/reasoning-panel";
import type { Source } from "../../../elements/inline-citation";
import { useI18n } from "../../../i18n";
import { useConversationPreferences } from "../../../chat/conversation-preferences";
import { SteeredTurnWork, useSteeredTurn } from "../../../chat/steered-turn";

import {
  completedWorkBoundary,
  formatCompletedAt,
  formatCompletedDuration,
} from "../../../chat/completed-turn-model";
import { CompletedTurnPanel } from "./completed-turn-panel";
import { messageCitationLayout } from "./message-citations";
import { MessageDisclosureProvider, useMessageDisclosure } from "./message-disclosure-context";
import { messageAttachmentReference, visibleMessageBlocks } from "./message-presentation-policy";
import { MessageToolTimeline } from "./message-tool-timeline";
import { dataTimelineState, type DataTimelineState } from "./tool-timeline-model";

function MessageDataTimelineGroup({
  children,
  group,
  firstIndex,
  running,
}: PropsWithChildren<{
  group: NonNullable<DataTimelineState["group"]>;
  firstIndex: number;
  running: boolean;
}>) {
  const { text } = useI18n();
  const [open, setOpen] = useMessageDisclosure("steps", `data-group:${firstIndex}`);

  return (
    <ReasoningPanel
      steps={[{ marker: false, body: <div className="space-y-1">{children}</div> }]}
      visibleSteps={1}
      streaming={running}
      open={open}
      onOpenChange={setOpen}
      activeLabel={text(group.activeLabel)}
      restingLabel={text(group.label)}
      icon={group.icon}
      className="my-1 max-w-none [overflow-anchor:none]"
    />
  );
}

function PresentedBlock({
  block,
  index,
  node,
  inlineSourcePartIndices,
  sources,
}: Readonly<{
  block: MessageBlock;
  index: number;
  node: MessageRendererProps["node"];
  inlineSourcePartIndices: ReadonlySet<number>;
  sources?: readonly Source[];
}>) {
  const { t } = useI18n();
  const attachmentReference =
    node.kind === "user" ? messageAttachmentReference(node.blocks, index) : undefined;
  const referenceLabel = attachmentReference
    ? t(
        attachmentReference.kind === "image"
          ? "extensions.messagePresentation.attachmentReference.image"
          : "extensions.messagePresentation.attachmentReference.pdf",
        { index: attachmentReference.sequence },
      )
    : undefined;
  const streaming =
    node.kind === "assistant" &&
    node.status === "running" &&
    !node.blocks.slice(index + 1).some((candidate) => candidate.kind === "text");
  const fallback = (() => {
    switch (block.kind) {
      case "text":
        return (
          <WorkbenchMessageTextBlock
            block={block}
            composerDocument={node.presentation?.custom?.workbenchComposerDocument}
            role={node.kind}
            sources={sources}
            streaming={streaming}
          />
        );
      case "reasoning":
        return <WorkbenchMessageReasoningBlock block={block} />;
      case "tool-call":
        return <WorkbenchMessageToolBlock block={block} />;
      case "data":
        return <WorkbenchMessageDataBlock block={block} />;
      case "file":
        return <WorkbenchMessageFileBlock block={block} referenceLabel={referenceLabel} />;
      case "source":
        return inlineSourcePartIndices.has(index) ? null : (
          <WorkbenchMessageSourceBlock
            block={block}
            fallbackLabel={t("extensions.messagePresentation.sourceFallback")}
            variant="chip"
          />
        );
      case "error":
        return null;
    }
  })();

  return <RendererHost node={node} block={block} fallback={fallback} />;
}

function groupedDataIdentity(
  block: MessageBlock | undefined,
  presentations: Readonly<Record<string, DataPresentationDefinition>>,
): { block: DataBlock; state: DataTimelineState; identity: string } | undefined {
  if (block?.kind !== "data") return undefined;
  const state = dataTimelineState(block, presentations);
  return state?.group
    ? { block, state, identity: `${block.name}\u0000${state.group.key}` }
    : undefined;
}

function belongsToPlainTimeline(
  block: MessageBlock | undefined,
  presentations: Readonly<Record<string, DataPresentationDefinition>>,
): boolean {
  if (block?.kind === "reasoning" || block?.kind === "tool-call") return true;
  if (block?.kind !== "data") return false;
  const state = dataTimelineState(block, presentations);
  return state !== undefined && state.group === undefined;
}

function MessageBlockRange({
  end,
  groupParallelTools,
  node,
  presentations,
  start,
}: Readonly<{
  end: number;
  groupParallelTools: boolean;
  node: MessageRendererProps["node"];
  presentations: Readonly<Record<string, DataPresentationDefinition>>;
  start: number;
}>) {
  const citationLayout = useMemo(() => messageCitationLayout(node.blocks), [node.blocks]);
  const content: ReactNode[] = [];
  let index = start;

  while (index < end) {
    const grouped = groupedDataIdentity(node.blocks[index], presentations);
    if (grouped?.state.group) {
      const indices: number[] = [];
      let running = false;
      while (index < end) {
        const candidate = groupedDataIdentity(node.blocks[index], presentations);
        if (!candidate || candidate.identity !== grouped.identity) break;
        indices.push(index);
        running ||= candidate.state.active;
        index += 1;
      }
      content.push(
        <MessageDataTimelineGroup
          key={`data-group:${grouped.identity}:${indices[0]}`}
          group={grouped.state.group}
          firstIndex={indices[0] ?? start}
          running={running}
        >
          {indices.map((blockIndex) => {
            const block = node.blocks[blockIndex];
            return block ? (
              <PresentedBlock
                key={block.key}
                node={node}
                block={block}
                index={blockIndex}
                inlineSourcePartIndices={citationLayout.inlineSourcePartIndices}
                sources={citationLayout.byTextPart.get(blockIndex)}
              />
            ) : null;
          })}
        </MessageDataTimelineGroup>,
      );
      continue;
    }

    if (belongsToPlainTimeline(node.blocks[index], presentations)) {
      const indices: number[] = [];
      while (
        index < end &&
        belongsToPlainTimeline(node.blocks[index], presentations) &&
        !groupedDataIdentity(node.blocks[index], presentations)
      ) {
        indices.push(index);
        index += 1;
      }
      content.push(
        <MessageToolTimeline
          key={`timeline:${indices[0]}`}
          node={node}
          indices={indices}
          blocks={node.blocks}
          transportRecovering={false}
          groupParallelTools={groupParallelTools}
        />,
      );
      continue;
    }

    const block = node.blocks[index];
    if (block) {
      content.push(
        <PresentedBlock
          key={block.key}
          node={node}
          block={block}
          index={index}
          inlineSourcePartIndices={citationLayout.inlineSourcePartIndices}
          sources={citationLayout.byTextPart.get(index)}
        />,
      );
    }
    index += 1;
  }

  return content;
}

export function WorkbenchMessagePresentation({ node: sourceNode }: MessageRendererProps) {
  const steeredTurn = useSteeredTurn();
  const { t, date, locale, relativeTime } = useI18n();
  const { showReasoning, showTodos, groupParallelTools } = useConversationPreferences(
    (state) => state.preferences,
  );
  const node = useMemo(
    () => ({
      ...sourceNode,
      blocks: visibleMessageBlocks(sourceNode.blocks, showReasoning, showTodos),
    }),
    [sourceNode, showReasoning, showTodos],
  );
  const dataPresentations = useDataPresentationMap();
  const custom = node.presentation?.custom;
  const storedTurnTiming = custom?.workbenchTurnTiming;
  const turnTiming = readWorkbenchTurnTiming(storedTurnTiming);
  const termination = parseWorkbenchMessageTermination(custom?.workbenchTermination);
  const interruptedBySteering = custom?.workbenchSteerInterrupted === true;
  const turnStreaming = node.kind === "assistant" && node.status === "running";
  const completedBoundary = completedWorkBoundary(node.blocks);
  const now = Date.now();
  const completionTimestamp =
    turnTiming?.completedAt ?? node.createdAt ?? turnTiming?.startedAt ?? now;
  const completedLabel = t("extensions.messagePresentation.completedTurn", {
    completedAt: formatCompletedAt(completionTimestamp, now, { date, relativeTime }),
    duration: formatCompletedDuration(
      resolveWorkbenchTurnDuration(storedTurnTiming, undefined),
      locale,
    ),
    kind: termination?.kind ?? "completed",
  });
  const disclosurePhase = interruptedBySteering
    ? "steered"
    : turnStreaming
      ? "streaming"
      : "completed";
  const completedWork =
    node.kind === "assistant" && !interruptedBySteering && completedBoundary > 0;

  if (steeredTurn && node.kind === "assistant") {
    const finalMessage = steeredTurn.finalMessageId === node.key;
    return (
      <MessageDisclosureProvider phase={disclosurePhase}>
        {finalMessage && completedBoundary > 0 ? (
          <SteeredTurnWork>
            <MessageBlockRange
              node={node}
              start={0}
              end={completedBoundary}
              presentations={dataPresentations}
              groupParallelTools={groupParallelTools}
            />
          </SteeredTurnWork>
        ) : null}
        <MessageBlockRange
          node={node}
          start={finalMessage ? completedBoundary : 0}
          end={node.blocks.length}
          presentations={dataPresentations}
          groupParallelTools={groupParallelTools}
        />
      </MessageDisclosureProvider>
    );
  }

  return (
    <MessageDisclosureProvider phase={disclosurePhase}>
      {completedWork ? (
        <CompletedTurnPanel completed={!turnStreaming} label={completedLabel}>
          <MessageBlockRange
            node={node}
            start={0}
            end={completedBoundary}
            presentations={dataPresentations}
            groupParallelTools={groupParallelTools}
          />
        </CompletedTurnPanel>
      ) : null}
      <MessageBlockRange
        node={node}
        start={completedWork ? completedBoundary : 0}
        end={node.blocks.length}
        presentations={dataPresentations}
        groupParallelTools={groupParallelTools}
      />
    </MessageDisclosureProvider>
  );
}
