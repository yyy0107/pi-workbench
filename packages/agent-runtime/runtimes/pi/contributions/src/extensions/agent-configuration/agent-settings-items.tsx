"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CircleXIcon, Code2Icon, CopyIcon, EyeIcon, InfoIcon } from "lucide-react";

import { useClipboardCopy } from "@workbench/shell/hooks";
import { Button, TooltipIconButton } from "@workbench/shell/ui";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { InputGroup } from "@workbench/shell/ui";
import { SettingsInlineEditor } from "@workbench/shell/ui";
import { SettingsGroup, SettingsRow } from "@workbench/shell/ui";
import { Switch } from "@workbench/shell/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workbench/shell/ui";
import { WorkbenchCodeEditor } from "@workbench/shell/code-highlighting";
import { usePiI18n } from "../../i18n";
import { MarkdownPreview } from "@workbench/shell/chat";
import type { MainViewProps, SettingsItemComponentProps } from "@workbench/extension-sdk";
import { usePiConfigurationClient } from "@workbench/agent-runtime-pi-client/configuration";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import {
  PI_AGENT_SETTINGS_NAMESPACE,
  type PiAgentSettingsNamespaceView,
  type PiResourceCatalogTarget,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { highlightPromptPlaceholders } from "./prompt-placeholder-highlight";
import styles from "./prompt-placeholder-highlight.module.css";

type LoadState = "loading" | "ready" | "failed";

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const MAX_CONTEXT_SETTING_TOKENS = 10_000_000;

function useAgentSettingsNamespace(target?: PiResourceCatalogTarget) {
  const configurationClient = usePiConfigurationClient();
  const [view, setView] = useState<PiAgentSettingsNamespaceView>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>();
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoadState("loading");
    setLoadError(undefined);
    void configurationClient.describeAgentSettings(target).then(
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
  }, [configurationClient, target]);

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

export function SystemPromptMainView({ view }: MainViewProps<{ target: PiResourceCatalogTarget }>) {
  const { t } = usePiI18n();
  const target = view.params.target;
  if (!target) return null;

  return (
    <section
      aria-label={t("extensions.agentConfiguration.systemPrompt.title")}
      className="@container h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
    >
      <Tabs
        key={target.scope === "user" ? "user" : `project:${target.workspaceId}`}
        defaultValue="systemPrompt"
        className="mx-auto w-full max-w-5xl px-5 py-8 @2xl:px-10 @2xl:py-10"
      >
        <header className="mb-8">
          <h1 className="text-foreground text-3xl font-medium tracking-tight">
            {t("extensions.agentConfiguration.systemPrompt.title")}
          </h1>
          <p className="text-muted-foreground mt-3 text-base leading-6">
            {t("extensions.agentConfiguration.systemPrompt.pageDescription")}
          </p>
        </header>
        <TabsList
          aria-label={t("extensions.agentConfiguration.promptType")}
          className="mb-6 gap-2 bg-transparent p-0"
        >
          {(["systemPrompt", "appendSystemPrompt"] as const).map((field) => (
            <TabsTrigger
              key={field}
              value={field}
              className="data-active:bg-muted data-active:shadow-none"
            >
              {t(`extensions.agentConfiguration.${field}.tabLabel`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <SystemPromptEditor target={target} />
      </Tabs>
    </section>
  );
}

function SystemPromptEditor({ target }: { target: PiResourceCatalogTarget }) {
  const { t } = usePiI18n();
  const { view, setView, loadState, load } = useAgentSettingsNamespace(target);
  const [saving, setSaving] = useState(false);

  if (loadState === "loading") {
    return (
      <p className="text-muted-foreground py-8 text-sm" role="status">
        {t("extensions.agentConfiguration.loading")}
      </p>
    );
  }
  if (loadState === "failed" || !view) return <LoadFailure onRetry={load} />;

  return (
    <div className="pb-5">
      {(["systemPrompt", "appendSystemPrompt"] as const).map((field) => (
        <TabsContent key={field} value={field} keepMounted>
          <PromptSettingsEditor
            field={field}
            target={target}
            view={view}
            setView={setView}
            saving={saving}
            setSaving={setSaving}
          />
        </TabsContent>
      ))}
    </div>
  );
}

function PlaceholderCopyButton({ placeholder }: { placeholder: string }) {
  const { t } = usePiI18n();
  const { copy, status } = useClipboardCopy();
  const copyLabel = t(
    status === "copied"
      ? "extensions.agentConfiguration.placeholders.copied"
      : status === "failed"
        ? "extensions.agentConfiguration.placeholders.copyFailed"
        : "extensions.agentConfiguration.placeholders.copy",
    { placeholder },
  );

  return (
    <TooltipIconButton
      type="button"
      tooltip={copyLabel}
      className="text-muted-foreground opacity-0 group-hover/placeholder:opacity-100 group-focus-within/placeholder:opacity-100 [@media(hover:none)]:opacity-100"
      onClick={() => void copy(placeholder)}
    >
      {status === "copied" ? (
        <CheckIcon aria-hidden="true" />
      ) : status === "failed" ? (
        <CircleXIcon aria-hidden="true" className="text-destructive" />
      ) : (
        <CopyIcon aria-hidden="true" />
      )}
    </TooltipIconButton>
  );
}

function PromptSettingsEditor({
  field,
  target,
  view,
  setView,
  saving,
  setSaving,
}: {
  field: "systemPrompt" | "appendSystemPrompt";
  target: PiResourceCatalogTarget;
  view: PiAgentSettingsNamespaceView;
  setView(view: PiAgentSettingsNamespaceView): void;
  saving: boolean;
  setSaving(saving: boolean): void;
}) {
  const { t } = usePiI18n();
  const systemPromptId = useId();
  const promptContainerRef = useRef<HTMLDivElement>(null);
  const configurationClient = usePiConfigurationClient();
  const baseline = view.value[field] ?? "";
  const [draft, setDraft] = useState(baseline);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const container = promptContainerRef.current;
    if (container) return highlightPromptPlaceholders(container);
  }, []);

  useEffect(() => {
    setDraft(baseline);
  }, [baseline]);

  const save = useCallback(async () => {
    if (saving || draft === baseline) return;
    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const updated = await configurationClient.updateAgentSettings({
        ns: PI_AGENT_SETTINGS_NAMESPACE,
        target,
        patch: { [field]: draft },
        expectedRevision: view.revision,
      });
      setView(updated);
      setDraft(updated.value[field]);
      setSaved(true);
      setEditing(false);
    } catch (error) {
      setSaveError(
        error instanceof PiApiError && error.code === "settings-unsupported"
          ? t("extensions.agentConfiguration.errors.unsupportedPrompt")
          : saveErrorLabel(
              error,
              t("extensions.agentConfiguration.errors.conflict"),
              t("extensions.agentConfiguration.errors.saveFailed"),
            ),
      );
    } finally {
      setSaving(false);
    }
  }, [baseline, configurationClient, draft, field, saving, setSaving, setView, t, target, view]);

  const dirty = draft !== baseline;
  const projectScope = target.scope === "project";
  const showingDefault = !editing && draft.trim().length === 0;
  const inherited = projectScope ? view.base?.[field] : undefined;
  const showingInherited = showingDefault && Boolean(inherited);
  const showingBuiltin = field === "systemPrompt" && showingDefault && !showingInherited;
  const previewContent = showingInherited
    ? inherited
    : showingBuiltin
      ? view.builtinSystemPrompt
      : draft;
  const editorLabel = showingInherited
    ? t(`extensions.agentConfiguration.${field}.inheritedLabel`)
    : showingBuiltin
      ? t("extensions.agentConfiguration.systemPrompt.builtinLabel")
      : t(`extensions.agentConfiguration.${field}.editorLabel`);
  const viewToggleLabel = editing
    ? t(`extensions.agentConfiguration.${field}.preview`)
    : t("extensions.agentConfiguration.editValue", {
        label: t(`extensions.agentConfiguration.${field}.editorLabel`),
      });
  return (
    <section aria-labelledby={`${systemPromptId}-heading`}>
      <div className="border-b pb-4">
        <div className="flex items-center gap-2">
          <h2 id={`${systemPromptId}-heading`} className="text-foreground text-lg font-medium">
            {t(`extensions.agentConfiguration.${field}.sectionTitle`)}
          </h2>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={t("extensions.agentConfiguration.placeholders.title")}
                  title={t("extensions.agentConfiguration.placeholders.title")}
                />
              }
            >
              <InfoIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[min(32rem,var(--available-height))] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-4"
            >
              <PopoverHeader>
                <PopoverTitle>{t("extensions.agentConfiguration.placeholders.title")}</PopoverTitle>
                <PopoverDescription className="mt-1 text-xs leading-5">
                  {t("extensions.agentConfiguration.placeholders.description")}
                </PopoverDescription>
              </PopoverHeader>
              <dl className="divide-border divide-y">
                {(
                  [
                    "cwd",
                    "terminal_environment",
                    "tools",
                    "tool_guidelines",
                    "readme",
                    "docs",
                    "examples",
                  ] as const
                ).map((name) => (
                  <div key={name} className="group/placeholder py-2.5">
                    <dt className="flex items-center gap-1">
                      <code className="select-text text-sm">{`{{pi.${name}}}`}</code>
                      <PlaceholderCopyButton placeholder={`{{pi.${name}}}`} />
                    </dt>
                    <dd className="text-muted-foreground mt-1 text-xs leading-5">
                      {t(`extensions.agentConfiguration.placeholders.${name}`)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground text-xs leading-5">
                {t("extensions.agentConfiguration.placeholders.automaticContext")}
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {t(
            `extensions.agentConfiguration.${field}.${projectScope ? "projectDescription" : "description"}`,
          )}
        </p>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span id={`${systemPromptId}-label`} className="text-muted-foreground text-sm">
            {editorLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-controls={`${systemPromptId}-panel`}
            aria-label={viewToggleLabel}
            title={viewToggleLabel}
            disabled={saving}
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? <EyeIcon aria-hidden="true" /> : <Code2Icon aria-hidden="true" />}
            {editing
              ? t(`extensions.agentConfiguration.${field}.preview`)
              : t("extensions.agentConfiguration.edit")}
          </Button>
        </div>
        <InputGroup
          id={`${systemPromptId}-panel`}
          aria-labelledby={`${systemPromptId}-label`}
          ref={promptContainerRef}
          className={`${styles.promptEditor} mt-2 h-80 min-h-44 resize-y items-stretch overflow-hidden`}
        >
          {editing ? (
            <WorkbenchCodeEditor
              id={systemPromptId}
              ariaLabel={t(`extensions.agentConfiguration.${field}.editorLabel`)}
              exitLabel={t(`extensions.agentConfiguration.${field}.exitEditor`)}
              saveLabel={t(`extensions.agentConfiguration.${field}.saveShortcut`)}
              name={field === "systemPrompt" ? "SYSTEM.md" : "APPEND_SYSTEM.md"}
              autoFocus
              value={draft}
              maxLength={500_000}
              disabled={saving}
              placeholder={t(`extensions.agentConfiguration.${field}.placeholder`)}
              className="h-full w-full"
              onSave={save}
              onChange={(value) => {
                setDraft(value);
                setSaved(false);
                setSaveError(undefined);
              }}
            />
          ) : (
            <div className="h-full w-full overflow-hidden">
              {previewContent ? (
                <MarkdownPreview content={previewContent} ariaLabel={editorLabel} />
              ) : (
                <p
                  role="document"
                  aria-label={editorLabel}
                  className="text-muted-foreground px-8 py-7 text-sm leading-7"
                >
                  {showingBuiltin
                    ? t("extensions.agentConfiguration.systemPrompt.builtinUnavailable")
                    : t(`extensions.agentConfiguration.${field}.placeholder`)}
                </p>
              )}
            </div>
          )}
        </InputGroup>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-5">
          <dt className="text-muted-foreground">
            {t("extensions.agentConfiguration.saveLocation")}
          </dt>
          <dd className="min-w-0 select-text break-all">
            {view.promptFiles?.[field] ? (
              <code>{view.promptFiles[field]}</code>
            ) : (
              t("extensions.agentConfiguration.saveLocationUnavailable")
            )}
          </dd>
        </dl>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {t(
            `extensions.agentConfiguration.${field}.${projectScope ? "projectDefaultHint" : "defaultHint"}`,
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {dirty && !saveError ? (
              <p className="text-muted-foreground text-sm" role="status">
                {t("extensions.agentConfiguration.unsaved")}
              </p>
            ) : (
              <SaveFeedback saved={saved} error={saveError} />
            )}
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || draft.length === 0}
              onClick={() => {
                setDraft("");
                setEditing(false);
                setSaved(false);
                setSaveError(undefined);
              }}
            >
              {projectScope
                ? t(`extensions.agentConfiguration.${field}.useInherited`)
                : field === "systemPrompt"
                  ? t("extensions.agentConfiguration.systemPrompt.useDefault")
                  : t("extensions.agentConfiguration.appendSystemPrompt.clear")}
            </Button>
            <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>
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
    </section>
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
