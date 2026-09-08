"use client";

import { ChevronDownIcon, PlusIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client";
import { useWorkbenchRuntimeHostCapability } from "@workbench/agent-runtime-client/context";
import type {
  BrowserPage,
  BrowserPermission,
  BrowserSettings,
  BrowserSitePermissions,
} from "@workbench/browser-contracts";

import { defineMessage, useI18n } from "../../../i18n";
import {
  RemoteDirectoryPickerDialog,
  shouldUseNativeDirectoryPicker,
} from "../../../directory-picker";
import { useRuntimeConnection } from "../../../runtime-connection";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "../../../right-workspace-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuRadioGroup,
  Input,
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
  SettingsField,
  SettingsGroup,
  SettingsRow,
  Switch,
} from "../../../ui";
import { useBrowserSessionService } from "./browser-session-service";
import { BrowserDownloadsDialog } from "./browser-downloads-dialog";

type SettingsKey =
  keyof typeof import("../../../i18n/extensions/en-US").extensionsEnUS.workspaceBrowser.settings;
type PlainSettingsKey = Exclude<SettingsKey, "importSuccess" | "editSiteFor" | "removeSiteFor">;
const PERMISSIONS = [
  "history",
  "download",
  "upload",
] as const satisfies readonly BrowserPermission[];
export const BROWSER_SETTINGS_SECTION_ID = "browser";

