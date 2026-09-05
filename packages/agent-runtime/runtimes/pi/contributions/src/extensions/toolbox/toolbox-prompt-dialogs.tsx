"use client";

import { useId, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useAgentRuntime, useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import type {
  PiResourceCatalogTarget,
  PromptDescribeValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { useMainViewService } from "@workbench/extension-host";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Input,
  Textarea,
  WorkspaceSelector,
} from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { insertPromptDraft } from "./prompt-composer-draft";
import { expandBuiltinPromptTemplate, type PromptTemplateDraft } from "./builtin-prompt-templates";

export function promptErrorKey(error: unknown) {
  if (error instanceof Error && error.message === "prompt-existing-draft")
    return "extensions.toolbox.prompts.existingDraft";
  switch (error instanceof PiApiError ? error.code : undefined) {
    case "project-untrusted":
      return "extensions.toolbox.prompts.untrusted";
    case "session-busy":
      return "extensions.toolbox.prompts.busy";
    case "prompt-conflict":
      return "extensions.toolbox.prompts.conflict";
    case "prompt-name-exists":
      return "extensions.toolbox.prompts.nameExists";
    case "prompt-invalid-content":
      return "extensions.toolbox.prompts.invalidContent";
    case "prompt-read-only":
      return "extensions.toolbox.prompts.readOnly";
    case "prompt-not-found":
      return "extensions.toolbox.prompts.notFound";
    case "prompt-disabled":
      return "extensions.toolbox.prompts.disabledUse";
    default:
      return "extensions.toolbox.prompts.failed";
  }
}

export function PromptEditorDialog({
  target,
  template,
  initialValue,
  copy = false,
  onClose,
  onSaved,
}: {
  target: PiResourceCatalogTarget;
  template?: PromptDescribeValue;
  initialValue?: PromptTemplateDraft;
  copy?: boolean;
  onClose(): void;
  onSaved(value: PromptDescribeValue): void;
}) {
  const { t } = usePiI18n();
  const client = usePiResourceClient();
  const id = useId();
  const initialName = template
    ? `${template.name}${copy ? "-copy" : ""}`
    : (initialValue?.name ?? "");
  const initialContent = template?.content ?? initialValue?.content ?? "";
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const editing = Boolean(template && !copy);
  const dirty = name !== initialName || content !== initialContent;
  const close = () => {
    if (inFlight.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const value = await client.savePrompt({
        target,
        name: name.trim(),
        content,
        ...(template && !copy ? { id: template.id, version: template.version } : {}),
      });
      onSaved(value);
    } catch (failure) {
      setError(t(promptErrorKey(failure)));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        closeLabel={t("extensions.toolbox.prompts.cancel")}
        className="flex max-h-[85dvh] flex-col sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              discard
                ? "extensions.toolbox.prompts.discardTitle"
                : copy
                  ? "extensions.toolbox.prompts.copy"
                  : editing
                    ? "extensions.toolbox.prompts.edit"
                    : "extensions.toolbox.prompts.create",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              discard
                ? "extensions.toolbox.prompts.discardDescription"
                : "extensions.toolbox.prompts.editorHint",
            )}
          </DialogDescription>
        </DialogHeader>
        {discard ? (
          <DialogFooter closeLabel={t("extensions.toolbox.prompts.cancel")}>
            <Button variant="outline" onClick={() => setDiscard(false)}>
              {t("extensions.toolbox.prompts.keepEditing")}
            </Button>
            <Button variant="destructive" onClick={onClose}>
              {t("extensions.toolbox.prompts.discard")}
            </Button>
          </DialogFooter>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="min-h-0 space-y-4 overflow-y-auto px-1">
              <div className="space-y-2">
                <label htmlFor={`${id}-name`} className="text-sm font-medium">
                  {t("extensions.toolbox.prompts.name")}
                </label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  required
                  maxLength={100}
                  readOnly={editing}
                  disabled={saving}
                  placeholder="review"
                  autoComplete="off"
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t("extensions.toolbox.prompts.nameHint")}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`${id}-content`} className="text-sm font-medium">
                    {t("extensions.toolbox.prompts.content")}
                  </label>
                  {!template ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={saving || Boolean(content.trim())}
                      onClick={() => setContent(t("extensions.toolbox.prompts.example"))}
                    >
                      {t("extensions.toolbox.prompts.useExample")}
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  id={`${id}-content`}
                  className="min-h-64 font-mono leading-6"
                  value={content}
                  required
                  disabled={saving}
                  spellCheck={false}
                  placeholder={t("extensions.toolbox.prompts.example")}
                  onChange={(event) => setContent(event.currentTarget.value)}
                />
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter closeLabel={t("extensions.toolbox.prompts.cancel")}>
              <Button type="button" variant="outline" disabled={saving} onClick={close}>
                {t("extensions.toolbox.prompts.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim() || !content.trim() || (editing && !dirty)}
              >
                {t(
                  saving ? "extensions.toolbox.prompts.saving" : "extensions.toolbox.prompts.save",
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PromptUseDialog({
  target,
  template,
  onClose,
}: {
  target: PiResourceCatalogTarget;
  template: PromptDescribeValue | (PromptTemplateDraft & { builtin: true; argumentHint?: string });
  onClose(): void;
}) {
  const { t } = usePiI18n();
  const client = usePiResourceClient();
  const runtime = useAgentRuntime();
  const current = useCurrentSession();
  const { threads } = useThreadList();
  const { workspaces, draftWorkspace } = useWorkspaceSelection();
  const mainViews = useMainViewService();
  const navigation = useWorkbenchNavigation();
  const id = useId();
  const availableThreads = threads.filter(
    (thread) =>
      !thread.isArchived &&
      (target.scope === "user" || thread.workspace?.id === target.workspaceId),
  );
  const availableWorkspaces = workspaces.filter(
    (workspace) => target.scope === "user" || workspace.id === target.workspaceId,
  );
  const draftAvailable =
    current.isNewThread &&
    current.sessionId &&
    (target.scope === "user" || draftWorkspace?.id === target.workspaceId);
  const [destination, setDestination] = useState(() =>
    draftAvailable
      ? `draft:${current.sessionId}`
      : availableThreads.some((thread) => thread.threadId === current.threadId)
        ? current.threadId!
        : "new",
  );
  const [workspaceId, setWorkspaceId] = useState(() =>
    target.scope === "project" ? target.workspaceId : (draftWorkspace?.id ?? ""),
  );
  const [arguments_, setArguments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const selectedWorkspace = availableWorkspaces.find((workspace) => workspace.id === workspaceId);
  const selectedThread = availableThreads.find((thread) => thread.threadId === destination);
  const selectingDraft = draftAvailable && destination === `draft:${current.sessionId}`;
  const valid =
    destination === "new" ? Boolean(selectedWorkspace) : Boolean(selectingDraft || selectedThread);
  const needsArguments = Boolean(
    template.argumentHint || /\$(?:\d|@|ARGUMENTS|\{)/u.test(template.content),
  );
  const useTemplate = async () => {
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const content =
        "builtin" in template
          ? expandBuiltinPromptTemplate(template, arguments_)
          : (await client.expandPrompt({ target, id: template.id, arguments: arguments_ })).content;
      if (!content.trim()) throw new Error("empty-template");
      insertPromptDraft(runtime, destination, content, workspaceId);
      mainViews.close();
      if (destination === "new" || destination.startsWith("draft:")) navigation.openHome();
      else navigation.openConversation(destination);
      onClose();
    } catch (failure) {
      setError(t(promptErrorKey(failure)));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <DialogContent closeLabel={t("extensions.toolbox.prompts.cancel")} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("extensions.toolbox.prompts.useNamed", { name: template.name })}
          </DialogTitle>
          <DialogDescription>{t("extensions.toolbox.prompts.useHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void useTemplate();
          }}
        >
          <div className="space-y-2">
            <p id={`${id}-destination`} className="text-sm font-medium">
              {t("extensions.toolbox.prompts.destination")}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    disabled={busy}
                    aria-labelledby={`${id}-destination`}
                    className="w-full justify-between"
                  />
                }
              >
                <span className="truncate">
                  {destination === "new"
                    ? t("extensions.toolbox.prompts.newConversation")
                    : selectingDraft
                      ? t("extensions.toolbox.prompts.currentDraft")
                      : selectedThread?.title ||
                        t("extensions.toolbox.prompts.untitledConversation")}
                </span>
                <ChevronDownIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-64 overflow-y-auto">
                <DropdownMenuRadioGroup value={destination} onValueChange={setDestination}>
                  {draftAvailable ? (
                    <DropdownMenuRadioItem value={`draft:${current.sessionId}`}>
                      {t("extensions.toolbox.prompts.currentDraft")}
                    </DropdownMenuRadioItem>
                  ) : null}
                  <DropdownMenuRadioItem value="new">
                    {t("extensions.toolbox.prompts.newConversation")}
                  </DropdownMenuRadioItem>
                  {availableThreads.map((thread) => (
                    <DropdownMenuRadioItem key={thread.threadId} value={thread.threadId}>
                      {thread.title || t("extensions.toolbox.prompts.untitledConversation")}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {destination === "new" ? (
            <WorkspaceSelector
              variant="outline"
              disabled={busy}
              selectedWorkspace={selectedWorkspace}
              workspaces={availableWorkspaces}
              onValueChange={setWorkspaceId}
              labels={{
                select: t("extensions.toolbox.prompts.selectWorkspace"),
                clear: t("extensions.toolbox.prompts.cancel"),
                selecting: t("extensions.toolbox.main.loading"),
                selectError: t("extensions.toolbox.prompts.failed"),
                empty: t("extensions.toolbox.prompts.noWorkspaces"),
                search: t("extensions.toolbox.prompts.searchWorkspace"),
                searchPlaceholder: t("extensions.toolbox.prompts.searchWorkspace"),
                noSearchResults: t("extensions.toolbox.noMatches"),
              }}
            />
          ) : null}
          {needsArguments ? (
            <div className="space-y-2">
              <label htmlFor={`${id}-arguments`} className="text-sm font-medium">
                {t("extensions.toolbox.prompts.arguments")}
              </label>
              <Input
                id={`${id}-arguments`}
                value={arguments_}
                disabled={busy}
                placeholder={template.argumentHint}
                onChange={(event) => setArguments(event.currentTarget.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("extensions.toolbox.prompts.argumentsHint")}
              </p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter closeLabel={t("extensions.toolbox.prompts.cancel")}>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("extensions.toolbox.prompts.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {t(
                busy ? "extensions.toolbox.prompts.preparing" : "extensions.toolbox.prompts.insert",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
