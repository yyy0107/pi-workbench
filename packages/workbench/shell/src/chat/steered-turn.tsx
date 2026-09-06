"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import { useConversationNodes } from "@workbench/agent-runtime-client";
import {
  parseWorkbenchMessageTermination,
  readWorkbenchTurnTiming,
} from "@workbench/agent-runtime-contracts/message-metadata";

import { useDisclosureScrollLock } from "../elements/use-disclosure-scroll-lock";
import { useI18n } from "../i18n";
import { CompletedTurnHeader } from "./completed-turn-header";
import { CompletedTurnContent } from "./completed-turn-content";
import { Collapsible } from "../ui/collapsible";
import { formatCompletedAt, formatCompletedDuration } from "./completed-turn-model";

interface SteeredTurnState {
  readonly open: boolean;
  readonly running: boolean;
  readonly finalMessageId?: string;
}

const SteeredTurnContext = createContext<SteeredTurnState | undefined>(undefined);
export const useSteeredTurn = () => useContext(SteeredTurnContext);

function selectTurnNode(node: ConversationNode) {
  return {
    key: node.key,
    kind: node.kind,
    createdAt: node.createdAt,
    timing:
      node.kind === "assistant"
        ? readWorkbenchTurnTiming(node.presentation?.custom?.workbenchTurnTiming)
        : undefined,
    termination: parseWorkbenchMessageTermination(node.presentation?.custom?.workbenchTermination)
      ?.kind,
  };
}

function sameTurnNode(
  left: ReturnType<typeof selectTurnNode>,
  right: ReturnType<typeof selectTurnNode>,
) {
  return (
    left.key === right.key &&
    left.kind === right.kind &&
    left.createdAt === right.createdAt &&
    left.termination === right.termination &&
    left.timing?.startedAt === right.timing?.startedAt &&
    left.timing?.completedAt === right.timing?.completedAt
  );
}

export function SteeredTurnWork({ children }: PropsWithChildren) {
  const turn = useSteeredTurn();
  return (
    <Collapsible open={turn?.open ?? true}>
      <CompletedTurnContent keepMounted>{children}</CompletedTurnContent>
    </Collapsible>
  );
}

export function SteeredTurn({
  nodeKeys,
  running,
  children,
}: Readonly<{
  nodeKeys: readonly string[];
  running: boolean;
  children: (state: SteeredTurnState) => ReactNode;
}>) {
  const nodes = useConversationNodes({ nodeKeys, select: selectTurnNode, isEqual: sameTurnNode });
  const { t, locale, date } = useI18n();
  const contentId = useId();
  // An override belongs to one lifecycle phase; completion defaults to collapsed.
  const [override, setOverride] = useState<{ running: boolean; open: boolean }>();
  const open = running || (override?.running === running && override.open === true);
  useEffect(() => setOverride({ running, open: false }), [running]);
  const [rootRef, setOpen] = useDisclosureScrollLock((value) =>
    setOverride({ running, open: value }),
  );
  const lastMessage = nodes.findLast((node) => node.kind === "assistant" || node.kind === "user");
  const finalMessageId = lastMessage?.kind === "assistant" ? lastMessage.key : undefined;
  const timings = nodes.flatMap((node) => (node.timing ? [node.timing] : []));
  const now = Date.now();
  const completedAt = timings.length
    ? Math.max(...timings.map((timing) => timing.completedAt))
    : (lastMessage?.createdAt ?? now);
  const label = t("extensions.messagePresentation.completedTurn", {
    completedAt: formatCompletedAt(completedAt, now, { date }),
    duration: formatCompletedDuration(
      timings.length
        ? completedAt - Math.min(...timings.map((timing) => timing.startedAt))
        : undefined,
      locale,
    ),
    kind: lastMessage?.termination ?? "completed",
  });
  const state = { open, running, finalMessageId };

  return (
    <SteeredTurnContext.Provider value={state}>
      <div ref={rootRef} data-slot="steered-turn" className="w-full [overflow-anchor:none]">
        {!running ? (
          <div className="mb-2">
            <CompletedTurnHeader
              label={label}
              data-open={open || undefined}
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setOpen(!open)}
            />
            <hr className="mt-2 border-border" />
          </div>
        ) : null}
        <div id={contentId} className="flex flex-col">
          {children(state)}
        </div>
      </div>
    </SteeredTurnContext.Provider>
  );
}
