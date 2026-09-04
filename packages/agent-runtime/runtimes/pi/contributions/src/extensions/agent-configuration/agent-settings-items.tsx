"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Code2Icon, EyeIcon } from "lucide-react";

import { Button } from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { SettingsInlineEditor } from "@workbench/shell/ui";
import { SettingsGroup, SettingsRow } from "@workbench/shell/ui";
import { Switch } from "@workbench/shell/ui";
import { Textarea } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { MarkdownPreview } from "@workbench/shell/chat";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";
import { usePiConfigurationClient } from "@workbench/agent-runtime-pi-client/configuration";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import {
  PI_AGENT_SETTINGS_NAMESPACE,
  type PiAgentSettingsNamespaceView,
} from "@workbench/agent-runtime-pi-protocol/rpc";

type LoadState = "loading" | "ready" | "failed";

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const MAX_CONTEXT_SETTING_TOKENS = 10_000_000;

function useAgentSettingsNamespace() {
  const configurationClient = usePiConfigurationClient();
  const [view, setView] = useState<PiAgentSettingsNamespaceView>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>();
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoadState("loading");
    setLoadError(undefined);
    void configurationClient.describeAgentSettings().then(
      (result) => {
        if (request !== requestRef.current) return;
        const namespace = result.namespaces.find(({ ns }) => ns === PI_AGENT_SETTINGS_NAMESPACE);
        if (!namespace) {
          setLoadError(new Error("Pi agent settings namespace is unavailable."));
          setLoadState("failed");
          return;
        }
        setView(namespace);
        setLoadState("ready");
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        setLoadError(error);
        setLoadState("failed");
      },
    );
  }, [configurationClient]);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  return { view, setView, loadState, loadError, load };
}

function LoadFailure({ onRetry }: { onRetry(): void }) {
  const { t } = usePiI18n();
  return (
    <div className="py-6">
      <p className="text-destructive text-sm" role="alert">
        {t("extensions.agentConfiguration.errors.loadFailed")}
      </p>
      <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
        {t("extensions.agentConfiguration.retry")}
      </Button>
    </div>
  );
}

function SaveFeedback({ saved, error }: { saved: boolean; error?: string }) {
  const { t } = usePiI18n();
  if (error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {error}
      </p>
    );
  }
  if (!saved) return null;
  return (
    <p className="text-muted-foreground text-sm" role="status">
      {t("extensions.agentConfiguration.saved")}
    </p>
  );
}

function saveErrorLabel(error: unknown, conflict: string, fallback: string): string {
  return error instanceof PiApiError && error.code === "settings-conflict" ? conflict : fallback;
}

export function SystemPromptSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = usePiI18n();
  const systemPromptId = useId();
  const configurationClient = usePiConfigurationClient();
  const { view, setView, loadState, load } = useAgentSettingsNamespace();
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!view) return;
    setDraft(view.value.systemPrompt);
    setBaseline(view.value.systemPrompt);
  }, [view]);

  const save = useCallback(async () => {
    if (!view || saving || draft === baseline) return;
    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const updated = await configurationClient.updateAgentSettings({
        ns: PI_AGENT_SETTINGS_NAMESPACE,
        patch: { systemPrompt: draft },
        expectedRevision: view.revision,
      });
      setView(updated);
      setBaseline(updated.value.systemPrompt);
      setDraft(updated.value.systemPrompt);
      setSaved(true);
      setEditing(false);
    } catch (error) {
      setSaveError(
        saveErrorLabel(
          error,
          t("extensions.agentConfiguration.errors.conflict"),
          t("extensions.agentConfiguration.errors.saveFailed"),
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [baseline, configurationClient, draft, saving, setView, t, view]);

  if (loadState === "loading") {
    return (
      <p className="text-muted-foreground py-8 text-sm" role="status">
        {t("extensions.agentConfiguration.loading")}
      </p>
    );
  }
  if (loadState === "failed" || !view) return <LoadFailure onRetry={load} />;

  const dirty = draft !== baseline;
  const viewToggleLabel = editing
    ? t("extensions.agentConfiguration.systemPrompt.preview")
    : t("extensions.agentConfiguration.editValue", {
        label: t("extensions.agentConfiguration.systemPrompt.editorLabel"),
      });
  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="py-5">
      <div>
        <h3 className="text-sm font-medium">
          {t("extensions.agentConfiguration.systemPrompt.title")}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm leading-5">
          {t("extensions.agentConfiguration.systemPrompt.description")}
        </p>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={systemPromptId} className="text-muted-foreground block text-sm">
            {t("extensions.agentConfiguration.systemPrompt.editorLabel")}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={!editing}
            aria-label={viewToggleLabel}
            title={viewToggleLabel}
            className={!editing ? "bg-muted/55" : undefined}
            disabled={saving}
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? <EyeIcon aria-hidden="true" /> : <Code2Icon aria-hidden="true" />}
          </Button>
        </div>
        <div className="mt-2">
          {editing ? (
            <Textarea
              id={systemPromptId}
              autoFocus
              value={draft}
              maxLength={500_000}
              spellCheck={false}
              disabled={saving}
              placeholder={t("extensions.agentConfiguration.systemPrompt.placeholder")}
              className="bg-background min-h-44 resize-y font-mono text-xs leading-5"
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setSaved(false);
                setSaveError(undefined);
              }}
            />
          ) : (
            <div className="h-44 overflow-hidden rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)]">
              {draft ? (
                <MarkdownPreview
                  content={draft}
                  ariaLabel={t("extensions.agentConfiguration.systemPrompt.editorLabel")}
                />
              ) : (
                <p
                  role="document"
                  aria-label={t("extensions.agentConfiguration.systemPrompt.editorLabel")}
                  className="text-muted-foreground px-8 py-7 text-sm leading-7"
                >
                  {t("extensions.agentConfiguration.systemPrompt.placeholder")}
                </p>
              )}
            </div>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-5">
          {t("extensions.agentConfiguration.systemPrompt.defaultHint")}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <SaveFeedback saved={saved} error={saveError} />
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || draft.length === 0}
              onClick={() => {
                setDraft("");
                setSaved(false);
                setSaveError(undefined);
              }}
            >
              {t("extensions.agentConfiguration.systemPrompt.useDefault")}
            </Button>
            <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>
              {saving
                ? t("extensions.agentConfiguration.saving")
                : t("extensions.agentConfiguration.save")}
            </Button>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground mt-3 text-xs leading-5">
        {t("extensions.agentConfiguration.appliesAfterReload")}
      </p>
    </div>
  );
}