function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange(value: T): void;
}) {
  return (
    <DropdownMenu>
      <SettingsDropdownTrigger aria-label={label} disabled={disabled}>
        <span className="truncate">{options.find((option) => option.value === value)?.label}</span>
        <ChevronDownIcon />
      </SettingsDropdownTrigger>
      <SettingsDropdownContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((item) => item.value === next);
            if (option) onChange(option.value);
          }}
        >
          {options.map((option) => (
            <SettingsDropdownRadioItem key={option.value} value={option.value}>
              {option.label}
            </SettingsDropdownRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SettingsDropdownContent>
    </DropdownMenu>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      className="sm:grid-cols-1 @[36rem]/browser-settings:grid-cols-[minmax(0,1fr)_auto]"
      controlClassName="max-w-full sm:justify-self-start @[36rem]/browser-settings:justify-self-end"
    >
      {children}
    </SettingsRow>
  );
}

export function BrowserSettingsItem() {
  const { t, locale } = useI18n();
  const text = (key: PlainSettingsKey) => t(`extensions.workspaceBrowser.settings.${key}`);
  const browser = useBrowserSessionService();
  const hostClient = useWorkbenchRuntimeHostCapability();
  const connection = useRuntimeConnection();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const surfaces = useRightWorkspaceState((state) => state.surfaces);
  useSyncExternalStore(browser.subscribe.bind(browser), browser.getRevision.bind(browser), () => 0);
  const settings = browser.getSettings();
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const actionInFlight = useRef(false);
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState<"loadError" | "actionError" | "importTooLarge">();
  const [notice, setNotice] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const directoryRequest = useRef<AbortController | undefined>(undefined);
  const [site, setSite] = useState<BrowserSitePermissions>();
  const [originalOrigin, setOriginalOrigin] = useState<string>();
  const [siteError, setSiteError] = useState<"invalidOrigin" | "duplicateOrigin">();
  const disabled = !loaded || actionPending;

  useEffect(() => () => directoryRequest.current?.abort(), []);

  useEffect(() => {
    let active = true;
    void browser
      .loadSettings()
      .then(() => {
        if (active) setLoaded(true);
      })
      .catch(() => {
        if (active) setError("loadError");
      });
    return () => {
      active = false;
    };
  }, [browser]);

  const run = (action: () => Promise<void>, success = text("saved"), lockControls = true) => {
    if (lockControls && actionInFlight.current) return Promise.resolve();
    if (lockControls) {
      actionInFlight.current = true;
      setActionPending(true);
    }
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const task = queue.current.then(async () => {
      try {
        await action();
        if (success) setNotice(success);
      } catch {
        setError(loaded ? "actionError" : "loadError");
      } finally {
        if (lockControls) {
          actionInFlight.current = false;
          setActionPending(false);
        }
      }
    });
    queue.current = task;
    return task.then(() => {
      if (queue.current === task) setPending(false);
    });
  };
  const save = (
    patch: Partial<BrowserSettings> | ((current: BrowserSettings) => Partial<BrowserSettings>),
  ) =>
    void run(
      () =>
        browser.updateSettings(typeof patch === "function" ? patch(browser.getSettings()) : patch),
      text("saved"),
      false,
    );
  const changeDirectory = () => {
    if (!hostClient || disabled || directoryRequest.current) return;
    if (!shouldUseNativeDirectoryPicker(connection)) {
      setDirectoryOpen(true);
      return;
    }
    const request = new AbortController();
    directoryRequest.current = request;
    void run(async () => {
      try {
        if (request.signal.aborted) return;
        let path: string | undefined;
        try {
          path = await hostClient.pickDirectory({ signal: request.signal });
        } catch (cause) {
          if (request.signal.aborted) return;
          if (
            cause instanceof WorkbenchAgentCapabilityError &&
            (cause.code === "unavailable" || cause.code === "permission-denied")
          ) {
            setDirectoryOpen(true);
            return;
          }
          throw cause;
        }
        if (path && !request.signal.aborted) {
          await browser.updateSettings({ downloadDirectory: path });
          setNotice(text("saved"));
        }
      } finally {
        if (directoryRequest.current === request) directoryRequest.current = undefined;
      }
    }, "");
  };
  const options = <T extends PlainSettingsKey>(values: readonly T[]) =>
    values.map((value) => ({ value, label: text(value) }));
  const decisions = options(["allow", "ask", "deny"]);
  const permissionLabel = (permission: BrowserPermission) =>
    text(permission === "history" ? "historyPermission" : permission);
  const permissionDescription = (permission: BrowserPermission) =>
    text(permission === "history" ? "historyPermissionDescription" : `${permission}Description`);
  const toggle = (key: "showFullUrl" | "askDownloadLocation" | "siteTools" | "fullCdpAccess") => (
    <Switch
      aria-label={text(key)}
      aria-describedby={`${id}-${key}-description`}
      checked={settings[key]}
      disabled={disabled}
      onCheckedChange={(checked) => save({ [key]: checked })}
    />
  );
  const description = (
    key: "showFullUrl" | "askDownloadLocation" | "siteTools" | "fullCdpAccess",
  ) => <span id={`${id}-${key}-description`}>{text(`${key}Description`)}</span>;
  const group = (key: PlainSettingsKey, children: ReactNode, descriptionText?: string) => (
    <SettingsGroup
      title={text(key)}
      description={descriptionText}
      headerClassName="border-0"
      contentClassName="rounded-[var(--radius)] border border-border px-4"
    >
      {children}
    </SettingsGroup>
  );

  const openPage = async (page: BrowserPage) => {
    const existing = Object.values(surfaces).find(
      (surface) =>
        surface.kind === "browser" &&
        surface.params.settingsPage === page &&
        surface.scope.key === (context.threadId ?? context.applicationId),
    );
    const existingSession =
      existing && typeof existing.params.browserSessionId === "string"
        ? browser.getSession(existing.params.browserSessionId)
        : undefined;
    const session =
      existingSession ??
      (await browser.create({ projectId: context.projectId ?? context.applicationId }));
    await browser.command({ type: "open-page", sessionId: session.id, page });
    const current = browser.getSession(session.id) ?? session;
    controller.reveal({
      kind: "browser",
      title: current.title || defineMessage("extensions.workspaceBrowser.title"),
      params: { browserSessionId: current.id, url: current.url, settingsPage: page },
      context,
      status: "ready",
      policy: "force-focus",
    });
  };
  const manage = (page: BrowserPage, label: PlainSettingsKey = "manage") => (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      onClick={() => void run(() => openPage(page), "")}
    >
      {text(label)}
    </Button>
  );
  const importFile = async (file: File | undefined, kind: "cookies" | "passwords") => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("importTooLarge");
      return;
    }
    await run(async () => {
      const result = await browser.command<{ count: number }>({
        type: kind === "cookies" ? "cookies.import" : "passwords.import",
        data: await file.text(),
      });
      setImportOpen(false);
      setNotice(
        t("extensions.workspaceBrowser.settings.importSuccess", {
          count: result.count,
        }),
      );
    }, "");
  };
  const saveSite = () => {
    if (!site) return;
    let origin: string;
    try {
      const url = new URL(site.origin);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error();
      origin = url.origin;
    } catch {
      setSiteError("invalidOrigin");
      return;
    }
    if (
      settings.sites.some((entry) => entry.origin === origin && entry.origin !== originalOrigin)
    ) {
      setSiteError("duplicateOrigin");
      return;
    }
    void run(async () => {
      await browser.updateSettings({
        sites: [
          ...browser.getSettings().sites.filter((entry) => entry.origin !== originalOrigin),
          { ...site, origin },
        ],
      });
      setSite(undefined);
    });
  };

  return (
    <div
      className="min-w-0 space-y-6 @container/browser-settings"
      aria-busy={pending || (!loaded && !error)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          role={error ? "alert" : "status"}
          className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {error ? text(error) : !loaded ? text("loading") : pending ? text("saving") : notice}
        </p>
        {error === "loadError" ? (
          <Button
            variant="outline"
            disabled={actionPending}
            onClick={() =>
              void run(async () => {
                await browser.loadSettings();
                setLoaded(true);
              }, "")
            }
          >
            {text("retry")}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={disabled} onClick={() => setImportOpen(true)}>
          {text("import")}
        </Button>
      </div>
      {group(
        "general",
        <>
          {(["webLinks", "localLinks"] as const).map((key) => (
            <Row key={key} label={text(key)} description={text(`${key}Description`)}>
              <Choice
                label={text(key)}
                value={settings[key]}
                options={options(["external", "embedded"])}
                disabled={disabled}
                onChange={(value) => save({ [key]: value })}
              />
            </Row>
          ))}
          <Row label={text("showFullUrl")} description={description("showFullUrl")}>
            {toggle("showFullUrl")}
          </Row>
          <Row label={text("defaultZoom")} description={text("defaultZoomDescription")}>
            <Choice
              label={text("defaultZoom")}
              value={String(settings.defaultZoom)}
              options={[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((value) => ({
                value: String(value),
                label: new Intl.NumberFormat(locale, { style: "percent" }).format(value),
              }))}
              disabled={disabled}
              onChange={(value) => save({ defaultZoom: Number(value) })}
            />
          </Row>
          <Row label={text("browsingData")} description={text("browsingDataDescription")}>
            {manage("clear-data", "clearData")}
          </Row>
          <Row label={text("history")} description={text("historyDescription")}>
            {manage("history")}
          </Row>
          <Row
            label={text("annotationScreenshots")}
            description={text("annotationScreenshotsDescription")}
          >
            <Choice
              label={text("annotationScreenshots")}
              value={settings.annotationScreenshots}
              options={options(["always", "ask", "never"])}
              disabled={disabled}
              onChange={(value) => save({ annotationScreenshots: value })}
            />
          </Row>
        </>,
      )}
      {group(
        "autofill",
        <>
          <Row label={text("passwords")} description={text("passwordsDescription")}>
            {manage("passwords")}
          </Row>
          <Row label={text("contacts")} description={text("contactsDescription")}>
            {manage("contacts")}
          </Row>
        </>,
      )}
      {group(
        "downloads",
        <>
          <Row
            label={text("downloadDirectory")}
            description={
              <>
                <span className="break-all">
                  {settings.downloadDirectory || text("downloadDirectoryDefault")}
                </span>
                <p>{text("downloadDirectoryDescription")}</p>
              </>
            }
          >
            <Button
              variant="secondary"
              disabled={disabled || !hostClient}
              onClick={changeDirectory}
            >
              {text("change")}
            </Button>
          </Row>
          <Row label={text("askDownloadLocation")} description={description("askDownloadLocation")}>
            {toggle("askDownloadLocation")}
          </Row>
          <Row label={text("downloadHistory")} description={text("downloadHistoryDescription")}>
            <Button variant="secondary" disabled={disabled} onClick={() => setDownloadsOpen(true)}>
              {text("manage")}
            </Button>
          </Row>
        </>,
      )}
      {group(
        "permissions",
        <>
          <Row label={text("siteSettings")} description={text("siteSettingsDescription")}>
            {manage("site-settings")}
          </Row>
          {PERMISSIONS.map((permission) => (
            <Row
              key={permission}
              label={permissionLabel(permission)}
              description={permissionDescription(permission)}
            >
              <Choice
                label={permissionLabel(permission)}
                value={settings.permissions[permission]}
                options={decisions}
                disabled={disabled}
                onChange={(value) =>
                  save((current) => ({
                    permissions: { ...current.permissions, [permission]: value },
                  }))
                }
              />
            </Row>
          ))}
          <Row label={text("siteTools")} description={description("siteTools")}>
            {toggle("siteTools")}
          </Row>
        </>,
      )}
      {group(
        "sites",
        <>
          <Row label={text("sitesDescription")}>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                setSite({ origin: "" });
                setOriginalOrigin(undefined);
                setSiteError(undefined);
              }}
            >
              <PlusIcon />
              {text("addSite")}
            </Button>
          </Row>
          {settings.sites.length ? (
            settings.sites.map((entry) => (
              <Row key={entry.origin} label={<span className="break-all">{entry.origin}</span>}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    aria-label={t("extensions.workspaceBrowser.settings.editSiteFor", {
                      origin: entry.origin,
                    })}
                    onClick={() => {
                      setSite({ ...entry, permissions: { ...entry.permissions } });
                      setOriginalOrigin(entry.origin);
                      setSiteError(undefined);
                    }}
                  >
                    {text("edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t("extensions.workspaceBrowser.settings.removeSiteFor", {
                      origin: entry.origin,
                    })}
                    onClick={() =>
                      save((current) => ({
                        sites: current.sites.filter((item) => item.origin !== entry.origin),
                      }))
                    }
                  >
                    {text("remove")}
                  </Button>
                </div>
              </Row>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{text("noSites")}</p>
          )}
        </>,
      )}
      {group(
        "developer",
        <Row
          label={
            <>
              <span className="mb-2 flex items-center gap-2 text-warning-foreground">
                <ShieldAlertIcon className="size-[var(--icon-size-md)]" />
                {text("risk")}
              </span>
              {text("fullCdpAccess")}
            </>
          }
          description={description("fullCdpAccess")}
        >
          {toggle("fullCdpAccess")}
        </Row>,
      )}
      <BrowserDownloadsDialog open={downloadsOpen} onOpenChange={setDownloadsOpen} />
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!actionPending) setImportOpen(open);
        }}
      >
        <DialogContent closeLabel={text("close")}>
          <DialogTitle>{text("importTitle")}</DialogTitle>
          <DialogDescription>{text("importDescription")}</DialogDescription>
          {(["cookies", "passwords"] as const).map((kind) => (
            <SettingsField
              key={kind}
              label={
                <label htmlFor={`${id}-import-${kind}`}>
                  {text(kind === "cookies" ? "importCookies" : "importPasswords")}
                </label>
              }
            >
              <Input
                id={`${id}-import-${kind}`}
                type="file"
                disabled={disabled}
                accept={kind === "cookies" ? ".json,application/json" : ".csv,text/csv"}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void importFile(file, kind);
                }}
              />
            </SettingsField>
          ))}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {text(error)}
            </p>
          ) : null}
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                await openPage("import");
                setImportOpen(false);
              }, "")
            }
          >
            {text("importNative")}
          </Button>
        </DialogContent>
      </Dialog>
      {directoryOpen && hostClient ? (
        <RemoteDirectoryPickerDialog
          hostClient={hostClient}
          open
          initialPath={settings.downloadDirectory || undefined}
          onOpenChange={setDirectoryOpen}
          onSelectPath={async (downloadDirectory) => {
            await queue.current;
            await browser.updateSettings({ downloadDirectory });
            setNotice(text("saved"));
          }}
          copy={{
            title: text("downloadDirectory"),
            description: text("downloadDirectoryDescription"),
            path: text("downloadDirectory"),
            pathPlaceholder: text("downloadDirectoryPlaceholder"),
            select: text("save"),
            close: text("close"),
            selectError: text("actionError"),
          }}
        />
      ) : null}
      <Dialog
        open={site !== undefined}
        onOpenChange={(open) => {
          if (!open && !actionPending) setSite(undefined);
        }}
      >
        <DialogContent
          closeLabel={text("close")}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogTitle>{text(originalOrigin ? "editSite" : "addSite")}</DialogTitle>
          <DialogDescription>{text("sitesDescription")}</DialogDescription>
          {site ? (
            <form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault();
                saveSite();
              }}
            >
              <SettingsField
                label={<label htmlFor={`${id}-origin`}>{text("origin")}</label>}
                description={text("originDescription")}
                error={
                  siteError ? <span id={`${id}-origin-error`}>{text(siteError)}</span> : undefined
                }
              >
                <Input
                  id={`${id}-origin`}
                  type="url"
                  required
                  value={site.origin}
                  disabled={disabled}
                  placeholder={text("originPlaceholder")}
                  aria-invalid={Boolean(siteError)}
                  aria-describedby={siteError ? `${id}-origin-error` : undefined}
                  onChange={(event) => {
                    setSite({ ...site, origin: event.currentTarget.value });
                    setSiteError(undefined);
                  }}
                />
              </SettingsField>
              {PERMISSIONS.map((permission) => (
                <SettingsField key={permission} label={permissionLabel(permission)}>
                  <Choice
                    label={permissionLabel(permission)}
                    value={site.permissions?.[permission] ?? "inherit"}
                    options={[...options(["inherit"]), ...decisions]}
                    disabled={disabled}
                    onChange={(value) => {
                      const permissions = { ...site.permissions };
                      if (value === "inherit") delete permissions[permission];
                      else permissions[permission] = value;
                      setSite({ ...site, permissions });
                    }}
                  />
                </SettingsField>
              ))}
              <SettingsField label={text("siteTools")}>
                <Choice
                  label={text("siteTools")}
                  value={
                    site.siteTools === undefined
                      ? "inherit"
                      : site.siteTools
                        ? "enabled"
                        : "disabled"
                  }
                  options={options(["inherit", "enabled", "disabled"])}
                  disabled={disabled}
                  onChange={(value) => {
                    const next = { ...site };
                    if (value === "inherit") delete next.siteTools;
                    else next.siteTools = value === "enabled";
                    setSite(next);
                  }}
                />
              </SettingsField>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {text(error)}
                </p>
              ) : null}
              <DialogFooter closeLabel={text("cancel")}>
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionPending}
                  onClick={() => setSite(undefined)}
                >
                  {text("cancel")}
                </Button>
                <Button type="submit" disabled={disabled}>
                  {text("save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
