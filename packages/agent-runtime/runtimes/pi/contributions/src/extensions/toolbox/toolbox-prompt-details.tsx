"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CopyIcon, FileTextIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useMainViewService } from "@workbench/extension-host";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import type { PromptDescribeValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
  TooltipIconButton,
} from "@workbench/shell/ui";
import { definePiMessage, usePiI18n } from "../../i18n";
import type { ToolboxCapabilitySurfaceParams } from "./toolbox-capability";
import { SkillDocumentPanel } from "./toolbox-capability-presentation";
import { PromptEditorDialog, PromptUseDialog, promptErrorKey } from "./toolbox-prompt-dialogs";
import { toolboxScopeTarget } from "./toolbox-scope";
import { useToolboxScope } from "./toolbox-scope-store";

export function ToolboxPromptDetails({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { t } = usePiI18n();
  const client = usePiResourceClient();
  const mainViews = useMainViewService();
  const scope = useToolboxScope();
  const target = useMemo(
    () => params.catalogTarget ?? toolboxScopeTarget(scope),
    [params.catalogTarget, scope],
  );
  const catalogRevision = useSyncExternalStore(
    client.subscribeCatalog,
    client.getCatalogRevision,
    client.getCatalogRevision,
  );
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState<PromptDescribeValue>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [dialog, setDialog] = useState<"edit" | "copy" | "use" | "delete">();
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    setLoadState("loading");
    setError(undefined);
    void (async () => {
      const id =
        params.promptId ??
        (await client.listPrompts({ target })).prompts.find(
          (item) => item.name === params.name && item.source === params.source,
        )?.id;
      if (!id) throw new Error("prompt-not-found");
      return client.describePrompt({ target, id });
    })().then(
      (next) => {
        if (active) {
          setValue(next);
          setLoadState("ready");
        }
      },
      (failure) => {
        if (active) {
          setLoadState("failed");
          setError(t(promptErrorKey(failure)));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [client, target, params.name, params.promptId, params.source, revision, catalogRevision, t]);
  const returnToList = () =>
    mainViews.open({
      kind: "toolbox",
      title: definePiMessage("extensions.toolbox.prompts.title"),
      params: { section: "prompts" },
    });
  const mutate = async (action: "toggle" | "delete") => {
    if (!value || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (action === "delete") {
        await client.removePrompt({ target, id: value.id, version: value.version });
        returnToList();
      } else {
        const next = await client.setPromptEnabled({
          target,
          id: value.id,
          enabled: !value.enabled,
        });
        setValue({ ...value, enabled: next.enabled });
      }
    } catch (failure) {
      setError(t(promptErrorKey(failure)));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const ready = loadState === "ready" && value;
  const enabled = value?.enabled === true;
  const editable = value?.editable === true;
  return (
    <div className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-5xl px-5 py-7 @2xl:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="bg-muted/30 flex size-(--button-height-large) shrink-0 items-center justify-center rounded-(--button-radius)">
              <FileTextIcon aria-hidden="true" className="size-[calc(var(--icon-size-md)*1.75)]" />
            </span>
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
              {value?.name ?? params.name}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {value ? (
              <label className="text-muted-foreground mr-2 flex items-center gap-2 text-xs">
                <Switch
                  checked={enabled}
                  disabled={!ready || busy}
                  aria-label={t("extensions.toolbox.prompts.enabled")}
                  onCheckedChange={() => void mutate("toggle")}
                />
                {t(
                  enabled
                    ? "extensions.toolbox.skills.enabledStatus"
                    : "extensions.toolbox.skills.disabledStatus",
                )}
              </label>
            ) : null}
            {ready ? (
              <>
                <TooltipIconButton
                  tooltip={t(
                    editable
                      ? "extensions.toolbox.prompts.edit"
                      : "extensions.toolbox.prompts.copy",
                  )}
                  disabled={busy}
                  onClick={() => setDialog(editable ? "edit" : "copy")}
                >
                  {editable ? <PencilIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                </TooltipIconButton>
                {editable ? (
                  <TooltipIconButton
                    tooltip={t("extensions.toolbox.prompts.delete")}
                    disabled={busy}
                    onClick={() => setDialog("delete")}
                  >
                    <Trash2Icon aria-hidden="true" className="text-destructive" />
                  </TooltipIconButton>
                ) : null}
                <Button disabled={busy || !enabled} onClick={() => setDialog("use")}>
                  <PlayIcon aria-hidden="true" />
                  {t("extensions.toolbox.prompts.use")}
                </Button>
              </>
            ) : null}
          </div>
        </header>
        {(value?.description ?? params.description) ? (
          <p className="text-muted-foreground mt-5 text-sm leading-6">
            {value?.description ?? params.description}
          </p>
        ) : null}
        <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <code className="text-foreground">
            /{value?.invocationName ?? params.invocationName ?? params.name}
            {value?.argumentHint ? ` ${value.argumentHint}` : ""}
          </code>
          <span>
            {(value?.origin ?? params.origin) === "package"
              ? t("extensions.toolbox.prompts.packageSource", {
                  source: value?.source ?? params.source ?? "",
                })
              : t("extensions.toolbox.prompts.independent")}
          </span>
        </div>
        {value ? (
          <p className="text-muted-foreground mt-3 break-all font-mono text-xs leading-5">
            {value.filePath}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {error}
          </p>
        ) : null}
        <SkillDocumentPanel
          kind="prompt"
          content={value?.content}
          documentMode={mode}
          loadState={loadState}
          scopeAvailable
          onDocumentModeChange={setMode}
          onRefresh={() => setRevision((n) => n + 1)}
        />
      </div>
      {value && (dialog === "edit" || dialog === "copy") ? (
        <PromptEditorDialog
          target={target}
          template={value}
          copy={dialog === "copy"}
          onClose={() => setDialog(undefined)}
          onSaved={(next) => {
            setDialog(undefined);
            if (dialog === "copy") returnToList();
            else setValue(next);
          }}
        />
      ) : null}
      {enabled && value && dialog === "use" ? (
        <PromptUseDialog target={target} template={value} onClose={() => setDialog(undefined)} />
      ) : null}
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) setDialog(undefined);
        }}
      >
        <DialogContent closeLabel={t("extensions.toolbox.prompts.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("extensions.toolbox.prompts.delete")}</DialogTitle>
            <DialogDescription>
              {t("extensions.toolbox.prompts.deleteDescription", {
                name: value?.name ?? params.name,
              })}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter closeLabel={t("extensions.toolbox.prompts.cancel")}>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(undefined)}>
              {t("extensions.toolbox.prompts.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void mutate("delete")}>
              {t("extensions.toolbox.prompts.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
