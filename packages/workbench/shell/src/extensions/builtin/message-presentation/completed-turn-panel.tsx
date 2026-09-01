"use client";

import type { PropsWithChildren } from "react";
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react";

import { collapsePanel } from "../../../elements/surfaces";
import { useDisclosureScrollLock } from "../../../elements/use-disclosure-scroll-lock";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/collapsible";
import { cn } from "../../../utils";

import { useMessageDisclosure } from "./message-disclosure-context";

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
    <Collapsible
      ref={rootRef}
      data-slot="completed-turn-panel"
      open={open}
      onOpenChange={handleOpenChange}
      className="w-full [overflow-anchor:none]"
    >
      <CollapsibleTrigger className="group/trigger text-foreground/55 hover:text-foreground/90 flex w-full items-center gap-1.5 py-1 text-[13.5px] transition-colors outline-none">
        <CheckCircle2Icon aria-hidden="true" className="text-foreground/45 size-3.5 shrink-0" />
        <span className="text-start leading-none">{label}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/trigger:opacity-60 group-focus-visible/trigger:opacity-60 group-data-open/trigger:rotate-90 group-data-open/trigger:opacity-60 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "w-full outline-none")}>
        <div className="w-full pt-1 pb-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
