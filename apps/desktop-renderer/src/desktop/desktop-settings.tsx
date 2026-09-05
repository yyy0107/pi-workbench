"use client";

import { Fragment, useEffect, useId, useState } from "react";
import {
  DESKTOP_NOTIFICATION_SOUNDS,
  DESKTOP_TERMINAL_SHELLS,
  isDesktopNotificationSound,
  isDesktopTerminalShell,
  readDesktopSettingsPort,
  type DesktopPreferences,
  type DesktopSettingsSnapshot,
} from "@workbench/desktop-contracts";
import { defineExtension } from "@workbench/extension-sdk";
import { createTranslationBundleMessageFactory, useTranslationBundle } from "@workbench/shell/i18n";
import {
  Button,
  DropdownMenu,
  DropdownMenuRadioGroup,
  Input,
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
  SettingsGroup,
  SettingsRow,
  Switch,
} from "@workbench/shell/ui";
import { desktopRendererTranslationBundle } from "@/app/i18n/bundle";
import { playNotificationSound, stopNotificationSound } from "./notification-sounds";

function DesktopSettingsItem() {
  const { t } = useTranslationBundle(desktopRendererTranslationBundle);
  const id = useId();
  const [snapshot, setSnapshot] = useState<DesktopSettingsSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [soundError, setSoundError] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [proxy, setProxy] = useState({ httpProxy: "", noProxy: "" });
  const [token, setToken] = useState("");
  const port =
    typeof window === "undefined"
      ? undefined
      : readDesktopSettingsPort(window.workbenchDesktop?.settings);
  const errorMessage = (reason: unknown) => {
    const code = [
      "invalid-proxy",
      "invalid-bypass",
      "secure-storage-unavailable",
      "update-in-progress",
    ].find((key) => reason instanceof Error && reason.message.includes(key));
    return t(
      code === "invalid-proxy"
        ? "desktopRenderer.settings.invalidProxy"
        : code === "invalid-bypass"
          ? "desktopRenderer.settings.invalidBypass"
          : code === "secure-storage-unavailable"
            ? "desktopRenderer.settings.secureStorageUnavailable"
            : code === "update-in-progress"
              ? "desktopRenderer.settings.updateInProgress"
              : "desktopRenderer.settings.error",
    );
  };
  useEffect(() => {
    setUnavailable(!port);
    if (!port) return;
    let active = true;
    const unsubscribe = port.subscribe((value) => {
      if (active) setSnapshot(value);
    });
    void port.load().then(
      (value) => {
        if (active) {
          setSnapshot(value);
          setProxy(value.preferences);
        }
      },
      () => {
        if (active) setError(t("desktopRenderer.settings.loadError"));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [port, t]);
  async function save(action: () => Promise<DesktopSettingsSnapshot>) {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await action());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  const toggles = [
    "hardwareAcceleration",
    "previewUpdates",
    "automaticUpdates",
    "taskNotifications",
    "notificationSounds",
    "keepAwake",
  ] as const satisfies readonly (keyof DesktopPreferences)[];
  if (unavailable || !snapshot) {
    return (
      <div className="space-y-3" aria-busy={!unavailable && !error}>
        <p
          role={unavailable || error ? "alert" : "status"}
          className="text-muted-foreground text-sm"
        >
          {unavailable
            ? t("desktopRenderer.settings.connectionUnavailable")
            : error || t("desktopRenderer.settings.loading")}
        </p>
        {port && error ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void save(async () => {
                const value = await port.load();
                setProxy(value.preferences);
                return value;
              })
            }
          >
            {t("desktopRenderer.settings.retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-4" aria-busy={busy || !snapshot}>
      <SettingsGroup>
        {snapshot.platform === "win32" ? (
          <SettingsRow
            controlClassName="flex flex-wrap items-center gap-3"
            label={
              <label htmlFor={`${id}-terminal-shell`}>
                {t("desktopRenderer.settings.terminalShell")}
              </label>
            }
            description={
              <>
                <span id={`${id}-terminal-shell-description`}>
                  {t("desktopRenderer.settings.terminalShellDescription")}
                </span>
                <p role={snapshot.terminalShellStatus === "failed" ? "alert" : "status"}>
                  {t(
                    `desktopRenderer.settings.terminalShellStatus.${snapshot.terminalShellStatus}`,
                  )}
                </p>
              </>
            }
          >
            <DropdownMenu>
              <SettingsDropdownTrigger
                id={`${id}-terminal-shell`}
                aria-label={t("desktopRenderer.settings.terminalShell")}
                aria-describedby={`${id}-terminal-shell-description`}
                disabled={busy}
              >
                {t(`desktopRenderer.settings.terminalShells.${snapshot.preferences.terminalShell}`)}
              </SettingsDropdownTrigger>
              <SettingsDropdownContent align="end">
                <DropdownMenuRadioGroup
                  value={snapshot.preferences.terminalShell}
                  aria-label={t("desktopRenderer.settings.terminalShell")}
                  onValueChange={(value) => {
                    if (port && isDesktopTerminalShell(value))
                      void save(() => port.update({ terminalShell: value }));
                  }}
                >
                  {DESKTOP_TERMINAL_SHELLS.map((shell) => (
                    <SettingsDropdownRadioItem key={shell} value={shell}>
                      {t(`desktopRenderer.settings.terminalShells.${shell}`)}
                    </SettingsDropdownRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingsDropdownContent>
            </DropdownMenu>
            {snapshot.terminalShellStatus === "failed" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  port &&
                  void save(() =>
                    port.update({ terminalShell: snapshot.preferences.terminalShell }),
                  )
                }
              >
                {t("desktopRenderer.settings.retry")}
              </Button>
            ) : null}
          </SettingsRow>
        ) : null}
        {toggles.map((key) => (
          <SettingsRow
            key={key}
            controlClassName="flex flex-wrap items-center gap-3"
            label={<label htmlFor={`${id}-${key}`}>{t(`desktopRenderer.settings.${key}`)}</label>}
            description={
              <span id={`${id}-${key}-description`}>
                {t(`desktopRenderer.settings.${key}Description`)}
              </span>
            }
          >
            {key === "notificationSounds" ? (
              <>
                <DropdownMenu>
                  <SettingsDropdownTrigger
                    aria-label={t("desktopRenderer.settings.notificationSound")}
                    disabled={
                      !port?.onNotificationSound ||
                      busy ||
                      !snapshot.preferences.notificationSounds ||
                      !snapshot.preferences.taskNotifications
                    }
                  >
                    {t(
                      `desktopRenderer.settings.sounds.${snapshot?.preferences.notificationSound ?? "chime"}`,
                    )}
                  </SettingsDropdownTrigger>
                  <SettingsDropdownContent align="end">
                    <DropdownMenuRadioGroup
                      className="grid grid-cols-[minmax(0,1fr)_auto]"
                      value={snapshot?.preferences.notificationSound ?? "chime"}
                      aria-label={t("desktopRenderer.settings.notificationSound")}
                      onValueChange={(value) => {
                        if (port && isDesktopNotificationSound(value))
                          void save(() => port.update({ notificationSound: value }));
                      }}
                    >
                      {DESKTOP_NOTIFICATION_SOUNDS.map((sound) => {
                        const label = t(`desktopRenderer.settings.sounds.${sound}`);
                        return (
                          <Fragment key={sound}>
                            <SettingsDropdownRadioItem value={sound} className="rounded-r-none">
                              {label}
                            </SettingsDropdownRadioItem>
                            <SettingsDropdownItem
                              closeOnClick={false}
                              className="text-muted-foreground justify-center rounded-l-none"
                              onClick={() => {
                                setSoundError(false);
                                void playNotificationSound(sound).catch(() => setSoundError(true));
                              }}
                            >
                              {t("desktopRenderer.settings.previewSound")}
                              <span className="sr-only">{label}</span>
                            </SettingsDropdownItem>
                          </Fragment>
                        );
                      })}
                    </DropdownMenuRadioGroup>
                  </SettingsDropdownContent>
                </DropdownMenu>
              </>
            ) : null}
            <Switch
              id={`${id}-${key}`}
              aria-describedby={`${id}-${key}-description`}
              checked={snapshot?.preferences[key] ?? false}
              disabled={
                !snapshot ||
                busy ||
                (key === "notificationSounds" && !snapshot.preferences.taskNotifications)
              }
              onCheckedChange={(checked) => {
                if (port)
                  void save(async () => {
                    const value = await port.update({ [key]: checked });
                    if (!checked && (key === "notificationSounds" || key === "taskNotifications"))
                      stopNotificationSound();
                    return value;
                  });
              }}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
      {!port?.onNotificationSound ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("desktopRenderer.settings.soundRestartRequired")}
        </p>
      ) : null}
      {soundError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("desktopRenderer.settings.soundFailed")}
        </p>
      ) : null}
      <SettingsGroup>
        {(["httpProxy", "noProxy"] as const).map((key) => (
          <SettingsRow
            key={key}
            label={<label htmlFor={`${id}-${key}`}>{t(`desktopRenderer.settings.${key}`)}</label>}
            description={t(`desktopRenderer.settings.${key}Description`)}
            controlClassName="w-full"
          >
            <Input
              id={`${id}-${key}`}
              value={proxy[key]}
              disabled={!snapshot || busy}
              placeholder={t(`desktopRenderer.settings.${key}Placeholder`)}
              onChange={(event) => setProxy((value) => ({ ...value, [key]: event.target.value }))}
            />
          </SettingsRow>
        ))}
        <SettingsRow label={t("desktopRenderer.settings.networkSaveDescription")}>
          <Button
            variant="outline"
            disabled={!snapshot || busy}
            onClick={() => {
              if (port) void save(() => port.update(proxy));
            }}
          >
            {t("desktopRenderer.settings.save")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title={t("desktopRenderer.settings.updates")}
        description={t("desktopRenderer.settings.updateSource")}
      >
        <SettingsRow
          label={<label htmlFor={`${id}-token`}>{t("desktopRenderer.settings.updateToken")}</label>}
          description={t(
            snapshot?.tokenConfigured
              ? "desktopRenderer.settings.tokenConfigured"
              : "desktopRenderer.settings.tokenMissing",
          )}
          controlClassName="w-full"
        >
          <div className="flex gap-2">
            <Input
              id={`${id}-token`}
              type="password"
              autoComplete="new-password"
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!snapshot || busy || !token}
              onClick={() => {
                if (port)
                  void save(async () => {
                    const value = await port.setUpdateToken(token);
                    setToken("");
                    return value;
                  });
              }}
            >
              {t("desktopRenderer.settings.save")}
            </Button>
            <Button
              variant="ghost"
              disabled={!snapshot?.tokenConfigured || busy}
              onClick={() => {
                if (port) void save(() => port.setUpdateToken(""));
              }}
            >
              {t("desktopRenderer.settings.clear")}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          label={
            snapshot
              ? t("desktopRenderer.settings.version", { version: snapshot.version })
              : t("desktopRenderer.settings.updates")
          }
          description={
            <span role="status">
              {snapshot
                ? t(`desktopRenderer.settings.updateStatus.${snapshot.update.status}`)
                : t("desktopRenderer.settings.loading")}
              {snapshot?.update.percent === undefined ? null : (
                <> {t("desktopRenderer.settings.progress", { percent: snapshot.update.percent })}</>
              )}
            </span>
          }
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={
                !snapshot ||
                busy ||
                ["development", "checking", "downloading", "downloaded"].includes(
                  snapshot.update.status,
                )
              }
              onClick={() => {
                if (port) void save(() => port.runUpdate("check"));
              }}
            >
              {t("desktopRenderer.settings.checkUpdates")}
            </Button>
            {snapshot?.update.status === "available" || snapshot?.update.status === "downloaded" ? (
              <Button
                disabled={busy}
                onClick={() => {
                  if (port)
                    void save(() =>
                      port.runUpdate(
                        snapshot.update.status === "downloaded" ? "install" : "download",
                      ),
                    );
                }}
              >
                {t(
                  snapshot.update.status === "downloaded"
                    ? "desktopRenderer.settings.install"
                    : "desktopRenderer.settings.download",
                )}
              </Button>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsGroup>
      {snapshot?.restartRequired ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("desktopRenderer.settings.restartRequired")}
        </p>
      ) : null}
      {snapshot && !snapshot.notificationsSupported ? (
        <p className="text-muted-foreground text-sm">
          {t("desktopRenderer.settings.notificationsUnsupported")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}{" "}
          <Button
            variant="ghost"
            onClick={() => {
              if (port)
                void save(async () => {
                  const value = await port.load();
                  setProxy(value.preferences);
                  return value;
                });
            }}
          >
            {t("desktopRenderer.settings.retry")}
          </Button>
        </p>
      ) : null}
    </div>
  );
}

const message = createTranslationBundleMessageFactory(desktopRendererTranslationBundle);
export const desktopSettingsExtension = defineExtension({
  id: "workbench.desktop-settings",
  name: "Desktop Settings",
  version: "1.0.0",
  setup(context) {
    return context.settings.registerItem({
      sectionId: "general",
      id: "desktop",
      title: message("desktopRenderer.settings.title"),
      keywords: (
        [
          "hardwareAcceleration",
          "keepAwake",
          "previewUpdates",
          "automaticUpdates",
          "taskNotifications",
          "notificationSounds",
          "notificationSound",
          "terminalShell",
          "httpProxy",
          "noProxy",
        ] as const
      ).map((key) => message(`desktopRenderer.settings.${key}`)),
      order: 20,
      component: DesktopSettingsItem,
    });
  },
});
