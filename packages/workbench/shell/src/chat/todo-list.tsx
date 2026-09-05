"use client";

import { CheckCircle2Icon, CircleIcon, LoaderCircleIcon } from "lucide-react";

import { useI18n } from "../i18n";
import { cn } from "../utils";
import type { TodoItem } from "./todo-model";

const statusIcons = {
  pending: CircleIcon,
  in_progress: LoaderCircleIcon,
  completed: CheckCircle2Icon,
};

export function TodoList({ items }: { items: readonly TodoItem[] }) {
  const { t } = useI18n();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("extensions.todoPanel.empty")}</p>;
  }
  const showIds = items.some((item) => item.blockedBy?.length);
  return (
    <ul aria-label={t("extensions.todoPanel.title")} className="min-w-0 text-sm">
      {items.map((item) => {
        const Icon = statusIcons[item.status];
        return (
          <li
            key={item.id}
            className="flex items-start gap-2 py-[var(--control-content-padding-block-default)]"
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-(--icon-size-md) shrink-0",
                item.status === "completed"
                  ? "text-success"
                  : item.status === "in_progress"
                    ? "animate-spin text-foreground motion-reduce:animate-none"
                    : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1 wrap-anywhere">
              <span className="sr-only">
                {t(`extensions.settings.conversation.todoStatus.${item.status}`)}
              </span>
              <p
                className={cn(
                  item.status === "completed" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {showIds ? <span className="text-muted-foreground">#{item.id} </span> : null}
                {item.text}
              </p>
              {item.status === "in_progress" && item.activeForm ? (
                <p className="text-xs text-muted-foreground">{item.activeForm}</p>
              ) : null}
              {item.description ? (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
              {item.owner ? (
                <p className="text-xs text-muted-foreground">
                  {t("extensions.todoPanel.owner", { owner: item.owner })}
                </p>
              ) : null}
              {item.blockedBy?.length ? (
                <p className="text-xs text-muted-foreground">
                  {t("extensions.todoPanel.blockedBy", {
                    tasks: item.blockedBy.map((id) => `#${id}`).join(", "),
                  })}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
