"use client";

import { useId } from "react";

import { useConversationPreferences } from "../../../chat/conversation-preferences";
import { useI18n } from "../../../i18n";
import { Button, SettingsGroup, SettingsRow, Switch } from "../../../ui";

export function ConversationSettingsItem() {
  const { t } = useI18n();
  const id = useId();
  const { preferences, status, saveFailed, hydrate, update } = useConversationPreferences(
    (state) => state,
  );
  const disabled = status !== "ready";
  const errorId = `${id}-error`;

  return (
    <div className="space-y-4" aria-busy={status === "loading" || status === "saving"}>
      <SettingsGroup>
        <SettingsRow
          label={
            <span id={`${id}-mode`}>
              {t("extensions.settings.conversation.runningMessageMode")}
            </span>
          }
          description={
            <span id={`${id}-mode-description`}>
              {t("extensions.settings.conversation.runningMessageDescription")}
            </span>
          }
        >
          <div
            role="group"
            aria-labelledby={`${id}-mode`}
            aria-describedby={`${id}-mode-description${saveFailed ? ` ${errorId}` : ""}`}
            className="flex items-center gap-1"
          >
            {(["queue", "steer"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-pressed={preferences.runningMessageMode === mode}
                className="text-muted-foreground font-normal"
                onClick={() => {
                  if (preferences.runningMessageMode !== mode)
                    void update({ runningMessageMode: mode });
                }}
              >
                {t(`extensions.settings.conversation.${mode}`)}
              </Button>
            ))}
          </div>
        </SettingsRow>
        {(
          [
            "askUserAutoContinue",
            "retainAllModelIO",
            "enhancedSearch",
            "showReasoning",
            "showTodos",
            "groupExplorationTools",
            "groupTerminalTools",
            "groupFileChanges",
            "groupParallelTools",
          ] as const
        ).map((key) => (
          <SettingsRow
            key={key}
            label={
              <label htmlFor={`${id}-${key}`}>{t(`extensions.settings.conversation.${key}`)}</label>
            }
            description={
              <span id={`${id}-${key}-description`}>
                {t(`extensions.settings.conversation.${key}Description`)}
              </span>
            }
          >
            <Switch
              id={`${id}-${key}`}
              checked={preferences[key]}
              disabled={status === "loading" || status === "error"}
              readOnly={status === "saving"}
              aria-describedby={`${id}-${key}-description${saveFailed ? ` ${errorId}` : ""}`}
              onCheckedChange={(checked) => void update({ [key]: checked })}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
      {status === "error" || saveFailed ? (
        <div className="flex items-center gap-3">
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {t(
              status === "error"
                ? "extensions.settings.conversation.loadError"
                : "extensions.settings.conversation.saveError",
            )}
          </p>
          {status === "error" ? (
            <Button variant="outline" size="sm" onClick={() => void hydrate()}>
              {t("extensions.settings.conversation.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
