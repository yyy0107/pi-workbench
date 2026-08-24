"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";
import {
  describePiHost,
  describePiSettings,
  getPiModelContextWindow,
  PiApiError,
  updatePiAgentSettings,
  updatePiModelContextWindow,
} from "@/runtime/pi/client/transport/api";
import {
  PI_AGENT_SETTINGS_NAMESPACE,
  type ModelContextWindowValue,
  type PiAgentSettingsNamespaceView,
} from "@/runtime/pi/rpc-contracts";

type LoadState = "loading" | "ready" | "failed";

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const MAX_CONTEXT_SETTING_TOKENS = 10_000_000;

function WidePencilIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m3.4 16.6 1.05-3.85L13.1 4.1a2 2 0 0 1 2.8 0 2 2 0 0 1 0 2.8l-8.65 8.65L3.4 16.6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="m12.2 5 2.8 2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function useAgentSettingsNamespace() {
  const [view, setView] = useState<PiAgentSettingsNamespaceView>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>();
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoadState("loading");
    setLoadError(undefined);
    void describePiSettings().then(
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
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  return { view, setView, loadState, loadError, load };
}

function LoadFailure({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  return (
    <div className="py-6">
      <p className="text-destructive text-sm" role="alert">
        {t("extensions.agentConfiguration.errors.loadFailed")}
      </p>
      <Button type="button" variant="outline" className="mt-3 rounded-full" onClick={onRetry}>
        {t("extensions.agentConfiguration.retry")}
      </Button>
    </div>
  );
}

function SaveFeedback({ saved, error }: { saved: boolean; error?: string }) {
  const { t } = useI18n();
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
  const { t } = useI18n();
  const { view, setView, loadState, load } = useAgentSettingsNamespace();
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();

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
      const updated = await updatePiAgentSettings({
        ns: PI_AGENT_SETTINGS_NAMESPACE,
        patch: { systemPrompt: draft },
        expectedRevision: view.revision,
      });
      setView(updated);
      setBaseline(updated.value.systemPrompt);
      setDraft(updated.value.systemPrompt);
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
  }, [baseline, draft, saving, setView, t, view]);

  if (loadState === "loading") {
    return (
      <p className="text-muted-foreground py-8 text-sm" role="status">
        {t("extensions.agentConfiguration.loading")}
      </p>
    );
  }
  if (loadState === "failed" || !view) return <LoadFailure onRetry={load} />;

  const dirty = draft !== baseline;
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
        <label htmlFor="global-pi-system-prompt" className="text-muted-foreground block text-sm">
          {t("extensions.agentConfiguration.systemPrompt.editorLabel")}
        </label>
        <Textarea
          id="global-pi-system-prompt"
          value={draft}
          maxLength={500_000}
          spellCheck={false}
          disabled={saving}
          placeholder={t("extensions.agentConfiguration.systemPrompt.placeholder")}
          className="bg-background mt-2 min-h-44 resize-y font-mono text-xs leading-5"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setSaved(false);
            setSaveError(undefined);
          }}
        />
        <p className="text-muted-foreground mt-2 text-xs leading-5">
          {t("extensions.agentConfiguration.systemPrompt.defaultHint")}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <SaveFeedback saved={saved} error={saveError} />
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={saving || draft.length === 0}
              onClick={() => {
                setDraft("");
                setSaved(false);
                setSaveError(undefined);
              }}
            >
              {t("extensions.agentConfiguration.systemPrompt.useDefault")}
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
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

function SettingGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="py-5 first:pt-1 last:pb-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-5">{description}</p>
      </div>
      <div className="bg-muted/20 mt-4 rounded-xl border px-4 py-1">
        <div className="divide-y">{children}</div>
      </div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_17rem] sm:items-center sm:gap-8">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        <p className="text-muted-foreground mt-0.5 text-xs leading-4">{description}</p>
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
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
  const { number, t } = useI18n();
  const editStartValueRef = useRef(value);

  const cancelEditing = () => {
    onChange(editStartValueRef.current);
    onEditingChange(false);
  };

  if (!editing) {
    const parsed = parseTokenCount(value);
    return (
      <div className="flex min-h-9 items-center justify-end gap-1">
        <span className="text-sm tabular-nums">
          {parsed === undefined ? value : number(parsed)}
        </span>
        <span className="text-muted-foreground text-xs">
          {t("extensions.agentConfiguration.context.tokens")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={disabled}
          aria-label={t("extensions.agentConfiguration.editValue", { label })}
          onClick={() => {
            editStartValueRef.current = value;
            onEditingChange(true);
          }}
        >
          <WidePencilIcon />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-72 items-center justify-end gap-2">
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
      <Button type="button" className="rounded-full" disabled={disabled} onClick={cancelEditing}>
        {t("extensions.agentConfiguration.cancel")}
      </Button>
    </div>
  );
}

function compactionSignature(
  enabled: boolean,
  reserveTokens: string | number,
  keepRecentTokens: string | number,
): string {
  return JSON.stringify([enabled, String(reserveTokens), String(keepRecentTokens)]);
}

function DefaultModelContextWindowGroup() {
  const { t } = useI18n();
  const [view, setView] = useState<ModelContextWindowValue>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoadState("loading");
    setSaveError(undefined);
    void describePiHost()
      .then(async ({ provider, model }) => {
        if (!provider || !model) throw new Error("The default model is unavailable.");
        return getPiModelContextWindow({ provider, model });
      })
      .then(
        (value) => {
          if (request !== requestRef.current) return;
          const contextWindow = String(value.contextWindow);
          setView(value);
          setDraft(contextWindow);
          setBaseline(contextWindow);
          setEditing(false);
          setLoadState("ready");
        },
        () => {
          if (request !== requestRef.current) return;
          setLoadState("failed");
        },
      );
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const parsedContextWindow = parseTokenCount(draft);
  const dirty = draft !== baseline;

  const save = useCallback(async () => {
    if (!view || parsedContextWindow === undefined || !dirty || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const updated = await updatePiModelContextWindow({
        provider: view.provider,
        model: view.model,
        contextWindow: parsedContextWindow,
      });
      const contextWindow = String(updated.contextWindow);
      setView(updated);
      setDraft(contextWindow);
      setBaseline(contextWindow);
      setEditing(false);
      setSaved(true);
    } catch {
      setSaveError(t("extensions.agentConfiguration.context.modelWindowSaveFailed"));
    } finally {
      setSaving(false);
    }
  }, [dirty, parsedContextWindow, saving, t, view]);

  return (
    <SettingGroup
      title={t("extensions.agentConfiguration.context.modelWindowTitle")}
      description={t("extensions.agentConfiguration.context.modelWindowDescription")}
    >
      {loadState === "loading" ? (
        <p className="text-muted-foreground py-5 text-sm" role="status">
          {t("extensions.agentConfiguration.context.modelWindowLoading")}
        </p>
      ) : loadState === "failed" || !view ? (
        <div className="py-4">
          <p className="text-destructive text-sm" role="alert">
            {t("extensions.agentConfiguration.context.modelWindowUnavailable")}
          </p>
          <Button type="button" variant="outline" className="mt-3 rounded-full" onClick={load}>
            {t("extensions.agentConfiguration.retry")}
          </Button>
        </div>
      ) : (
        <>
          <SettingRow
            label={t("extensions.agentConfiguration.context.modelWindowSize")}
            description={t("extensions.agentConfiguration.context.modelWindowTarget", {
              provider: view.provider,
              model: view.name || view.model,
            })}
          >
            <InlineNumberEditor
              value={draft}
              label={t("extensions.agentConfiguration.context.modelWindowSize")}
              editing={editing}
              disabled={saving}
              invalid={parsedContextWindow === undefined}
              onEditingChange={setEditing}
              onChange={(value) => {
                setDraft(value);
                setSaved(false);
                setSaveError(undefined);
              }}
            />
          </SettingRow>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              {parsedContextWindow === undefined ? (
                <p className="text-destructive text-sm" role="alert">
                  {t("extensions.agentConfiguration.context.invalidTokens")}
                </p>
              ) : (
                <SaveFeedback saved={saved} error={saveError} />
              )}
            </div>
            <Button
              type="button"
              className="ms-auto rounded-full"
              disabled={saving || !dirty || parsedContextWindow === undefined}
              onClick={() => void save()}
            >
              {saving
                ? t("extensions.agentConfiguration.saving")
                : t("extensions.agentConfiguration.save")}
            </Button>
          </div>
        </>
      )}
    </SettingGroup>
  );
}

export function ContextManagementSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = useI18n();
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
      const updated = await updatePiAgentSettings({
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
      <DefaultModelContextWindowGroup />
      <SettingGroup
        title={t("extensions.agentConfiguration.context.compactionTitle")}
        description={t("extensions.agentConfiguration.context.compactionDescription")}
      >
        <SettingRow
          label={t("extensions.agentConfiguration.context.autoCompaction")}
          description={t("extensions.agentConfiguration.context.autoCompactionDescription")}
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
        </SettingRow>
        <SettingRow
          label={t("extensions.agentConfiguration.context.reserveTokens")}
          description={t("extensions.agentConfiguration.context.reserveTokensDescription")}
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
        </SettingRow>
        <SettingRow
          label={t("extensions.agentConfiguration.context.keepRecentTokens")}
          description={t("extensions.agentConfiguration.context.keepRecentTokensDescription")}
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
        </SettingRow>
      </SettingGroup>

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
            className="rounded-full"
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
          <Button
            type="button"
            className="rounded-full"
            disabled={saving || !dirty || invalid}
            onClick={() => void save()}
          >
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
