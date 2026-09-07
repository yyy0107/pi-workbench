"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import type { ToolboxCapabilityItem } from "./toolbox-catalog";

export function ToolboxResourceGroup({
  items,
  query,
  renderItem,
}: {
  items: readonly ToolboxCapabilityItem[];
  query: string;
  renderItem(item: ToolboxCapabilityItem): ReactNode;
}) {
  const { locale, t } = usePiI18n();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const remaining = items.slice(6);
  const canExpand = !query.trim() && remaining.length > 0;

  return (
    <>
      <ul id={listId} className="grid grid-cols-1 gap-x-6 gap-y-3 @2xl:grid-cols-2">
        {(canExpand && !expanded ? items.slice(0, 6) : items).map(renderItem)}
      </ul>
      {canExpand ? (
        <Button
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={listId}
          data-selection="none"
          data-frame="none"
          className="text-muted-foreground mt-3 h-auto max-w-full justify-start px-3 text-left font-normal whitespace-normal"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? t("extensions.toolbox.showLess")
            : t("extensions.toolbox.viewRemaining", {
                names: new Intl.ListFormat(locale, {
                  style: "narrow",
                  type: "conjunction",
                }).format(remaining.slice(0, 2).map((item) => item.name)),
                count: Math.max(0, remaining.length - 2),
              })}
        </Button>
      ) : null}
    </>
  );
}
