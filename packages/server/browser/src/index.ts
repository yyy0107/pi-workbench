/* eslint-disable no-control-regex -- Browser file names must exclude ASCII control characters. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  BROWSER_PAGES,
  parseBrowserCommand,
  type BrowserCommand,
  type BrowserDownload,
  type BrowserEvent,
  type BrowserFile,
  type BrowserPermission,
  type BrowserSessionState,
  type BrowserSettings,
} from "@workbench/browser-contracts";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";

import { BrowserCdp, launchBrowser, type CdpEvent } from "./cdp";
import { BrowserError } from "./errors";
import { parseCookieJson, parsePasswordCsv } from "./imports";
import { BrowserSettingsStore } from "./settings";

export { BrowserError } from "./errors";

type Source = "user" | "agent";
interface Tab {
  state: BrowserSessionState;
  targetId: string;
  cdpSessionId: string;
  frameId?: string;
  frameIds: Set<string>;
  visible: boolean;
  screencasting: boolean;
  source: Source;
  signal?: AbortSignal;
  allowedNavigation?: string;
  fileRequests: Map<string, { nodeId: number; multiple: boolean }>;
  uploadDirectories: Set<string>;
  viewportOperation: Promise<void>;
  dialogPending: boolean;
  navigationBlocked: boolean;
  allowedDownloads: Set<string>;
  popupUrls: string[];
  viewport: { width: number; height: number };
}
interface DownloadRecord {
  download: BrowserDownload;
  sessionId?: string;
  path: string;
}

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TABS = 32;
const MAIN_FRAME_SCHEMES = new Set(["http:", "https:", "about:", "chrome:"]);

export function normalizeBrowserUrl(value: string, internal = false): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (internal && Object.values(BROWSER_PAGES).includes(trimmed)) return trimmed;
  const hostWithPort = /^(?:localhost|[^/:?#]+\.[^/:?#]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(
    trimmed,
  );
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !hostWithPort;
  try {
    let url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
    if (
      !hasScheme &&
      (url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        /^127(?:\.\d{1,3}){3}$/.test(url.hostname) ||
        url.hostname === "[::1]")
    ) {
      url = new URL(`http://${trimmed}`);
    }
    return url.href;
  } catch {
    throw new BrowserError("browser-invalid");
  }
}

function fileName(value: string): string {
  const sanitized = path
    .basename(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 200);
  return sanitized && !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(sanitized)
    ? sanitized
    : "download";
}

export class BrowserManager {
  private readonly directory: string;
  private readonly settings: BrowserSettingsStore;
  private readonly tabs = new Map<string, Tab>();
  private readonly listeners = new Set<(event: BrowserEvent) => void>();
  private readonly downloads = new Map<string, DownloadRecord>();
  private readonly permissions = new Map<
    string,
    {
      resolve(allow: boolean): void;
      timer: ReturnType<typeof setTimeout>;
      sessionId: string;
    }
  >();
  private browser?: BrowserCdp;
  private starting?: Promise<BrowserCdp>;
  private disposed = false;
  private passwordTarget?: Promise<{ targetId: string; sessionId: string }>;
  private passwordImports: Promise<unknown> = Promise.resolve();
  private defaultUserAgent = "";
  private downloadDirectory = "";
  private downloadsLoaded: Promise<void>;
  private downloadWrites: Promise<void> = Promise.resolve();

  constructor(options: { stateDirectory?: string } = {}) {
    this.directory = options.stateDirectory
      ? path.resolve(options.stateDirectory)
      : path.join(
          process.env.PI_WORKBENCH_STATE_DIR?.trim() || path.join(homedir(), ".pi/workbench"),
          "browser",
        );
    this.settings = new BrowserSettingsStore(path.join(this.directory, "settings.json"));
    this.downloadsLoaded = this.restoreDownloads();
  }

  subscribe(listener: (event: BrowserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: BrowserEvent): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* A detached client must not break other tabs. */
      }
    }
  }

  private update(tab: Tab, patch: Partial<BrowserSessionState>): BrowserSessionState {
    tab.state = { ...tab.state, ...patch, revision: tab.state.revision + 1 };
    this.publish({ type: "state", session: { ...tab.state } });
    return { ...tab.state };
  }

  private async connection(): Promise<BrowserCdp> {
    if (this.disposed) throw new BrowserError("browser-unavailable");
    if (this.browser) return this.browser;
    this.starting ??= (async () => {
      const cdp = await launchBrowser(path.join(this.directory, "profile"), () => {
        this.browser = undefined;
        this.starting = undefined;
        this.passwordTarget = undefined;
        for (const tab of this.tabs.values()) {
          tab.targetId = "";
          tab.cdpSessionId = "";
          tab.screencasting = false;
          this.update(tab, { status: "disconnected", error: "browser-unavailable" });
        }
      });
      if (this.disposed) {
        cdp.dispose();
        throw new BrowserError("browser-unavailable");
      }
      this.browser = cdp;
      const version = await cdp.send("Browser.getVersion");
      this.defaultUserAgent = version.userAgent;
      cdp.subscribe((event) => {
        void this.onEvent(event).catch((error) =>
          this.publish({
            type: "error",
            code: error instanceof BrowserError ? error.code : "browser-operation-failed",
          }),
        );
      });
      await cdp.send("Target.setDiscoverTargets", { discover: true });
      await cdp.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: "page" }],
      });
      await this.configureDownloads(await this.settings.get());
      return cdp;
    })().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async send<T = Record<string, any>>(
    tab: Tab,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return (await this.connection()).send<T>(method, params, tab.cdpSessionId);
  }

  private async evaluate(tab: Tab, expression: string): Promise<any> {
    const response = await this.send(tab, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new BrowserError("browser-operation-failed");
    return response.result?.value;
  }

  private async authorize(
    action: BrowserPermission,
    url: string,
    sessionId: string,
    source: Source,
    actionSignal?: AbortSignal,
  ): Promise<void> {
    if (source === "user") return;
    const signal = actionSignal ?? this.tabs.get(sessionId)?.signal;
    signal?.throwIfAborted();
    const settings = await this.settings.get();
    signal?.throwIfAborted();
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      throw new BrowserError("browser-invalid");
    }
    const site = settings.sites.find((candidate) => candidate.origin === origin);
    const decision = site?.permissions?.[action] ?? settings.permissions[action];
    if (decision === "allow") return;
    if (decision === "deny") throw new BrowserError("browser-permission-denied");
    if (this.permissions.size >= 32) throw new BrowserError("browser-permission-denied");
    const requestId = randomUUID();
    let abort: (() => void) | undefined;
    const allowed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.permissions.delete(requestId);
        resolve(false);
      }, 120_000);
      timer.unref();
      this.permissions.set(requestId, { resolve, timer, sessionId });
      abort = () => {
        clearTimeout(timer);
        this.permissions.delete(requestId);
        resolve(false);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      this.publish({ type: "permission", requestId, sessionId, origin, action });
    }).finally(() => {
      if (abort) signal?.removeEventListener("abort", abort);
    });
    signal?.throwIfAborted();
    if (!allowed) throw new BrowserError("browser-permission-denied");
  }

  private async createTab(
    sessionId: string,
    projectId: string,
    url: string,
    source: Source,
    signal?: AbortSignal,
  ): Promise<Tab> {
    if (this.tabs.size >= MAX_TABS) throw new BrowserError("browser-operation-failed");
    const settings = await this.settings.get();
    const tab: Tab = {
      state: {
        id: sessionId,
        projectId,
        url: "about:blank",
        title: "about:blank",
        status: "ready",
        canGoBack: false,
        canGoForward: false,
        revision: 0,
        zoom: settings.defaultZoom,
        fitToWidth: settings.fitToWidth,
        width: 1024,
        height: 768,
      },
      targetId: "",
      cdpSessionId: "",
      visible: false,
      screencasting: false,
      source,
      signal,
      frameIds: new Set(),
      fileRequests: new Map(),
      uploadDirectories: new Set(),
      viewportOperation: Promise.resolve(),
      dialogPending: false,
      navigationBlocked: false,
      allowedDownloads: new Set(),
      popupUrls: [],
      viewport: { width: 1024, height: 768 },
    };
    this.tabs.set(sessionId, tab);
    try {
      await this.connectTab(tab);
      if (url !== "about:blank") await this.navigate(tab, url, source);
      else this.update(tab, {});
      return tab;
    } catch (error) {
      this.tabs.delete(sessionId);
      if (tab.targetId)
        void this.browser
          ?.send("Target.closeTarget", { targetId: tab.targetId })
          .catch(() => undefined);
      throw error;
    }
  }

  private async connectTab(tab: Tab): Promise<void> {
    const cdp = await this.connection();
    if (tab.cdpSessionId) return;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    tab.targetId = targetId;
    tab.cdpSessionId = sessionId;
    await Promise.all([
      this.send(tab, "Page.enable"),
      this.send(tab, "Runtime.enable"),
      this.send(tab, "Page.setInterceptFileChooserDialog", { enabled: true }),
      this.send(tab, "Fetch.enable", {
        patterns: [
          { resourceType: "Document", requestStage: "Request" },
          { requestStage: "Response" },
        ],
      }),
    ]);
    const { frameTree } = await this.send(tab, "Page.getFrameTree");
    tab.frameId = frameTree.frame.id;
    tab.frameIds.add(frameTree.frame.id);
    await this.applyViewport(tab);
  }

  private async requireTab(id: string): Promise<Tab> {
    const tab = this.tabs.get(id);
    if (!tab) throw new BrowserError("browser-session-missing");
    if (!tab.cdpSessionId) {
      await this.connectTab(tab);
      if (tab.state.url !== "about:blank") await this.navigate(tab, tab.state.url, "user", true);
    }
    return tab;
  }

  private async navigate(
    tab: Tab,
    value: string,
    source: Source,
    internal = false,
  ): Promise<BrowserSessionState> {
    const url = normalizeBrowserUrl(value, internal);
    await this.authorize("navigate", url, tab.state.id, source);
    if (source === "agent") tab.signal?.throwIfAborted();
    tab.source = source;
    if (source === "user") tab.signal = undefined;
    tab.navigationBlocked = false;
    tab.allowedNavigation = url;
    this.update(tab, { status: "loading", error: undefined });
    const result = await this.send(tab, "Page.navigate", { url });
    if (result.errorText) {
      if (tab.navigationBlocked) throw new BrowserError("browser-permission-denied");
      // Chrome reports an aborted navigation when it hands a response to downloads.
      if (result.errorText === "net::ERR_ABORTED")
        return this.update(tab, { status: "ready", error: undefined });
      this.update(tab, { status: "error", error: "browser-operation-failed" });
      throw new BrowserError("browser-operation-failed");
    }
    return this.update(tab, { url, title: url });
  }

  private async history(tab: Tab): Promise<void> {
    const result = await this.send(tab, "Page.getNavigationHistory");
    const entry = result.entries[result.currentIndex];
    if (this.tabs.get(tab.state.id) !== tab) return;
    this.update(tab, {
      canGoBack: result.currentIndex > 0,
      canGoForward: result.currentIndex < result.entries.length - 1,
      ...(entry ? { url: entry.url, title: entry.title || entry.url } : {}),
    });
  }

  private async applyViewport(tab: Tab): Promise<void> {
    const { width, height, zoom, device, fitToWidth } = tab.state;
    if (tab.screencasting) {
      await this.send(tab, "Page.stopScreencast");
      tab.screencasting = false;
    }
    let logicalWidth = Math.min(16384, Math.max(1, Math.round((device?.width ?? width) / zoom)));
    let logicalHeight = Math.min(16384, Math.max(1, Math.round((device?.height ?? height) / zoom)));
    const metrics = () =>
      this.send(tab, "Emulation.setDeviceMetricsOverride", {
        width: logicalWidth,
        height: logicalHeight,
        deviceScaleFactor: 1,
        mobile: device?.mobile ?? false,
      });
    await metrics();
    if (fitToWidth && !device && tab.state.url !== "about:blank") {
      const scrollWidth = await this.evaluate(
        tab,
        "Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0)",
      );
      if (typeof scrollWidth === "number" && scrollWidth > logicalWidth && scrollWidth <= 16384) {
        logicalWidth = Math.ceil(scrollWidth);
        logicalHeight = Math.min(16384, Math.max(1, Math.round((height * logicalWidth) / width)));
        await metrics();
      }
    }
    tab.viewport = { width: logicalWidth, height: logicalHeight };
    await this.send(tab, "Emulation.setTouchEmulationEnabled", {
      enabled: device?.mobile ?? false,
    });
    await this.send(tab, "Emulation.setUserAgentOverride", {
      userAgent: device?.mobile
        ? `Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${/Chrome\/([\d.]+)/.exec(this.defaultUserAgent)?.[1] ?? "150.0.0.0"} Mobile Safari/537.36`
        : this.defaultUserAgent,
    });
    if (tab.visible && !tab.screencasting) {
      tab.screencasting = true;
      try {
        await this.send(tab, "Page.bringToFront");
        await this.send(tab, "Page.startScreencast", {
          format: "jpeg",
          quality: 85,
          maxWidth: Math.min(width, 3840),
          maxHeight: Math.min(height, 3840),
          everyNthFrame: 1,
        });
      } catch (error) {
        tab.screencasting = false;
        throw error;
      }
    } else if (!tab.visible && tab.screencasting) {
      await this.send(tab, "Page.stopScreencast");
      tab.screencasting = false;
    }
  }

  private queueViewport(tab: Tab): Promise<void> {
    const operation = tab.viewportOperation
      .catch(() => undefined)
      .then(() => this.applyViewport(tab));
    tab.viewportOperation = operation;
    return operation;
  }

  private async onEvent(event: CdpEvent): Promise<void> {
    if (this.disposed) return;
    const { method, params } = event;
    if (method === "Browser.downloadWillBegin") {
      await this.downloadStarted(params);
      return;
    }
    if (method === "Browser.downloadProgress") {
      await this.downloadProgress(params);
      return;
    }
    if (method === "Target.attachedToTarget" && params.targetInfo?.type === "page") {
      const opener = [...this.tabs.values()].find(
        (candidate) => candidate.targetId === params.targetInfo.openerId,
      );
      if (opener) {
        const url = opener.popupUrls.shift() || params.targetInfo.url;
        // Keep the new document paused until its URL has passed the same navigation gate.
        await this.browser?.send("Target.closeTarget", { targetId: params.targetInfo.targetId });
        if (url && url !== "about:blank") await this.navigate(opener, url, opener.source);
      } else if (params.waitingForDebugger) {
        await this.browser?.send("Runtime.runIfWaitingForDebugger", {}, params.sessionId);
      }
      return;
    }
    if (method === "Target.targetInfoChanged") {
      const tab = [...this.tabs.values()].find(
        (candidate) => candidate.targetId === params.targetInfo?.targetId,
      );
      if (tab) this.update(tab, { title: params.targetInfo.title || tab.state.url });
      return;
    }
    if (method === "Target.targetDestroyed") {
      const tab = [...this.tabs.values()].find(
        (candidate) => candidate.targetId === params.targetId,
      );
      if (tab) {
        tab.targetId = "";
        tab.cdpSessionId = "";
        tab.screencasting = false;
        this.update(tab, { status: "disconnected" });
      }
      return;
    }
    const tab = [...this.tabs.values()].find(
      (candidate) => candidate.cdpSessionId === event.sessionId,
    );
    if (!tab) return;
    if (method === "Page.screencastFrame") {
      try {
        if (tab.visible && typeof params.data === "string") {
          const { deviceWidth, deviceHeight, pageScaleFactor } = params.metadata ?? {};
          if (deviceWidth > 0 && deviceHeight > 0 && pageScaleFactor > 0) {
            // Input uses CSS coordinates; JPEG pixels can be scaled for fit/device streaming.
            this.publish({
              type: "frame",
              sessionId: tab.state.id,
              data: params.data,
              width: deviceWidth / pageScaleFactor,
              height: deviceHeight / pageScaleFactor,
            });
          }
        }
      } finally {
        await this.send(tab, "Page.screencastFrameAck", { sessionId: params.sessionId });
      }
    } else if (method === "Page.windowOpen") {
      if (typeof params.url === "string") tab.popupUrls.push(params.url);
      if (tab.popupUrls.length > 16) tab.popupUrls.shift();
    } else if (method === "Page.frameAttached") {
      tab.frameIds.add(params.frameId);
    } else if (method === "Page.frameDetached") {
      tab.frameIds.delete(params.frameId);
    } else if (method === "Page.frameNavigated" && !params.frame?.parentId) {
      tab.frameId = params.frame.id;
      tab.frameIds.add(params.frame.id);
      tab.fileRequests.clear();
      this.update(tab, { url: params.frame.url, title: params.frame.url });
      await this.history(tab);
    } else if (method === "Page.navigatedWithinDocument" && params.frameId === tab.frameId) {
      this.update(tab, { url: params.url });
      await this.history(tab);
    } else if (method === "Page.frameStartedLoading" && params.frameId === tab.frameId) {
      if (!tab.navigationBlocked) this.update(tab, { status: "loading", error: undefined });
    } else if (method === "Page.frameStoppedLoading" && params.frameId === tab.frameId) {
      if (!tab.navigationBlocked) this.update(tab, { status: "ready", error: undefined });
      await this.history(tab);
      await this.queueViewport(tab);
    } else if (method === "Inspector.targetCrashed") {
      this.update(tab, { status: "error", error: "browser-operation-failed" });
    } else if (method === "Fetch.requestPaused") {
      await this.interceptNavigation(tab, params);
    } else if (method === "Page.fileChooserOpened") {
      if (!Number.isInteger(params.backendNodeId))
        throw new BrowserError("browser-operation-failed");
      await this.authorize("upload", tab.state.url, tab.state.id, tab.source);
      const requestId = randomUUID();
      tab.fileRequests.set(requestId, {
        nodeId: params.backendNodeId,
        multiple: params.mode === "selectMultiple",
      });
      this.publish({
        type: "file-chooser",
        sessionId: tab.state.id,
        requestId,
        multiple: params.mode === "selectMultiple",
      });
    } else if (method === "Page.javascriptDialogOpening") {
      tab.dialogPending = true;
      this.publish({
        type: "dialog",
        sessionId: tab.state.id,
        kind: params.type,
        message: String(params.message).slice(0, 65536),
        defaultPrompt: params.defaultPrompt,
        url: typeof params.url === "string" ? params.url : undefined,
      });
    } else if (method === "Page.javascriptDialogClosed") {
      tab.dialogPending = false;
    }
  }

  private async interceptNavigation(tab: Tab, params: Record<string, any>): Promise<void> {
    try {
      if (params.responseStatusCode) {
        const attachment = params.responseHeaders?.some(
          (header: Record<string, string>) =>
            header.name?.toLowerCase() === "content-disposition" &&
            /^attachment(?:;|$)/i.test(header.value ?? ""),
        );
        if (attachment && tab.source === "agent") {
          await this.authorize("download", params.request.url, tab.state.id, tab.source);
          tab.allowedDownloads.add(params.request.url);
        }
        await this.send(tab, "Fetch.continueRequest", { requestId: params.requestId });
        return;
      }
      const url = new URL(params.request.url);
      if (
        !MAIN_FRAME_SCHEMES.has(url.protocol) ||
        (url.protocol === "about:" && url.href !== "about:blank")
      ) {
        throw new BrowserError("browser-permission-denied");
      }
      if (params.frameId === tab.frameId) {
        if (
          tab.source === "agent" &&
          url.protocol === "chrome:" &&
          ![BROWSER_PAGES.history, BROWSER_PAGES.downloads].includes(url.href)
        )
          throw new BrowserError("browser-permission-denied");
        if (tab.allowedNavigation === url.href) tab.allowedNavigation = undefined;
        else await this.authorize("navigate", url.href, tab.state.id, tab.source);
      }
      await this.send(tab, "Fetch.continueRequest", { requestId: params.requestId });
    } catch (error) {
      await this.send(tab, "Fetch.failRequest", {
        requestId: params.requestId,
        errorReason: "BlockedByClient",
      }).catch(() => undefined);
      if (params.frameId === tab.frameId) {
        tab.navigationBlocked = true;
        this.update(tab, { status: "permission-required", error: "browser-permission-denied" });
      }
      if (!(error instanceof BrowserError)) throw error;
    }
  }

  async handle(
    value: BrowserCommand,
    options: { source?: Source; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (this.disposed) throw new BrowserError("browser-unavailable");
    const command = parseBrowserCommand(value);
    if (!command) throw new BrowserError("browser-invalid");
    const source = options.source ?? "user";
    if (
      source !== "user" &&
      [
        "settings.update",
        "permission.respond",
        "cookies.import",
        "passwords.import",
        "downloads.clear",
      ].includes(command.type)
    ) {
      throw new BrowserError("browser-permission-denied");
    }
    try {
      options.signal?.throwIfAborted();
      return await this.execute(command, source, options.signal);
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("browser-operation-failed");
    }
  }

  private async execute(
    command: BrowserCommand,
    source: Source,
    signal?: AbortSignal,
  ): Promise<unknown> {
    switch (command.type) {
      case "settings.get":
        return this.settings.get();
      case "settings.update": {
        const settings = await this.settings.update(command.patch);
        if (this.browser) await this.configureDownloads(settings);
        this.publish({ type: "settings", settings });
        return settings;
      }
      case "permission.respond": {
        const pending = this.permissions.get(command.requestId);
        if (!pending) throw new BrowserError("browser-invalid");
        this.permissions.delete(command.requestId);
        clearTimeout(pending.timer);
        pending.resolve(command.allow);
        return;
      }
      case "cookies.import": {
        const cookies = parseCookieJson(command.data);
        await (await this.connection()).send("Storage.setCookies", { cookies });
        return { count: cookies.length };
      }
      case "passwords.import":
        return this.importPasswords(command.data);
      case "downloads.clear": {
        await this.downloadsLoaded;
        for (const [id, record] of this.downloads) {
          if (record.download.state !== "inProgress") this.downloads.delete(id);
        }
        await this.persistDownloads();
        return [...this.downloads.values()].map(({ download }) => ({ ...download }));
      }
      case "downloads.list": {
        await this.downloadsLoaded;
        await this.authorize("history", "about:blank", "", source, signal);
        return [...this.downloads.values()].map(({ download }) => ({ ...download }));
      }
      case "download.read": {
        await this.downloadsLoaded;
        const entry = this.downloads.get(command.downloadId);
        if (!entry || entry.download.state !== "completed")
          throw new BrowserError("browser-invalid");
        await this.authorize("download", entry.download.url, entry.sessionId ?? "", source, signal);
        return this.readDownload(entry);
      }
      case "download.cancel": {
        const entry = this.downloads.get(command.downloadId);
        if (!entry) throw new BrowserError("browser-invalid");
        await this.authorize("download", entry.download.url, entry.sessionId ?? "", source, signal);
        await (
          await this.connection()
        ).send("Browser.cancelDownload", { guid: command.downloadId });
        return;
      }
      case "attach": {
        const existing = this.tabs.get(command.sessionId);
        if (existing && source === "agent") existing.signal = signal;
        if (existing && existing.state.projectId !== command.projectId)
          throw new BrowserError("browser-invalid");
        const tab = existing
          ? await this.requireTab(command.sessionId)
          : await this.createTab(
              command.sessionId,
              command.projectId,
              normalizeBrowserUrl(command.url ?? "about:blank"),
              source,
              signal,
            );
        if (existing && source === "agent")
          await this.authorize("navigate", tab.state.url, tab.state.id, source);
        this.publish({ type: "state", session: { ...tab.state } });
        return { ...tab.state };
      }
    }
    if (command.type === "close" && !this.tabs.has(command.sessionId)) return;
    const tab = await this.requireTab(command.sessionId);
    if (source === "agent") tab.signal = signal;
    signal?.throwIfAborted();
    if (source === "agent" && command.type !== "cdp" && tab.state.url.startsWith("chrome:")) {
      if (![BROWSER_PAGES.history, BROWSER_PAGES.downloads].includes(tab.state.url))
        throw new BrowserError("browser-permission-denied");
      await this.authorize("history", tab.state.url, tab.state.id, source);
    }
    if (["copy", "find", "screenshot", "print", "site-tools.list"].includes(command.type))
      await this.authorize("navigate", tab.state.url, tab.state.id, source);
    switch (command.type) {
      case "navigate":
        return this.navigate(tab, command.url, source);
      case "open-page": {
        if (source === "agent" && !["history", "downloads"].includes(command.page))
          throw new BrowserError("browser-permission-denied");
        if (command.page === "history" || command.page === "downloads")
          await this.authorize("history", tab.state.url, tab.state.id, source);
        return this.navigate(tab, BROWSER_PAGES[command.page], source, true);
      }
      case "back":
      case "forward": {
        await this.authorize("history", tab.state.url, tab.state.id, source);
        const result = await this.send(tab, "Page.getNavigationHistory");
        const entry = result.entries[result.currentIndex + (command.type === "back" ? -1 : 1)];
        if (entry) {
          if (
            source === "agent" &&
            entry.url.startsWith("chrome:") &&
            ![BROWSER_PAGES.history, BROWSER_PAGES.downloads].includes(entry.url)
          )
            throw new BrowserError("browser-permission-denied");
          await this.authorize("navigate", entry.url, tab.state.id, source);
          tab.source = source;
          if (source === "user") tab.signal = undefined;
          tab.navigationBlocked = false;
          tab.allowedNavigation = entry.url;
          await this.send(tab, "Page.navigateToHistoryEntry", { entryId: entry.id });
        }
        return { ...tab.state };
      }
      case "reload": {
        await this.authorize("navigate", tab.state.url, tab.state.id, source);
        tab.source = source;
        tab.navigationBlocked = false;
        tab.allowedNavigation = tab.state.url;
        await this.send(tab, "Page.reload");
        return this.update(tab, { status: "loading", error: undefined });
      }
      case "stop":
        await this.send(tab, "Page.stopLoading");
        return this.update(tab, { status: "ready" });
      case "close":
        await this.closeTab(tab);
        return;
      case "viewport": {
        tab.visible = command.visible;
        this.update(tab, {
          width: Math.round(command.width),
          height: Math.round(command.height),
          ...(command.zoom === undefined ? {} : { zoom: command.zoom }),
          ...(command.fitToWidth === undefined ? {} : { fitToWidth: command.fitToWidth }),
          ...(command.device === undefined ? {} : { device: command.device ?? undefined }),
        });
        await this.queueViewport(tab);
        return { ...tab.state };
      }
      case "input": {
        const input = command.event;
        if (
          input.kind === "text" ||
          (input.kind === "key" && input.type === "keyDown") ||
          (input.kind === "mouse" && input.type === "mousePressed")
        ) {
          await this.authorize("navigate", tab.state.url, tab.state.id, source);
          tab.source = source;
          if (source === "user") tab.signal = undefined;
          tab.navigationBlocked = false;
        }
        signal?.throwIfAborted();
        const { kind, ...event } = input;
        if (kind === "text") await this.send(tab, "Input.insertText", event);
        else if (kind === "key") await this.send(tab, "Input.dispatchKeyEvent", event);
        else await this.send(tab, "Input.dispatchMouseEvent", event);
        return;
      }
      case "copy": {
        const text = await this.evaluate(
          tab,
          "(() => { const element = document.activeElement; if (element?.type === 'password') return ''; if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.selectionStart !== null) return element.value.slice(element.selectionStart, element.selectionEnd); return window.getSelection()?.toString() || ''; })()",
        );
        return { text: typeof text === "string" ? text.slice(0, 65536) : "" };
      }
      case "find": {
        const found = await this.evaluate(
          tab,
          command.text
            ? `window.find(${JSON.stringify(command.text)}, ${command.matchCase === true}, ${command.backwards === true}, true, false, true, false)`
            : "(window.getSelection()?.removeAllRanges(), false)",
        );
        return { found: found === true };
      }
      case "screenshot":
        return this.capture(tab, command.fullPage === true);
      case "print": {
        const result = await this.send(tab, "Page.printToPDF", {
          printBackground: true,
          preferCSSPageSize: true,
        });
        return this.file(`${fileName(tab.state.title)}.pdf`, "application/pdf", result.data);
      }
      case "upload":
        await this.upload(tab, command, source);
        return;
      case "dialog.respond": {
        if (!tab.dialogPending) throw new BrowserError("browser-invalid");
        await this.send(tab, "Page.handleJavaScriptDialog", {
          accept: command.accept,
          ...(command.text === undefined ? {} : { promptText: command.text }),
        });
        return;
      }
      case "cdp": {
        if (!(await this.settings.get()).fullCdpAccess)
          throw new BrowserError("browser-permission-denied");
        await this.authorize("navigate", tab.state.url, tab.state.id, source);
        signal?.throwIfAborted();
        tab.source = source;
        return this.send(tab, command.method, command.params);
      }
      case "site-tools.list":
      case "site-tools.call": {
        const settings = await this.settings.get();
        const site = settings.sites.find(
          (candidate) => candidate.origin === new URL(tab.state.url).origin,
        );
        if (!(site?.siteTools ?? settings.siteTools))
          throw new BrowserError("browser-permission-denied");
        if (command.type === "site-tools.list")
          return await this.evaluate(
            tab,
            `(async () => { if (document.modelContext?.getTools) return (await document.modelContext.getTools()).map(tool => ({ name: tool.name, description: tool.description, inputSchema: typeof tool.inputSchema === "string" ? JSON.parse(tool.inputSchema) : tool.inputSchema })); return navigator.modelContextTesting?.listTools?.() ?? []; })()`,
          );
        await this.authorize("navigate", tab.state.url, tab.state.id, source);
        signal?.throwIfAborted();
        tab.source = source;
        return this.evaluate(
          tab,
          `(async () => { if (document.modelContext?.getTools) { const tool = (await document.modelContext.getTools()).find(tool => tool.name === ${JSON.stringify(command.name)}); if (!tool) throw new Error("unavailable"); return document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(command.arguments))}); } return navigator.modelContextTesting.executeTool(${JSON.stringify(command.name)}, ${JSON.stringify(JSON.stringify(command.arguments))}); })()`,
        );
      }
    }
  }

  private file(name: string, mimeType: string, data: unknown): BrowserFile {
    if (typeof data !== "string") throw new BrowserError("browser-operation-failed");
    if (Buffer.byteLength(data, "base64") > MAX_FILE_BYTES)
      throw new BrowserError("browser-file-too-large");
    return { name, mimeType, data };
  }

  private async capture(tab: Tab, fullPage: boolean): Promise<BrowserFile> {
    await tab.viewportOperation;
    const metrics = await this.send(tab, "Page.getLayoutMetrics");
    const pageScale = metrics.cssVisualViewport?.scale ?? metrics.visualViewport?.scale ?? 1;
    const viewport = {
      width: tab.viewport.width / pageScale,
      height: tab.viewport.height / pageScale,
    };
    let capture = viewport;
    let clip;
    if (fullPage) {
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (size.width > 16384 || size.height > 16384 || size.width * size.height > 50_000_000)
        throw new BrowserError("browser-file-too-large");
      clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
      capture = { width: size.width, height: size.height };
    }
    const result = await this.send(tab, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
      ...(clip ? { clip } : {}),
    });
    return {
      ...this.file(`${fileName(tab.state.title)}.png`, "image/png", result.data),
      viewport,
      capture,
    };
  }

  private async upload(
    tab: Tab,
    command: Extract<BrowserCommand, { type: "upload" }>,
    source: Source,
  ): Promise<void> {
    const request = tab.fileRequests.get(command.requestId);
    if (!request || (!request.multiple && command.files.length > 1))
      throw new BrowserError("browser-invalid");
    await this.authorize("upload", tab.state.url, tab.state.id, source);
    const directory = path.join(this.directory, "uploads", randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    tab.uploadDirectories.add(directory);
    let bytes = 0;
    const files: string[] = [];
    try {
      for (const [index, file] of command.files.entries()) {
        const buffer = Buffer.from(file.data, "base64");
        bytes += buffer.length;
        if (bytes > MAX_FILE_BYTES) throw new BrowserError("browser-file-too-large");
        const directoryForFile = path.join(directory, String(index));
        await mkdir(directoryForFile, { mode: 0o700 });
        const filePath = path.join(directoryForFile, fileName(file.name));
        await writeFile(filePath, buffer, { mode: 0o600, flag: "wx" });
        files.push(filePath);
      }
      if (source === "agent") tab.signal?.throwIfAborted();
      await this.send(tab, "DOM.setFileInputFiles", { files, backendNodeId: request.nodeId });
      tab.fileRequests.delete(command.requestId);
    } catch (error) {
      tab.uploadDirectories.delete(directory);
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async importPasswords(data: string): Promise<{ count: number }> {
    const passwords = parsePasswordCsv(data);
    const operation = this.passwordImports
      .catch(() => undefined)
      .then(() => this.storePasswords(passwords));
    this.passwordImports = operation;
    return operation;
  }

  private async storePasswords(
    passwords: ReturnType<typeof parsePasswordCsv>,
  ): Promise<{ count: number }> {
    const cdp = await this.connection();
    this.passwordTarget ??= (async () => {
      const { targetId } = await cdp.send("Target.createTarget", {
        url: "chrome://password-manager/settings",
        background: true,
      });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const ready = () => { if (location.href === "chrome://password-manager/settings" && typeof chrome.passwordsPrivate?.addPassword === "function") resolve(true); else if (Date.now() >= deadline) reject(new Error("unavailable")); else setTimeout(ready, 25); }; ready(); })`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      return { targetId, sessionId };
    })().catch((error) => {
      this.passwordTarget = undefined;
      throw error;
    });
    const target = await this.passwordTarget;
    const { targetInfo } = await cdp.send("Target.getTargetInfo", { targetId: target.targetId });
    if (targetInfo.url !== "chrome://password-manager/settings")
      throw new BrowserError("browser-permission-denied");
    // Chrome owns encrypted credential storage. Do not persist imported plaintext in Workbench.
    const response = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(async () => { if (location.href !== "chrome://password-manager/settings" || typeof chrome.passwordsPrivate?.addPassword !== "function") throw new Error("unavailable"); for (const entry of ${JSON.stringify(passwords)}) await chrome.passwordsPrivate.addPassword(entry); return ${passwords.length}; })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      target.sessionId,
    );
    if (response.exceptionDetails || response.result?.value !== passwords.length)
      throw new BrowserError("browser-operation-failed");
    return { count: passwords.length };
  }

  private async configureDownloads(settings: BrowserSettings): Promise<void> {
    this.downloadDirectory = settings.downloadDirectory || path.join(this.directory, "downloads");
    await mkdir(this.downloadDirectory, { recursive: true, mode: 0o700 });
    await this.browser?.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: this.downloadDirectory,
      eventsEnabled: true,
    });
  }

  private async downloadStarted(params: Record<string, any>): Promise<void> {
    if (
      typeof params.guid !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(params.guid) ||
      typeof params.url !== "string"
    )
      return;
    const tab = [...this.tabs.values()].find((candidate) => candidate.frameIds.has(params.frameId));
    const download: BrowserDownload = {
      id: params.guid,
      name: fileName(String(params.suggestedFilename)),
      url: params.url,
      state: "inProgress",
      receivedBytes: 0,
      totalBytes: 0,
    };
    const approved = tab?.allowedDownloads.delete(download.url) ?? false;
    if (tab?.source !== "user" && !approved) {
      // Blob/download-attribute links have no attachment response to pause. Cancel before
      // asking, then replay the browser link only after permission has been granted.
      await this.browser
        ?.send("Browser.cancelDownload", { guid: download.id })
        .catch(() => undefined);
      await rm(path.join(this.downloadDirectory, params.guid), { force: true });
      await this.authorize("download", download.url, tab?.state.id ?? "", "agent");
      if (!tab) throw new BrowserError("browser-permission-denied");
      tab.allowedDownloads.add(download.url);
      await this.send(tab, "Runtime.evaluate", {
        expression: `(() => { const link = document.createElement("a"); link.href = ${JSON.stringify(download.url)}; link.download = ${JSON.stringify(download.name)}; document.body.append(link); link.click(); link.remove(); })()`,
        userGesture: true,
      });
      return;
    }
    const record: DownloadRecord = {
      download,
      sessionId: tab?.state.id,
      path: path.join(this.downloadDirectory, params.guid),
    };
    this.downloads.set(download.id, record);
    this.publish({ type: "download", download });
  }

  private async downloadProgress(params: Record<string, any>): Promise<void> {
    const record = this.downloads.get(params.guid);
    if (!record || record.download.state === "canceled") return;
    record.download = {
      ...record.download,
      state: params.state,
      receivedBytes: params.receivedBytes,
      totalBytes: params.totalBytes,
    };
    if (params.state === "completed") {
      await this.persistDownloads();
      if ((await this.settings.get()).askDownloadLocation)
        this.publish({ type: "file", file: await this.readDownload(record) });
    }
    this.publish({ type: "download", download: { ...record.download } });
  }

  private async readDownload(record: DownloadRecord): Promise<BrowserFile> {
    const info = await stat(record.path);
    if (!info.isFile()) throw new BrowserError("browser-invalid");
    if (info.size > MAX_FILE_BYTES) throw new BrowserError("browser-file-too-large");
    return this.file(
      record.download.name,
      "application/octet-stream",
      (await readFile(record.path)).toString("base64"),
    );
  }

  private async restoreDownloads(): Promise<void> {
    try {
      const records: unknown = JSON.parse(
        await readFile(path.join(this.directory, "downloads.json"), "utf8"),
      );
      if (!Array.isArray(records)) return;
      for (const record of records.slice(-1000)) {
        if (
          record &&
          typeof record === "object" &&
          typeof record.path === "string" &&
          path.isAbsolute(record.path) &&
          typeof record.download?.id === "string" &&
          record.download.state === "completed"
        ) {
          this.downloads.set(record.download.id, record);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.publish({ type: "error", code: "browser-operation-failed" });
    }
  }

  private persistDownloads(): Promise<void> {
    const operation = this.downloadWrites
      .catch(() => undefined)
      .then(() =>
        atomicReplaceFile(
          path.join(this.directory, "downloads.json"),
          JSON.stringify(
            [...this.downloads.values()]
              .filter((record) => record.download.state === "completed")
              .slice(-1000)
              .map(({ download, path, sessionId }) => ({ download, path, sessionId })),
          ),
          { directoryMode: 0o700, enforceFileModeAfterReplace: true },
        ),
      );
    this.downloadWrites = operation;
    return operation;
  }

  private async closeTab(tab: Tab): Promise<void> {
    this.tabs.delete(tab.state.id);
    for (const [id, permission] of this.permissions) {
      if (permission.sessionId !== tab.state.id) continue;
      clearTimeout(permission.timer);
      permission.resolve(false);
      this.permissions.delete(id);
    }
    await this.browser?.send("Target.closeTarget", { targetId: tab.targetId });
    await Promise.all(
      [...tab.uploadDirectories].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.permissions.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.permissions.clear();
    for (const tab of this.tabs.values())
      for (const directory of tab.uploadDirectories)
        void rm(directory, { recursive: true, force: true }).catch(() => undefined);
    this.tabs.clear();
    this.listeners.clear();
    this.browser?.dispose();
  }
}
