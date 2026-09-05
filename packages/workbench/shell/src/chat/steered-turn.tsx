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

export function SteeredTurnWork({ children }: PropsWithChildren) {
  const turn = useSteeredTurn();
  return (
    <Collapsible open={turn?.open ?? true}>
      <CompletedTurnContent keepMounted>{children}</CompletedTurnContent>
    </Collapsible>
  );
}

export function SteeredTurn({
  nodes,
  running,
  children,
}: Readonly<{
  nodes: readonly ConversationNode[];
  running: boolean;
  children: (state: SteeredTurnState) => ReactNode;
}>) {
  const { t, locale, date, relativeTime } = useI18n();
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
  const timings = nodes.flatMap((node) => {
    const timing = readWorkbenchTurnTiming(node.presentation?.custom?.workbenchTurnTiming);
    return node.kind === "assistant" && timing ? [timing] : [];
  });
  const now = Date.now();
  const completedAt = timings.length
    ? Math.max(...timings.map((timing) => timing.completedAt))
    : (lastMessage?.createdAt ?? now);
  const termination = parseWorkbenchMessageTermination(
    lastMessage?.presentation?.custom?.workbenchTermination,
  );
  const label = t("extensions.messagePresentation.completedTurn", {
    completedAt: formatCompletedAt(completedAt, now, { date, relativeTime }),
    duration: formatCompletedDuration(
      timings.length
        ? completedAt - Math.min(...timings.map((timing) => timing.startedAt))
        : undefined,
      locale,
    ),
    kind: termination?.kind ?? "completed",
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
