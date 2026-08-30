"use client";

import { useAui } from "@assistant-ui/react";
import {
  ArchiveIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import {
  useWorkbenchAgentThreadActions,
  useWorkbenchAgentThreadSnapshot,
} from "@workbench/agent-runtime-client/context";

type PendingAction = "archive" | "pin" | "rename";

export function ConversationActionsMenu({
  threadId,
  sessionId,
  title,
}: {
  threadId: string;
  sessionId: string;
  title?: string;
}) {
  const { t } = useI18n();
  const aui = useAui();
  const threadActions = useWorkbenchAgentThreadActions();
  const threadSnapshot = useWorkbenchAgentThreadSnapshot(sessionId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameFailed, setRenameFailed] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();

  const togglePinned = async () => {
    if (!threadActions.setPinned || pendingAction) return;
    setPendingAction("pin");
    try {
      await threadActions.setPinned(sessionId, !threadSnapshot.isPinned);
    } catch (error) {
      console.error("[workbench] failed to update pinned conversation", error);
    } finally {
      setPendingAction(undefined);
    }
  };

  const archiveConversation = async () => {
    if (pendingAction) return;
    setPendingAction("archive");
    try {
      await aui.threads.item({ id: threadId }).archive();
      const archivedPath = `/c/${encodeURIComponent(sessionId)}`;
      if (window.location.pathname === archivedPath) window.history.replaceState(null, "", "/");
    } catch (error) {
      console.error("[workbench] failed to archive conversation", error);
    } finally {
      setPendingAction(undefined);
    }
  };

  const renameConversation = async () => {
    const nextTitle = renameTitle.trim();
    if (!nextTitle || pendingAction) return;
    setPendingAction("rename");
    setRenameFailed(false);
    try {
      await aui.threads.item({ id: threadId }).rename(nextTitle);
      setRenameOpen(false);
    } catch (error) {
      console.error("[workbench] failed to rename conversation", error);
      setRenameFailed(true);
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("workbench.sidebar.conversationOptions")}
              title={t("workbench.sidebar.conversationOptions")}
              className="text-muted-foreground hover:text-foreground"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64 p-1.5">
          {threadActions.setPinned ? (
            <DropdownMenuItem
              disabled={pendingAction !== undefined}
              className="gap-2.5 px-2.5"
              onClick={() => void togglePinned()}
            >
              {pendingAction === "pin" ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : threadSnapshot.isPinned ? (
                <PinOffIcon aria-hidden="true" />
              ) : (
                <PinIcon aria-hidden="true" />
              )}
              {t(threadSnapshot.isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={pendingAction !== undefined}
            className="gap-2.5 px-2.5"
            onClick={() => {
              setRenameTitle(title ?? "");
              setRenameFailed(false);
              setRenameOpen(true);
            }}
          >
            <PencilIcon aria-hidden="true" />
            {t("workbench.sidebar.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pendingAction !== undefined}
            className="gap-2.5 px-2.5"
            onClick={() => void archiveConversation()}
          >
            {pendingAction === "archive" ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <ArchiveIcon aria-hidden="true" />
            )}
            {t("workbench.sidebar.archive")}
          </DropdownMenuItem>
          <SlotHost
            name="thread.menu"
            context={{ threadId: sessionId, closeMenu: () => setMenuOpen(false) }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          if (pendingAction === "rename") return;
          setRenameOpen(open);
          if (!open) setRenameFailed(false);
        }}
      >
        <DialogContent
          closeLabel={t("workbench.sidebar.renameCancel")}
          showCloseButton={pendingAction !== "rename"}
        >
          <DialogHeader>
            <DialogTitle>{t("workbench.sidebar.renameTitle")}</DialogTitle>
            <DialogDescription>{t("workbench.sidebar.renameDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void renameConversation();
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="conversation-rename-title">
              {t("workbench.sidebar.renameField")}
              <Input
                id="conversation-rename-title"
                autoFocus
                autoComplete="off"
                disabled={pendingAction === "rename"}
                value={renameTitle}
                aria-invalid={renameFailed}
                placeholder={t("workbench.sidebar.renamePlaceholder")}
                onChange={(event) => {
                  setRenameTitle(event.currentTarget.value);
                  setRenameFailed(false);
                }}
              />
            </label>
            {renameFailed ? (
              <p role="alert" className="text-destructive text-sm leading-5">
                {t("workbench.sidebar.renameFailed")}
              </p>
            ) : null}
            <DialogFooter closeLabel={t("workbench.sidebar.renameCancel")} className="m-0">
              <Button
                type="button"
                variant="outline"
                disabled={pendingAction === "rename"}
                onClick={() => setRenameOpen(false)}
              >
                {t("workbench.sidebar.renameCancel")}
              </Button>
              <Button type="submit" disabled={pendingAction === "rename" || !renameTitle.trim()}>
                {pendingAction === "rename" ? (
                  <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                ) : null}
                {t("workbench.sidebar.renameSave")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
