"use client";

import { GlobeIcon, LaptopIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  WorkbenchAgentCapabilityError,
  type WorkbenchRuntimeHostCapability,
} from "@workbench/agent-runtime-client";
import { useI18n } from "@workbench/shell/i18n";
import { useRuntimeConnection } from "@workbench/shell/runtime-connection";
import { cn } from "@workbench/shell/utils";
import {
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workbench/shell/ui";

import { shouldUseNativeDirectoryPicker } from "./directory-picker-capability";
import { RemoteDirectoryPickerDialog } from "./remote-directory-picker-dialog";
import styles from "./directory-picker.module.css";

/** Mount once per add action so each project starts with the connection's suggested type. */
export function WorkspaceDirectoryPickerDialog({
  hostClient,
  onClose,
  onSelectPath,
}: {
  hostClient: WorkbenchRuntimeHostCapability;
  onClose(): void;
  onSelectPath(path: string): void | Promise<void>;
}) {
  const { t } = useI18n();
  const connection = useRuntimeConnection();
  const groupId = useId();
  const [type, setType] = useState<"local" | "remote">(() =>
    shouldUseNativeDirectoryPicker(connection) ? "local" : "remote",
  );
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "picking" | "selecting">("idle");
  const picking = phase !== "idle";
  const nativeRequest = useRef<AbortController | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (phase !== "picking") return;
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(
    () => () => {
      nativeRequest.current?.abort();
      nativeRequest.current = null;
    },
    [],
  );

  const cancelNativeRequest = () => {
    nativeRequest.current?.abort();
    nativeRequest.current = null;
    setPhase("idle");
    setSlow(false);
  };

  const continuePicking = async () => {
    if (picking || nativeRequest.current) return;
    if (type === "remote") {
      setRemoteOpen(true);
      return;
    }

    const request = new AbortController();
    nativeRequest.current = request;
    let awaitingNative = true;
    setPhase("picking");
    setSlow(false);
    setError(false);
    try {
      const path = await hostClient.pickDirectory({ signal: request.signal });
      if (request.signal.aborted) return;
      awaitingNative = false;
      if (path) {
        setPhase("selecting");
        await onSelectPath(path);
        if (!request.signal.aborted) onClose();
      }
    } catch (cause) {
      if (request.signal.aborted) return;
      if (
        awaitingNative &&
        cause instanceof WorkbenchAgentCapabilityError &&
        (cause.code === "unavailable" || cause.code === "permission-denied")
      ) {
        setRemoteOpen(true);
      } else {
        setError(true);
      }
    } finally {
      if (nativeRequest.current === request) {
        nativeRequest.current = null;
        setPhase("idle");
        setSlow(false);
      }
    }
  };

  if (remoteOpen) {
    return (
      <RemoteDirectoryPickerDialog
        hostClient={hostClient}
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onSelectPath={onSelectPath}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && phase !== "selecting") {
          cancelNativeRequest();
          onClose();
        }
      }}
    >
      <DialogContent
        closeLabel={t("extensions.workspaceDirectory.close")}
        data-workspace-directory-picker=""
        className={cn(styles.dialog, "gap-0 overflow-y-auto p-5 sm:p-6")}
      >
        <DialogHeader className="pe-8">
          <DialogTitle className="text-2xl font-semibold">
            {t("extensions.workspaceDirectory.createProject")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-6 pt-7 sm:gap-8 sm:pt-8"
          onSubmit={(event) => {
            event.preventDefault();
            void continuePicking();
          }}
        >
          <fieldset disabled={picking} className="min-w-0">
            <legend className="mb-3 text-base font-medium">
              {t("extensions.workspaceDirectory.projectType")}
            </legend>
            <div className={cn(styles.types, "grid gap-3 sm:gap-4")}>
              {(["local", "remote"] as const).map((option) => {
                const Icon = option === "local" ? LaptopIcon : GlobeIcon;
                const labelId = `${groupId}-${option}-label`;
                const descriptionId = `${groupId}-${option}-description`;
                return (
                  <label
                    key={option}
                    data-state={type === option ? "on" : "off"}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-auto min-w-0 cursor-pointer flex-col items-stretch justify-between gap-6 p-4 text-start whitespace-normal sm:gap-8 sm:p-5 has-disabled:pointer-events-none has-disabled:opacity-50",
                    )}
                  >
                    <span className="flex min-h-[var(--icon-frame-size-default)] items-center justify-between gap-3">
                      <Icon
                        aria-hidden="true"
                        className="block size-[var(--icon-size-lg)] shrink-0 text-muted-foreground"
                      />
                      <input
                        type="radio"
                        name={groupId}
                        value={option}
                        checked={type === option}
                        aria-labelledby={labelId}
                        aria-describedby={descriptionId}
                        className="m-0 size-[var(--icon-size-lg)] shrink-0 cursor-pointer accent-primary"
                        onChange={() => {
                          setType(option);
                          setError(false);
                        }}
                      />
                    </span>
                    <span className="flex flex-col gap-1.5">
                      <span id={labelId} className="text-base">
                        {t(`extensions.workspaceDirectory.${option}`)}
                      </span>
                      <span
                        id={descriptionId}
                        className="font-normal leading-relaxed text-muted-foreground"
                      >
                        {t(`extensions.workspaceDirectory.${option}Description`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t("extensions.workspaceDirectory.selectError")}
            </p>
          ) : null}
          {phase === "picking" && slow ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("extensions.workspaceDirectory.nativePickerSlow")}
            </p>
          ) : null}
          <DialogFooter
            closeLabel={t("extensions.workspaceDirectory.cancel")}
            className="m-0 flex-row flex-wrap justify-end border-0 bg-transparent p-0"
          >
            {phase === "picking" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  cancelNativeRequest();
                  setRemoteOpen(true);
                }}
              >
                {t("extensions.workspaceDirectory.useRemotePicker")}
              </Button>
            ) : null}
            <Button type="submit" disabled={picking}>
              {picking ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : null}
              {t(
                picking
                  ? "extensions.workspaceDirectory.selecting"
                  : "extensions.workspaceDirectory.next",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
