"use client";

import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { useDisclosureScrollLock } from "@workbench/shell/elements";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  collapsePanel,
} from "@workbench/shell/ui";

export function TokenUsageSection({
  label,
  value,
  markerClassName,
  children,
}: {
  label: string;
  value?: ReactNode;
  markerClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rootRef, onOpenChange] = useDisclosureScrollLock(setOpen);

  return (
    <Collapsible
      ref={rootRef}
      open={open}
      onOpenChange={onOpenChange}
      className="min-w-0 [overflow-anchor:none]"
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="group/section w-full justify-start gap-1.5 text-xs font-normal"
          />
        }
      >
        {markerClassName ? (
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${markerClassName}`} />
        ) : null}
        <span className="min-w-0 flex-1 text-start">{label}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{value}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className="text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-panel-open/section:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={collapsePanel}>
        <div className="px-2 pt-1 pb-1.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
