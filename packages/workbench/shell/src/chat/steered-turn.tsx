"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import { readWorkbenchTurnTiming } from "@workbench/agent-runtime-contracts/message-metadata";

import { Button } from "../ui/button";
import { useDisclosureScrollLock } from "../elements/use-disclosure-scroll-lock";
import { formatCompactDuration } from "../format-duration";
import { useI18n } from "../i18n";

interface SteeredTurnState {
  readonly open: boolean;
  readonly running: boolean;
  readonly finalMessageId?: string;
}

const SteeredTurnContext = createContext<SteeredTurnState | undefined>(undefined);
export const useSteeredTurn = () => useContext(SteeredTurnContext);

export function SteeredTurn({
  nodes,
  running,
  children,
}: Readonly<{
  nodes: readonly ConversationNode[];
  running: boolean;
  children: (state: SteeredTurnState) => ReactNode;
}>) {
  const { t, locale } = useI18n();
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
  const duration = timings.length
    ? formatCompactDuration(
        Math.max(...timings.map((timing) => timing.completedAt)) -
          Math.min(...timings.map((timing) => timing.startedAt)),
        locale,
        { includeZero: true },
      )
    : undefined;
  const state = { open, running, finalMessageId };

  return (
    <SteeredTurnContext.Provider value={state}>
      <div ref={rootRef} data-slot="steered-turn" className="w-full [overflow-anchor:none]">
        {!running ? (
          <div className="mb-2 border-b border-border pb-2">
            <Button
              variant="ghost"
              data-selection="none"
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setOpen(!open)}
              className="text-muted-foreground"
            >
              {duration
                ? t("workbench.chat.turnDuration", { duration })
                : t("workbench.chat.turnDetails")}
              <ChevronRightIcon aria-hidden="true" className={open ? "rotate-90" : undefined} />
            </Button>
          </div>
        ) : null}
        <div id={contentId} className="flex flex-col gap-4">
          {children(state)}
        </div>
      </div>
    </SteeredTurnContext.Provider>
  );
}
