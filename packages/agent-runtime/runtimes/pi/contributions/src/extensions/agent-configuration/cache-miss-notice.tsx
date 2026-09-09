"use client";

import { DatabaseZapIcon } from "lucide-react";
import { useConversationNode } from "@workbench/agent-runtime-client";
import type { DataBlock } from "@workbench/agent-runtime-contracts/conversation";
import { PI_CACHE_MISS_DATA_NAME } from "@workbench/agent-runtime-pi-protocol/messages";
import type { DataRendererComponent, MessageSlotContext } from "@workbench/extension-sdk";
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";

export function CacheMissAction({ messageId, role }: MessageSlotContext) {
  const node = useConversationNode(messageId);
  const { t } = usePiI18n();
  if (role !== "assistant" || node?.kind !== "assistant") return null;
  const blocks = node.blocks.filter(
    (block): block is DataBlock => block.kind === "data" && block.name === PI_CACHE_MISS_DATA_NAME,
  );
  if (!blocks.length) return null;
  const label = t("extensions.agentConfiguration.cacheMiss.noticeTitle");

  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} />}
      >
        <DatabaseZapIcon />
      </PopoverTrigger>
      <PopoverContent side="top" align="end">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        {blocks.map((block) => (
          <CacheMissNotice key={block.key} node={node} block={block} fallback={null} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

export const CacheMissBody: DataRendererComponent = () => null;

export const CacheMissNotice: DataRendererComponent = ({ block, fallback }) => {
  const { t, number } = usePiI18n();
  const data = block.data;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !("missedTokens" in data) ||
    typeof data.missedTokens !== "number" ||
    !Number.isFinite(data.missedTokens) ||
    data.missedTokens <= 0 ||
    !("missedCost" in data) ||
    typeof data.missedCost !== "number" ||
    !Number.isFinite(data.missedCost) ||
    data.missedCost < 0 ||
    !("idleMs" in data) ||
    typeof data.idleMs !== "number" ||
    !Number.isFinite(data.idleMs) ||
    data.idleMs < 0 ||
    !("modelChanged" in data) ||
    typeof data.modelChanged !== "boolean"
  )
    return fallback;

  return (
    <aside
      role="status"
      className="border-border text-muted-foreground my-2 border-s-2 ps-3 text-sm"
    >
      <p className="text-foreground font-medium">
        {t("extensions.agentConfiguration.cacheMiss.noticeTitle")}
      </p>
      <p>
        {t("extensions.agentConfiguration.cacheMiss.tokens", { tokens: number(data.missedTokens) })}
      </p>
      <p>
        {data.missedCost > 0
          ? t("extensions.agentConfiguration.cacheMiss.cost", {
              cost: number(data.missedCost, {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              }),
            })
          : t("extensions.agentConfiguration.cacheMiss.costUnavailable")}
      </p>
      {data.modelChanged ? (
        <p>{t("extensions.agentConfiguration.cacheMiss.modelChanged")}</p>
      ) : null}
      {data.idleMs > 5 * 60 * 1000 ? (
        <p>
          {t("extensions.agentConfiguration.cacheMiss.idle", {
            minutes: number(data.idleMs / 60_000, { maximumFractionDigits: 1 }),
          })}
        </p>
      ) : null}
    </aside>
  );
};
