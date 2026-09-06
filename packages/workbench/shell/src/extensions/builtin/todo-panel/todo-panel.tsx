"use client";

import { useEffect, useMemo, useState } from "react";
import { useConversationNodes, useConversationSession } from "@workbench/agent-runtime-client";
import type { ToolRendererComponent } from "@workbench/extension-sdk";
import { ChevronRightIcon, ListChecksIcon } from "lucide-react";

import {
  composerPanel,
  composerPanelIcon,
  composerPanelRow,
} from "../../../chat/composer-panel-styles";
import { useConversationPreferences } from "../../../chat/conversation-preferences";
import { TodoList } from "../../../chat/todo-list";
import { latestTodoSnapshots, readTodoSnapshot, type TodoSnapshot } from "../../../chat/todo-model";
import { useI18n } from "../../../i18n";
import { Button } from "../../../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/collapsible";
import { collapsePanel } from "../../../ui/surface";
import { cn } from "../../../utils";

export function useTodoPanelHidden(allCompleted: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!allCompleted) return;
    const timer = window.setTimeout(() => setHidden(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [allCompleted]);
  return allCompleted && hidden;
}

export function TodoPanelContent({ snapshots }: { snapshots: readonly TodoSnapshot[] }) {
  const { t } = useI18n();
  const items = snapshots.flatMap((snapshot) => snapshot.items);
  const hidden = useTodoPanelHidden(
    items.length > 0 && items.every((item) => item.status === "completed"),
  );
  // Clearing hides immediately; completion stays visible briefly and remains in the timeline.
  if (items.length === 0 || hidden) return null;
  const progress = t("extensions.todoPanel.progress", {
    completed: items.filter((item) => item.status === "completed").length,
    total: items.length,
  });
  return (
    <Collapsible
      defaultOpen
      data-slot="todo-panel"
      data-workbench-glass-surface=""
      className={composerPanel}
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            data-selection="none"
            className={cn(
              composerPanelRow,
              "group/todos w-full min-w-0 justify-start rounded-[inherit] border-0",
            )}
          />
        }
      >
        <span className={composerPanelIcon}>
          <ListChecksIcon aria-hidden="true" />
        </span>
        <span>{t("extensions.todoPanel.title")}</span>
        <span role="status" className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
          {progress}
        </span>
        <span className={cn(composerPanelIcon, "ml-auto")}>
          <ChevronRightIcon
            aria-hidden="true"
            className="transition-transform group-data-panel-open/todos:rotate-90 motion-reduce:transition-none"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className={collapsePanel}>
        <div className="max-h-[min(30dvh,16rem)] overflow-y-auto overscroll-contain border-t border-border/60 px-3 py-1">
          {snapshots.map((snapshot) => (
            <section key={snapshot.toolName} aria-label={snapshot.toolName}>
              {snapshots.length > 1 ? (
                <p className="pt-2 text-xs text-muted-foreground">{snapshot.toolName}</p>
              ) : null}
              <TodoList items={snapshot.items} />
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TodoPanel() {
  const session = useConversationSession();
  const nodes = useConversationNodes();
  const showTodos = useConversationPreferences((state) => state.preferences.showTodos);
  const snapshots = useMemo(() => latestTodoSnapshots(nodes), [nodes]);
  return showTodos ? <TodoPanelContent key={session.id} snapshots={snapshots} /> : null;
}

export const TodoToolRenderer: ToolRendererComponent = ({ block, fallback }) => {
  const snapshot = readTodoSnapshot(block);
  return snapshot ? <TodoList items={snapshot.items} /> : fallback;
};