function parseTokenCount(value: string): number | undefined {
  if (!/^\d+$/u.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_CONTEXT_SETTING_TOKENS
    ? parsed
    : undefined;
}

function InlineNumberEditor({
  value,
  label,
  editing,
  disabled,
  invalid,
  onChange,
  onEditingChange,
}: {
  value: string;
  label: string;
  editing: boolean;
  disabled: boolean;
  invalid: boolean;
  onChange(value: string): void;
  onEditingChange(editing: boolean): void;
}) {
  const { number, t } = usePiI18n();
  const editStartValueRef = useRef(value);

  const cancelEditing = () => {
    onChange(editStartValueRef.current);
    onEditingChange(false);
  };

  const parsed = parseTokenCount(value);
  return (
    <SettingsInlineEditor
      editing={editing}
      display={
        <>
          <span className="text-sm tabular-nums">
            {parsed === undefined ? value : number(parsed)}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("extensions.agentConfiguration.context.tokens")}
          </span>
        </>
      }
      editLabel={t("extensions.agentConfiguration.editValue", { label })}
      cancelLabel={t("extensions.agentConfiguration.cancel")}
      disabled={disabled}
      cancelButtonVariant="default"
      onEdit={() => {
        editStartValueRef.current = value;
        onEditingChange(true);
      }}
      onCancel={cancelEditing}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          autoFocus
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_CONTEXT_SETTING_TOKENS}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid}
          className="min-w-24 text-left tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            } else if (event.key === "Enter" && !invalid) {
              event.preventDefault();
              onEditingChange(false);
            }
          }}
        />
        <span className="text-muted-foreground shrink-0 text-xs">
          {t("extensions.agentConfiguration.context.tokens")}
        </span>
      </div>
    </SettingsInlineEditor>
  );
}

function compactionSignature(
  enabled: boolean,
  reserveTokens: string | number,
  keepRecentTokens: string | number,
): string {
  return JSON.stringify([enabled, String(reserveTokens), String(keepRecentTokens)]);
}

