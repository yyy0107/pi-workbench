"use client";

import type { PropsWithChildren } from "react";
import { CompletedTurnHeader } from "../../../chat/completed-turn-header";
import { CompletedTurnContent } from "../../../chat/completed-turn-content";

import { useDisclosureScrollLock } from "../../../elements/use-disclosure-scroll-lock";
import { Collapsible, CollapsibleTrigger } from "../../../ui/collapsible";

import { MessageDisclosureScope, useMessageDisclosure } from "./message-disclosure-context";

export function CompletedTurnPanel({
  completed,
  label,
  children,
}: PropsWithChildren<{
  completed: boolean;
  label: string;
}>) {
  const [open, setOpen] = useMessageDisclosure("completed-turn", "turn");
  const [rootRef, handleOpenChange] = useDisclosureScrollLock(setOpen);

  if (!completed) return children;

  return (
    <MessageDisclosureScope kind="completed-turn" id="turn">
      <Collapsible
        ref={rootRef}
        data-slot="completed-turn-panel"
        open={open}
        onOpenChange={handleOpenChange}
        className="mb-2 w-full [overflow-anchor:none]"
      >
        <CollapsibleTrigger render={<CompletedTurnHeader label={label} />} />
        <hr className="mt-2 border-border" />
        <CompletedTurnContent>
          <div className="w-full pt-1 pb-1">{children}</div>
        </CompletedTurnContent>
      </Collapsible>
    </MessageDisclosureScope>
  );
}
