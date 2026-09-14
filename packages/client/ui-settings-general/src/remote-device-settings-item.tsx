"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import QRCode from "qrcode";
import { ChevronDownIcon } from "lucide-react";

import { useI18n } from "@workbench/i18n";
import {
  readDesktopRemoteControlPort,
  type DesktopDirectNetworkInterface,
  type DesktopRemoteControlSettings,
  type DesktopRemoteDevice,
  type DesktopRemotePairingStatus,
} from "@workbench/services-client/host";
import {
  Button,
  DropdownMenu,
  Input,
  SettingsDropdownCheckboxItem,
  SettingsDropdownContent,
  SettingsDropdownTrigger,
  SettingsGroup,
  SettingsRow,
  StatusBadge,
  Switch,
} from "@workbench/ui";

import { settingsGeneralTranslationBundle } from "./i18n";

type RemoteSettingsError = "load" | "save" | "pairing" | "revoke" | "reset";

function displayEndpoint(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export function RemoteDeviceSettingsItem() {
  const { t } = useI18n(settingsGeneralTranslationBundle);
  const id = useId();
  const port = useMemo(() => readDesktopRemoteControlPort(), []);
  const [settings, setSettings] = useState<DesktopRemoteControlSettings>();
  const [interfaces, setInterfaces] = useState<readonly DesktopDirectNetworkInterface[]>([]);
  const [devices, setDevices] = useState<readonly DesktopRemoteDevice[]>([]);
  const [pairing, setPairing] = useState<DesktopRemotePairingStatus>();
  const [qrSource, setQrSource] = useState<string>();
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftPort, setDraftPort] = useState("8787");
  const [selectedInterfaceIds, setSelectedInterfaceIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<RemoteSettingsError>();

  const applySettings = useCallback((next: DesktopRemoteControlSettings) => {
    setSettings(next);
    setDraftEnabled(next.enabled);
    setDraftPort(String(next.port));
    setSelectedInterfaceIds(next.selectedInterfaceIds);
  }, []);

  const load = useCallback(async () => {
    if (!port) {
      setError("load");
      setLoading(false);
      return;
    }
    try {
      const [nextSettings, nextInterfaces, nextDevices] = await Promise.all([
        port.describe(),
        port.listInterfaces(),
        port.listDevices(),
      ]);
      applySettings(nextSettings);
      setInterfaces(nextInterfaces);
      setDevices(nextDevices);
      setError(undefined);
    } catch {
      setError("load");
    } finally {
      setLoading(false);
    }
  }, [applySettings, port]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!port || !pairing) return;
    if (pairing.state === "consumed") {
      setPairing(undefined);
      setQrSource(undefined);
      void load();
      return;
    }
    if (["denied", "expired", "locked", "cancelled"].includes(pairing.state)) {
      setPairing(undefined);
      setQrSource(undefined);
      setError("pairing");
      return;
    }
    let disposed = false;
    const timer = window.setInterval(() => {
      void port
        .getPairing(pairing.pairingId)
        .then((next) => {
          if (disposed) return;
          if (next.state === "consumed") {
            setPairing(undefined);
            setQrSource(undefined);
            void load();
            return;
          }
          if (["denied", "expired", "locked", "cancelled"].includes(next.state)) {
            setPairing(undefined);
            setQrSource(undefined);
            setError("pairing");
            return;
          }
          setPairing(next);
        })
        .catch(() => {
          if (disposed) return;
          setPairing(undefined);
          setQrSource(undefined);
          setError("pairing");
        });
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [load, pairing?.pairingId, pairing?.state, port]);

  const saveConfiguration = async () => {
    if (!port || !settings || busy) return;
    const parsedPort = Number(draftPort);
    if (
      !Number.isSafeInteger(parsedPort) ||
      parsedPort < 1 ||
      parsedPort > 65_535 ||
      (draftEnabled && selectedInterfaceIds.length === 0)
    ) {
      setError("save");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      applySettings(
        await port.updateConfiguration({
          enabled: draftEnabled,
          port: parsedPort,
          selectedInterfaceIds,
          expectedRevision: settings.revision,
        }),
      );
    } catch {
      setError("save");
    } finally {
      setBusy(false);
    }
  };

  const createPairing = async () => {
    if (!port || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await port.createPairing();
      setPairing(next);
      setQrSource(
        await QRCode.toDataURL(next.qrPayload, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 256,
        }),
      );
    } catch {
      setError("pairing");
    } finally {
      setBusy(false);
    }
  };

  const closePairing = async (decision: "cancel" | "confirm" | "reject") => {
    if (!port || !pairing || busy) return;
    setBusy(true);
    try {
      if (decision === "confirm") {
        if (!pairing.safetyCode) throw new Error("pairing-not-ready");
        await port.confirmPairing(pairing.pairingId, pairing.safetyCode);
      } else if (decision === "reject") {
        await port.rejectPairing(pairing.pairingId);
      } else {
        await port.cancelPairing(pairing.pairingId);
      }
      setPairing(undefined);
      setQrSource(undefined);
      await load();
    } catch {
      setError("pairing");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: DesktopRemoteDevice) => {
    if (!port || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await port.revokeDevice(device.deviceId, device.revision);
      await load();
    } catch {
      setError("revoke");
    } finally {
      setBusy(false);
    }
  };

  const resetIdentity = async () => {
    if (!port || busy) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await port.resetIdentity();
      setConfirmReset(false);
      setPairing(undefined);
      setQrSource(undefined);
      await load();
    } catch {
      setError("reset");
    } finally {
      setBusy(false);
    }
  };

  const toggleInterface = (interfaceId: string) => {
    setSelectedInterfaceIds((current) =>
      current.includes(interfaceId)
        ? current.filter((value) => value !== interfaceId)
        : [...current, interfaceId],
    );
  };
  const selectedInterfaces = interfaces.filter((item) =>
    selectedInterfaceIds.includes(item.interfaceId),
  );
  const selectedInterfaceSummary =
    selectedInterfaces.length === 0
      ? t("extensions.settings.remoteDevices.selectInterfaces")
      : selectedInterfaces.length === 1
        ? `${selectedInterfaces[0]!.interfaceName} · ${selectedInterfaces[0]!.address}`
        : t("extensions.settings.remoteDevices.selectedInterfaces", {
            count: selectedInterfaces.length,
          });

  return (
    <div className="space-y-5" aria-busy={loading || busy}>
      <SettingsGroup
        title={t("extensions.settings.remoteDevices.accessTitle")}
        description={t("extensions.settings.remoteDevices.description")}
      >
        <SettingsRow
          label={
            <label htmlFor={`${id}-enabled`}>
              {t("extensions.settings.remoteDevices.enabled")}
            </label>
          }
          description={t("extensions.settings.remoteDevices.enabledDescription")}
        >
          <Switch
            id={`${id}-enabled`}
            checked={draftEnabled}
            disabled={loading || busy}
            onCheckedChange={setDraftEnabled}
          />
        </SettingsRow>
        <SettingsRow
          label={
            <label htmlFor={`${id}-port`}>{t("extensions.settings.remoteDevices.port")}</label>
          }
          description={t("extensions.settings.remoteDevices.portDescription")}
        >
          <Input
            id={`${id}-port`}
            className="w-28"
            type="number"
            inputMode="numeric"
            min={1}
            max={65_535}
            value={draftPort}
            disabled={loading || busy}
            onChange={(event) => setDraftPort(event.currentTarget.value)}
          />
        </SettingsRow>
        <SettingsRow
          label={t("extensions.settings.remoteDevices.interfaces")}
          description={t("extensions.settings.remoteDevices.interfacesDescription")}
          controlClassName="w-full sm:max-w-md"
        >
          <DropdownMenu>
            <SettingsDropdownTrigger
              aria-label={t("extensions.settings.remoteDevices.interfaces")}
              className="group justify-between"
              disabled={loading || busy || interfaces.length === 0}
            >
              <span className="min-w-0 flex-1 truncate text-start">
                {interfaces.length === 0
                  ? t("extensions.settings.remoteDevices.noInterfaces")
                  : selectedInterfaceSummary}
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className="text-muted-foreground size-3.5 transition-transform group-data-popup-open:rotate-180"
              />
            </SettingsDropdownTrigger>
            <SettingsDropdownContent align="end" side="bottom">
              {interfaces.map((item) => {
                const selected = selectedInterfaceIds.includes(item.interfaceId);
                return (
                  <SettingsDropdownCheckboxItem
                    key={item.interfaceId}
                    checked={selected}
                    closeOnClick={false}
                    onCheckedChange={() => toggleInterface(item.interfaceId)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.interfaceName}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {item.address}
                      </span>
                    </span>
                    <StatusBadge className="mr-5" tone={selected ? "success" : "neutral"}>
                      {t(
                        `extensions.settings.remoteDevices.${item.kind === "tailscale" ? "tailscale" : "localNetwork"}`,
                      )}
                    </StatusBadge>
                  </SettingsDropdownCheckboxItem>
                );
              })}
            </SettingsDropdownContent>
          </DropdownMenu>
        </SettingsRow>
        <SettingsRow
          label={t("extensions.settings.remoteDevices.listenerStatus")}
          description={
            settings?.endpoints.length
              ? settings.endpoints.map((item) => displayEndpoint(item.host, item.port)).join(" · ")
              : t("extensions.settings.remoteDevices.noEndpoints")
          }
        >
          <div className="flex items-center gap-2">
            <StatusBadge tone={settings?.listenerState === "listening" ? "success" : "neutral"}>
              {t(
                `extensions.settings.remoteDevices.listener.${settings?.listenerState ?? "disabled"}`,
              )}
            </StatusBadge>
            <Button
              variant="outline"
              disabled={!settings || busy}
              onClick={() => void saveConfiguration()}
            >
              {t("extensions.settings.remoteDevices.saveAccess")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("extensions.settings.remoteDevices.createPairing")}>
        {pairing ? (
          <div className="grid gap-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            {qrSource ? (
              <img
                src={qrSource}
                alt={t("extensions.settings.remoteDevices.pairingQrLabel")}
                className="size-48 rounded-[var(--radius-md)] border border-border bg-white p-2"
              />
            ) : null}
            <div className="min-w-0 space-y-3">
              <p className="text-sm text-muted-foreground">
                {pairing.safetyCode
                  ? t("extensions.settings.remoteDevices.waitingForConfirmation")
                  : t("extensions.settings.remoteDevices.waitingForPhone")}
              </p>
              {pairing.safetyCode ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("extensions.settings.remoteDevices.safetyCode")}
                  </p>
                  <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.16em] text-foreground">
                    {pairing.safetyCode}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t("extensions.settings.remoteDevices.pairingCode")}
                </p>
                <code className="mt-1 block rounded-[var(--radius-md)] border border-border bg-muted p-2 text-lg tracking-[0.12em] text-foreground">
                  {pairing.manualCode}
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("extensions.settings.remoteDevices.manualPairingHint")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("extensions.settings.remoteDevices.pairingExpires")}
              </p>
              <div className="flex flex-wrap gap-2">
                {pairing.safetyCode ? (
                  <>
                    <Button disabled={busy} onClick={() => void closePairing("confirm")}>
                      {t("extensions.settings.remoteDevices.confirmSafetyCode")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void closePairing("reject")}
                    >
                      {t("extensions.settings.remoteDevices.rejectPairing")}
                    </Button>
                  </>
                ) : null}
                <Button variant="ghost" disabled={busy} onClick={() => void closePairing("cancel")}>
                  {t("extensions.settings.remoteDevices.cancelPairing")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <SettingsRow
            label={t("extensions.settings.remoteDevices.createPairing")}
            description={t("extensions.settings.remoteDevices.pairingRequiresListener")}
          >
            <Button
              disabled={!port || busy || settings?.listenerState !== "listening"}
              onClick={() => void createPairing()}
            >
              {t("extensions.settings.remoteDevices.createPairing")}
            </Button>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("extensions.settings.remoteDevices.pairedDevices")}>
        {!loading && devices.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t("extensions.settings.remoteDevices.noPairedDevices")}
          </p>
        ) : null}
        {devices.map((device) => (
          <SettingsRow
            key={device.deviceId}
            label={device.deviceDisplayName}
            description={
              <StatusBadge tone={device.state === "active" ? "success" : "neutral"}>
                {t(`extensions.settings.remoteDevices.${device.state}`)}
              </StatusBadge>
            }
          >
            <Button
              variant="outline"
              disabled={busy || device.state !== "active"}
              aria-label={`${t("extensions.settings.remoteDevices.revokeLabel")}: ${device.deviceDisplayName}`}
              onClick={() => void revoke(device)}
            >
              {t("extensions.settings.remoteDevices.revoke")}
            </Button>
          </SettingsRow>
        ))}
        <SettingsRow
          label={t("extensions.settings.remoteDevices.resetIdentity")}
          description={
            confirmReset
              ? t("extensions.settings.remoteDevices.resetIdentityConfirm")
              : t("extensions.settings.remoteDevices.resetIdentityDescription")
          }
        >
          <div className="flex gap-2">
            {confirmReset ? (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmReset(false)}>
                {t("extensions.settings.remoteDevices.cancelReset")}
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy} onClick={() => void resetIdentity()}>
              {confirmReset
                ? t("extensions.settings.remoteDevices.confirmReset")
                : t("extensions.settings.remoteDevices.resetIdentity")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`extensions.settings.remoteDevices.${error}Error`)}
        </p>
      ) : null}
    </div>
  );
}
