import type { ToolCallBlock } from "@workbench/agent-runtime-contracts/conversation";
import { useI18n } from "../../../i18n";

export function todoItems(
  value: unknown,
): { text: string; status: "pending" | "in_progress" | "completed" }[] {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items))
    return [];
  return value.items.flatMap((item) =>
    item &&
    typeof item === "object" &&
    typeof item.text === "string" &&
    (item.status === "pending" || item.status === "in_progress" || item.status === "completed")
      ? [{ text: item.text, status: item.status }]
      : [],
  );
}

export function TodoList({ block }: { block: ToolCallBlock }) {
  const { t } = useI18n();
  const items = todoItems(block.arguments);
  if (items.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        {t("extensions.settings.conversation.todosEmpty")}
      </p>
    );
  return (
    <ul aria-label={t("extensions.settings.conversation.showTodos")} className="space-y-2 text-sm">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="text-muted-foreground shrink-0">
            {t(`extensions.settings.conversation.todoStatus.${item.status}`)}
          </span>
          <span
            className={
              item.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"
            }
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
