"use client";

import { useEffect, useState } from "react";
import type { BrowserDownload, BrowserFile } from "@workbench/browser-contracts";

import { useI18n } from "../../../i18n";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SettingsRow,
} from "../../../ui";
import { saveBrowserFile } from "./browser-files";
import { useBrowserSessionService } from "./browser-session-service";

export function BrowserDownloadsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useI18n();
  const browser = useBrowserSessionService();
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(false);
    const updates = new Map<string, BrowserDownload>();
    const unsubscribe = browser.subscribeEvents((event) => {
      if (event.type !== "download") return;
      updates.set(event.download.id, event.download);
      setDownloads((current) => [
        event.download,
        ...current.filter((item) => item.id !== event.download.id),
      ]);
    });
    void browser
      .command<BrowserDownload[]>({ type: "downloads.list" })
      .then((items) => {
        if (active)
          setDownloads([...updates.values(), ...items.filter((item) => !updates.has(item.id))]);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [browser, open, retry]);

  const act = async (download: BrowserDownload) => {
    if (pending) return;
    setPending(download.id);
    setError(false);
    try {
      if (download.state === "inProgress")
        await browser.command({ type: "download.cancel", downloadId: download.id });
      else
        await saveBrowserFile(
          await browser.command<BrowserFile>({ type: "download.read", downloadId: download.id }),
          true,
        );
    } catch {
      setError(true);
    } finally {
      setPending(undefined);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("extensions.workspaceBrowser.events.close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogTitle>{t("extensions.workspaceBrowser.events.downloads")}</DialogTitle>
        <DialogDescription>
          {t("extensions.workspaceBrowser.events.downloadsDescription")}
        </DialogDescription>
        <Button
          variant="outline"
          disabled={
            loading || Boolean(pending) || !downloads.some((item) => item.state !== "inProgress")
          }
          onClick={async () => {
            setPending("clear-history");
            setError(false);
            try {
              setDownloads(await browser.command<BrowserDownload[]>({ type: "downloads.clear" }));
            } catch {
              setError(true);
            } finally {
              setPending(undefined);
            }
          }}
        >
          {t("extensions.workspaceBrowser.events.clearDownloadHistory")}
        </Button>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("extensions.workspaceBrowser.events.loading")}
          </p>
        ) : null}
        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t("extensions.workspaceBrowser.events.actionError")}
            </p>
            <Button
              variant="outline"
              disabled={loading || Boolean(pending)}
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("extensions.workspaceBrowser.events.retry")}
            </Button>
          </div>
        ) : null}
        <div className="min-w-0 divide-y divide-border" aria-busy={loading}>
          {!downloads.length && !loading && !error ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("extensions.workspaceBrowser.events.noDownloads")}
            </p>
          ) : null}
          {downloads.map((download) => (
            <SettingsRow
              key={download.id}
              label={<span className="break-all">{download.name}</span>}
              description={
                <>
                  <span>{t(`extensions.workspaceBrowser.events.${download.state}`)}</span>
                  <p>
                    {t("extensions.workspaceBrowser.events.fileProgress", {
                      received: download.receivedBytes,
                      total: download.totalBytes,
                    })}
                  </p>
                </>
              }
              className="sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              {download.state !== "canceled" ? (
                <Button
                  variant="secondary"
                  disabled={Boolean(pending)}
                  onClick={() => void act(download)}
                >
                  {pending === download.id
                    ? t("extensions.workspaceBrowser.events.working")
                    : t(
                        download.state === "inProgress"
                          ? "extensions.workspaceBrowser.events.cancelDownload"
                          : "extensions.workspaceBrowser.events.saveFile",
                      )}
                </Button>
              ) : null}
            </SettingsRow>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