export function ContextManagementSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = usePiI18n();
  const configurationClient = usePiConfigurationClient();
  const { view, setView, loadState, load } = useAgentSettingsNamespace();
  const [enabled, setEnabled] = useState(true);
  const [reserveTokens, setReserveTokens] = useState(String(DEFAULT_RESERVE_TOKENS));
  const [keepRecentTokens, setKeepRecentTokens] = useState(String(DEFAULT_KEEP_RECENT_TOKENS));
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [reserveEditing, setReserveEditing] = useState(false);
  const [keepRecentEditing, setKeepRecentEditing] = useState(false);

  useEffect(() => {
    if (!view) return;
    const compaction = view.value.compaction;
    setEnabled(compaction.enabled);
    setReserveTokens(String(compaction.reserveTokens));
    setKeepRecentTokens(String(compaction.keepRecentTokens));
    setReserveEditing(false);
    setKeepRecentEditing(false);
    setBaseline(
      compactionSignature(
        compaction.enabled,
        compaction.reserveTokens,
        compaction.keepRecentTokens,
      ),
    );
  }, [view]);

  const currentSignature = compactionSignature(enabled, reserveTokens, keepRecentTokens);
  const dirty = currentSignature !== baseline;
  const parsedReserveTokens = parseTokenCount(reserveTokens);
  const parsedKeepRecentTokens = parseTokenCount(keepRecentTokens);
  const invalid = parsedReserveTokens === undefined || parsedKeepRecentTokens === undefined;

  const save = useCallback(async () => {
    if (!view || saving || !dirty || invalid) return;
    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const updated = await configurationClient.updateAgentSettings({
        ns: PI_AGENT_SETTINGS_NAMESPACE,
        patch: {
          compaction: {
            enabled,
            reserveTokens: parsedReserveTokens,
            keepRecentTokens: parsedKeepRecentTokens,
          },
        },
        expectedRevision: view.revision,
      });
      setView(updated);
      const compaction = updated.value.compaction;
      setBaseline(
        compactionSignature(
          compaction.enabled,
          compaction.reserveTokens,
          compaction.keepRecentTokens,
        ),
      );
      setReserveEditing(false);
      setKeepRecentEditing(false);
      setSaved(true);
    } catch (error) {
      setSaveError(
        saveErrorLabel(
          error,
          t("extensions.agentConfiguration.errors.conflict"),
          t("extensions.agentConfiguration.errors.saveFailed"),
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [
    dirty,
    configurationClient,
    enabled,
    invalid,
    parsedKeepRecentTokens,
    parsedReserveTokens,
    saving,
    setView,
    t,
    view,
  ]);

  if (loadState === "loading") {
    return (
      <p className="text-muted-foreground py-8 text-sm" role="status">
        {t("extensions.agentConfiguration.context.loading")}
      </p>
    );
  }
  if (loadState === "failed" || !view) return <LoadFailure onRetry={load} />;

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="py-4">
      <SettingsGroup
        title={t("extensions.agentConfiguration.context.compactionTitle")}
        description={t("extensions.agentConfiguration.context.compactionDescription")}
        className="my-5 first:mt-1 last:mb-3"
      >
        <SettingsRow
          label={t("extensions.agentConfiguration.context.autoCompaction")}
          description={t("extensions.agentConfiguration.context.autoCompactionDescription")}
          className="min-h-16 sm:grid-cols-[minmax(0,1fr)_17rem] sm:gap-8"
          controlClassName="flex min-w-0 justify-end"
        >
          <Switch
            checked={enabled}
            disabled={saving}
            aria-label={t("extensions.agentConfiguration.context.autoCompaction")}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setSaved(false);
              setSaveError(undefined);
            }}
          />
        </SettingsRow>
        <SettingsRow
          label={t("extensions.agentConfiguration.context.reserveTokens")}
          description={t("extensions.agentConfiguration.context.reserveTokensDescription")}
          className="min-h-16 sm:grid-cols-[minmax(0,1fr)_17rem] sm:gap-8"
          controlClassName="flex min-w-0 justify-end"
        >
          <InlineNumberEditor
            value={reserveTokens}
            label={t("extensions.agentConfiguration.context.reserveTokens")}
            editing={reserveEditing}
            disabled={saving}
            invalid={parsedReserveTokens === undefined}
            onEditingChange={setReserveEditing}
            onChange={(value) => {
              setReserveTokens(value);
              setSaved(false);
              setSaveError(undefined);
            }}
          />
        </SettingsRow>
        <SettingsRow
          label={t("extensions.agentConfiguration.context.keepRecentTokens")}
          description={t("extensions.agentConfiguration.context.keepRecentTokensDescription")}
          className="min-h-16 sm:grid-cols-[minmax(0,1fr)_17rem] sm:gap-8"
          controlClassName="flex min-w-0 justify-end"
        >
          <InlineNumberEditor
            value={keepRecentTokens}
            label={t("extensions.agentConfiguration.context.keepRecentTokens")}
            editing={keepRecentEditing}
            disabled={saving}
            invalid={parsedKeepRecentTokens === undefined}
            onEditingChange={setKeepRecentEditing}
            onChange={(value) => {
              setKeepRecentTokens(value);
              setSaved(false);
              setSaveError(undefined);
            }}
          />
        </SettingsRow>
      </SettingsGroup>

      {invalid ? (
        <p className="text-destructive text-sm" role="alert">
          {t("extensions.agentConfiguration.context.invalidTokens")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SaveFeedback saved={saved} error={saveError} />
        <div className="ms-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setEnabled(true);
              setReserveTokens(String(DEFAULT_RESERVE_TOKENS));
              setKeepRecentTokens(String(DEFAULT_KEEP_RECENT_TOKENS));
              setReserveEditing(false);
              setKeepRecentEditing(false);
              setSaved(false);
              setSaveError(undefined);
            }}
          >
            {t("extensions.agentConfiguration.context.restoreDefaults")}
          </Button>
          <Button type="button" disabled={saving || !dirty || invalid} onClick={() => void save()}>
            {saving
              ? t("extensions.agentConfiguration.saving")
              : t("extensions.agentConfiguration.save")}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground mt-3 text-xs leading-5">
        {t("extensions.agentConfiguration.appliesAfterReload")}
      </p>
    </div>
  );
}
