"use client";
import { piSettingsUiTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { DatabaseZapIcon } from "lucide-react";
import { useConversationNode } from "@workbench/agent-runtime-client";
import type { DataBlock } from "@workbench/agent-runtime-contracts/conversation";
import { PI_CACHE_MISS_DATA_NAME } from "@workbench/pi-rpc-contracts/messages";
import type { DataRendererComponent, MessageSlotContext } from "@workbench/extension-sdk";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench/ui";

export function CacheMissAction({ messageId, role }: MessageSlotContext) {
  const node = useConversationNode(messageId);
  const { t } = useI18n(piSettingsUiTranslationBundle);
  if (role !== "assistant" || node?.kind !== "assistant") return null;
  const blocks = node.blocks.filter(
    (block): block is DataBlock => block.kind === "data" && block.name === PI_CACHE_MISS_DATA_NAME,
  );
  if (!blocks.length) return null;
  const label = t("extensions.agentConfiguration.cacheMiss.noticeTitle");

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} />
        }
      >
        <DatabaseZapIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 gap-0 overflow-hidden p-0"
      >
        <PopoverHeader className="border-border gap-1.5 border-b px-3 py-3">
          <div className="flex items-center gap-2">
            <DatabaseZapIcon
              aria-hidden="true"
              className="text-warning-foreground size-(--icon-size-sm) shrink-0"
            />
            <PopoverTitle className="text-foreground text-sm font-medium">{label}</PopoverTitle>
          </div>
          <PopoverDescription className="text-xs leading-5">
            {t("extensions.agentConfiguration.cacheMiss.summary")}
          </PopoverDescription>
        </PopoverHeader>
        <div className="divide-border divide-y">
          {blocks.map((block) => (
            <CacheMissNotice key={block.key} node={node} block={block} fallback={null} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const CacheMissBody: DataRendererComponent = () => null;

export const CacheMissNotice: DataRendererComponent = ({ block, fallback }) => {
  const { t, number } = useI18n(piSettingsUiTranslationBundle);
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

  const formattedTokens = number(data.missedTokens);
  const formattedCost =
    data.missedCost > 0
      ? number(data.missedCost, {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })
      : undefined;
  const hasIdleCause = data.idleMs > 5 * 60 * 1000;
  const hasCause = data.modelChanged || hasIdleCause;

  return (
    <aside role="status" className="text-muted-foreground text-sm">
      <dl className="grid grid-cols-2 divide-x divide-border">
        <div className="min-w-0 px-3 py-2.5">
          <dt className="text-xs leading-4">
            {t("extensions.agentConfiguration.cacheMiss.tokensLabel")}
          </dt>
          <dd
            className="text-foreground mt-0.5 overflow-hidden font-mono text-sm font-medium text-ellipsis whitespace-nowrap tabular-nums"
            aria-label={t("extensions.agentConfiguration.cacheMiss.tokens", {
              tokens: formattedTokens,
            })}
          >
            {formattedTokens}
          </dd>
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <dt className="text-xs leading-4">
            {t("extensions.agentConfiguration.cacheMiss.costLabel")}
          </dt>
          <dd
            className="text-foreground mt-0.5 overflow-hidden font-mono text-sm font-medium text-ellipsis whitespace-nowrap tabular-nums"
            aria-label={
              formattedCost
                ? t("extensions.agentConfiguration.cacheMiss.cost", { cost: formattedCost })
                : t("extensions.agentConfiguration.cacheMiss.costUnavailable")
            }
          >
            {formattedCost ?? t("extensions.agentConfiguration.cacheMiss.costUnavailableShort")}
          </dd>
        </div>
      </dl>
      {formattedCost === undefined || hasCause ? (
        <div className="border-t border-border px-3 py-2.5 text-xs leading-5">
          {formattedCost === undefined ? (
            <p>{t("extensions.agentConfiguration.cacheMiss.costUnavailable")}</p>
          ) : null}
          {hasCause ? (
            <div className={formattedCost === undefined ? "mt-2" : undefined}>
              <p className="text-foreground font-medium">
                {t("extensions.agentConfiguration.cacheMiss.possibleCauses")}
              </p>
              <ul className="mt-1 space-y-0.5 ps-4">
                {data.modelChanged ? (
                  <li>{t("extensions.agentConfiguration.cacheMiss.modelChanged")}</li>
                ) : null}
                {hasIdleCause ? (
                  <li>
                    {t("extensions.agentConfiguration.cacheMiss.idle", {
                      minutes: number(data.idleMs / 60_000, { maximumFractionDigits: 1 }),
                    })}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
};
