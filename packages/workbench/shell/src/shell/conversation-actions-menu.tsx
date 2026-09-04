"use client";

import {
  ArchiveIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { useI18n } from "../i18n";
import { useWorkbenchNavigation } from "../navigation";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { useAgentRuntime } from "@workbench/agent-runtime-client";

type PendingAction = "archive" | "pin" | "rename";

export function ConversationActionsMenu({
  threadId,
  isPinned,
  title,
}: {
  threadId: string;
  isPinned: boolean;
  title?: string;
}) {
  const { t } = useI18n();
  const threadActions = useAgentRuntime().threadActions;
  const navigation = useWorkbenchNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameFailed, setRenameFailed] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const renameTitleId = useId();

  const togglePinned = async () => {
    if (!threadActions.setPinned || pendingAction) return;
    setPendingAction("pin");
    try {
      await threadActions.setPinned(threadId, !isPinned);
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
      if (!threadActions.archive) throw new Error("Archive is not supported");
      await threadActions.archive(threadId);
      if (navigation.currentConversationId === threadId) {
        navigation.openHome({ replace: true });
      }
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
      if (!threadActions.rename) throw new Error("Rename is not supported");
      await threadActions.rename(threadId, nextTitle);
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
              size="icon"
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
              ) : isPinned ? (
                <PinOffIcon aria-hidden="true" />
              ) : (
                <PinIcon aria-hidden="true" />
              )}
              {t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
            </DropdownMenuItem>
          ) : null}
          {threadActions.rename ? (
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
          ) : null}
          {threadActions.archive ? (
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
          ) : null}
          <SlotHost
            name="thread.menu"
            context={{ threadId, closeMenu: () => setMenuOpen(false) }}
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
            <label className="grid gap-1.5 text-sm font-medium" htmlFor={renameTitleId}>
              {t("workbench.sidebar.renameField")}
              <Input
                id={renameTitleId}
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
