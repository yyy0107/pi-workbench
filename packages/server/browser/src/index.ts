/* eslint-disable no-control-regex -- Browser file names must exclude ASCII control characters. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  BROWSER_PAGES,
  parseBrowserCommand,
  type BrowserCommand,
  type BrowserCursor,
  type BrowserDownload,
  type BrowserEvent,
  type BrowserFile,
  type BrowserHistoryEntry,
  type BrowserPermission,
  type BrowserSessionState,
  type BrowserSettings,
  type BrowserSnapshot,
  type BrowserSnapshotNode,
} from "@workbench/browser-contracts";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";

import { BrowserCdp, launchBrowser, type CdpEvent } from "./cdp";
import { BrowserError } from "./errors";
import { parseCookieJson, parsePasswordCsv } from "./imports";
import { BrowserSettingsStore } from "./settings";

export { BrowserError } from "./errors";

type Source = "user" | "agent";
interface SnapshotReference {
  backendNodeId: number;
  frameId: string;
  contextId: number;
}
interface Snapshot {
  id: string;
  frames: Map<string, number>;
  refs: Map<string, SnapshotReference>;
}
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
  fileRequests: Map<string, { nodeId: number; multiple: boolean }>;
  uploadDirectories: Set<string>;
  viewportOperation?: Promise<void>;
  viewportPending: boolean;
  dialogPending: boolean;
  navigationBlocked: boolean;
  allowedDownloads: Set<string>;
  popupUrls: string[];
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  documentReady: boolean;
  snapshot?: Snapshot;
  agentControl?: { signal: AbortSignal; dispose(): void };
  pointerPosition?: { x: number; y: number };
}
interface DownloadRecord {
  download: BrowserDownload;
  sessionId?: string;
  path: string;
}

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TABS = 32;
const MAIN_FRAME_SCHEMES = new Set(["http:", "https:", "about:", "chrome:"]);

export function normalizeBrowserUrl(value: string, internal = false, localFile = false): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (internal && Object.values(BROWSER_PAGES).includes(trimmed)) return trimmed;
  const hostWithPort = /^(?:localhost|[^/:?#]+\.[^/:?#]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(
    trimmed,
  );
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !hostWithPort;
  try {
    let url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (localFile && url.protocol === "file:" && !url.hostname) return url.href;
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
    if (
      patch.agentControlled === false ||
      patch.status === "disconnected" ||
      patch.status === "error"
    ) {
      tab.agentControl?.dispose();
      tab.agentControl = undefined;
      patch = { ...patch, agentControlled: false };
    }
    if (
      patch.agentControlled === false ||
      (patch.url !== undefined && patch.url !== tab.state.url) ||
      patch.status === "loading"
    )
      this.setAgentCursor(tab, null);
    if (
      (patch.url !== undefined && patch.url !== tab.state.url) ||
      patch.status === "loading" ||
      patch.status === "disconnected" ||
      patch.status === "error"
    )
      tab.snapshot = undefined;
    if (patch.status === "loading") tab.documentReady = false;
    tab.state = { ...tab.state, ...patch, revision: tab.state.revision + 1 };
    this.publish({ type: "state", session: { ...tab.state } });
    return { ...tab.state };
  }

  private beginAgentControl(tab: Tab, signal: AbortSignal): void {
    if (signal.aborted || tab.agentControl?.signal === signal) return;
    tab.agentControl?.dispose();
    const abort = () => this.clearAgentControl(tab, signal);
    tab.agentControl = {
      signal,
      dispose: () => signal.removeEventListener("abort", abort),
    };
    signal.addEventListener("abort", abort, { once: true });
    if (!tab.state.agentControlled) this.update(tab, { agentControlled: true });
  }

  private clearAgentControl(tab: Tab, owner?: AbortSignal): void {
    if (owner && tab.agentControl?.signal !== owner) return;
    if (!tab.agentControl && !tab.state.agentControlled && !tab.state.agentCursor) return;
    this.update(tab, { agentControlled: false });
  }

  private setAgentCursor(tab: Tab, cursor: BrowserCursor | null): void {
    if (
      cursor &&
      (!tab.state.agentControlled ||
        !Number.isFinite(cursor.x) ||
        !Number.isFinite(cursor.y) ||
        cursor.x < 0 ||
        cursor.y < 0)
    )
      return;
    if (!cursor && !tab.state.agentCursor) return;
    tab.state = { ...tab.state, agentCursor: cursor ?? undefined };
    this.publish({ type: "cursor", sessionId: tab.state.id, cursor });
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
    const result = await (await this.connection()).send<T>(method, params, tab.cdpSessionId);
    if (
      method === "Input.dispatchMouseEvent" &&
      ["mouseMoved", "mousePressed", "mouseReleased"].includes(String(params.type)) &&
      typeof params.x === "number" &&
      Number.isFinite(params.x) &&
      typeof params.y === "number" &&
      Number.isFinite(params.y)
    )
      tab.pointerPosition = { x: params.x, y: params.y };
    return result;
  }

  private async moveAgentPointer(
    tab: Tab,
    destination: { x: number; y: number },
    current: () => void,
  ): Promise<void> {
    const move = async (point: { x: number; y: number }) => {
      current();
      await this.send(tab, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...point,
        buttons: 0,
      });
      current();
      this.setAgentCursor(tab, { ...point, pressed: false });
    };
    const start = tab.pointerPosition ?? { x: 0, y: 0 };
    if (!tab.pointerPosition) await move(start);
    if (start.x === destination.x && start.y === destination.y) return move(destination);
    // Real native mouse events keep hover behavior and the displayed cursor on the same path.
    for (let step = 1; step <= 8; step++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await move({
        x: start.x + ((destination.x - start.x) * step) / 8,
        y: start.y + ((destination.y - start.y) * step) / 8,
      });
    }
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
    controlSignal?: AbortSignal,
  ): Promise<Tab> {
    if (this.tabs.size >= MAX_TABS) throw new BrowserError("browser-operation-failed");
    const settings = await this.settings.get();
    signal?.throwIfAborted();
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
      viewportPending: false,
      dialogPending: false,
      navigationBlocked: false,
      allowedDownloads: new Set(),
      popupUrls: [],
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: 2,
      documentReady: true,
    };
    this.tabs.set(sessionId, tab);
    if (controlSignal) this.beginAgentControl(tab, controlSignal);
    try {
      await this.connectTab(tab);
      if (url !== "about:blank") await this.navigate(tab, url, source);
      else this.update(tab, {});
      return tab;
    } catch (error) {
      this.clearAgentControl(tab);
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
    tab.pointerPosition = undefined;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    tab.targetId = targetId;
    tab.cdpSessionId = sessionId;
    await Promise.all([
      this.send(tab, "Page.enable"),
      this.send(tab, "Runtime.enable"),
      this.send(tab, "DOM.enable"),
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
    const url = normalizeBrowserUrl(value, internal, source === "user");
    if (source === "agent") tab.signal?.throwIfAborted();
    tab.source = source;
    if (source === "user") tab.signal = undefined;
    tab.navigationBlocked = false;
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
    const { width, height, zoom, device } = tab.state;
    if (tab.screencasting) {
      await this.send(tab, "Page.stopScreencast");
      tab.screencasting = false;
    }
    const logicalWidth = Math.min(16384, Math.max(1, Math.round((device?.width ?? width) / zoom)));
    const logicalHeight = Math.min(
      16384,
      Math.max(1, Math.round((device?.height ?? height) / zoom)),
    );
    await this.send(tab, "Emulation.setDeviceMetricsOverride", {
      width: logicalWidth,
      height: logicalHeight,
      deviceScaleFactor: tab.deviceScaleFactor,
      mobile: device?.mobile ?? false,
    });
    if (tab.viewport.width !== logicalWidth || tab.viewport.height !== logicalHeight)
      this.setAgentCursor(tab, null);
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
        // ponytail: native compositor density caps extreme zoom; keep native scroll/input intact.
        const density = Math.min(
          tab.deviceScaleFactor,
          3840 / width,
          3840 / height,
          Math.sqrt((3840 * 2160) / (width * height)),
        );
        await this.send(tab, "Page.bringToFront");
        // CDP's evaluate timeout does not cover awaitPromise; bound this optional paint wait here.
        await (
          await this.connection()
        )
          .send(
            "Runtime.evaluate",
            {
              expression:
                "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
              awaitPromise: true,
            },
            tab.cdpSessionId,
            150,
          )
          .catch(() => undefined);
        await this.send(tab, "Page.startScreencast", {
          format: "png",
          maxWidth: Math.max(1, Math.floor(width * density)),
          maxHeight: Math.max(1, Math.floor(height * density)),
          everyNthFrame: 1,
        });
      } catch (error) {
        tab.screencasting = false;
        this.update(tab, { status: "error", error: "browser-operation-failed" });
        throw error;
      }
    } else if (!tab.visible && tab.screencasting) {
      await this.send(tab, "Page.stopScreencast");
      tab.screencasting = false;
    }
  }

  private queueViewport(tab: Tab): Promise<void> {
    tab.viewportPending = true;
    tab.viewportOperation ??= Promise.resolve().then(async () => {
      try {
        while (tab.viewportPending) {
          tab.viewportPending = false;
          try {
            await this.applyViewport(tab);
          } catch (error) {
            if (!tab.viewportPending) throw error;
          }
        }
      } finally {
        tab.viewportOperation = undefined;
      }
    });
    return tab.viewportOperation;
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
            // Input uses CSS coordinates; bitmap density must not change pointer coordinates.
            this.publish({
              type: "frame",
              sessionId: tab.state.id,
              data: params.data,
              mimeType: "image/png",
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
      if (tab.snapshot?.frames.has(params.frameId)) tab.snapshot = undefined;
    } else if (method === "Page.frameNavigated") {
      if (tab.snapshot?.frames.has(params.frame.id)) tab.snapshot = undefined;
      tab.frameIds.add(params.frame.id);
      if (!params.frame.parentId) {
        tab.frameId = params.frame.id;
        tab.fileRequests.clear();
        tab.popupUrls.length = 0;
        this.update(tab, { url: params.frame.url, title: params.frame.url });
        await this.history(tab);
      }
    } else if (method === "Page.navigatedWithinDocument") {
      if (tab.snapshot?.frames.has(params.frameId)) tab.snapshot = undefined;
      if (params.frameId === tab.frameId) {
        this.update(tab, { url: params.url });
        await this.history(tab);
      }
    } else if (method === "DOM.documentUpdated" || method === "Runtime.executionContextsCleared") {
      tab.snapshot = undefined;
    } else if (method === "Runtime.executionContextDestroyed") {
      if (tab.snapshot && [...tab.snapshot.frames.values()].includes(params.executionContextId))
        tab.snapshot = undefined;
    } else if (method === "Page.domContentEventFired") {
      tab.documentReady = true;
    } else if (method === "Page.frameStartedLoading") {
      if (tab.snapshot?.frames.has(params.frameId)) tab.snapshot = undefined;
      if (params.frameId === tab.frameId && !tab.navigationBlocked)
        this.update(tab, { status: "loading", error: undefined });
    } else if (method === "Page.frameStoppedLoading" && params.frameId === tab.frameId) {
      tab.documentReady = true;
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
      if (tab.source === "agent") tab.signal?.throwIfAborted();
      const url = new URL(params.request.url);
      if (
        (!MAIN_FRAME_SCHEMES.has(url.protocol) &&
          !(url.protocol === "file:" && !url.hostname && tab.source === "user")) ||
        (url.protocol === "about:" && url.href !== "about:blank")
      ) {
        throw new BrowserError("browser-permission-denied");
      }
      if (
        params.frameId === tab.frameId &&
        tab.source === "agent" &&
        url.protocol === "chrome:" &&
        ![BROWSER_PAGES.history, BROWSER_PAGES.downloads].includes(url.href)
      )
        throw new BrowserError("browser-permission-denied");
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
    options: { source?: Source; signal?: AbortSignal; controlSignal?: AbortSignal } = {},
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
    const sessionId = "sessionId" in command ? command.sessionId : undefined;
    // A UI attachment observes the existing tab; only an explicit run signal may claim control.
    const operationControl =
      source === "agent" && sessionId && command.type !== "attach" && !options.controlSignal
        ? new AbortController()
        : undefined;
    const controlSignal =
      source === "agent" ? (options.controlSignal ?? operationControl?.signal) : undefined;
    const abortControl = () => {
      const tab = sessionId ? this.tabs.get(sessionId) : undefined;
      if (tab && controlSignal) this.clearAgentControl(tab, controlSignal);
    };
    try {
      options.signal?.throwIfAborted();
      const tab = sessionId ? this.tabs.get(sessionId) : undefined;
      if (tab && controlSignal) this.beginAgentControl(tab, controlSignal);
      if (controlSignal) options.signal?.addEventListener("abort", abortControl, { once: true });
      if (tab && source === "user") {
        const input = command.type === "input" ? command.event : undefined;
        if (
          [
            "navigate",
            "back",
            "forward",
            "reload",
            "stop",
            "close",
            "open-page",
            "click",
            "fill",
            "find",
            "cdp",
            "site-tools.call",
          ].includes(command.type) ||
          input?.kind === "text" ||
          (input?.kind === "key" && input.type === "keyDown") ||
          (input?.kind === "mouse" &&
            (input.type === "mousePressed" ||
              input.type === "mouseWheel" ||
              (input.type === "mouseMoved" && (input.buttons ?? 0) > 0)))
        )
          this.clearAgentControl(tab);
      }
      return await this.execute(command, source, options.signal, controlSignal);
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("browser-operation-failed");
    } finally {
      options.signal?.removeEventListener("abort", abortControl);
      operationControl?.abort();
    }
  }

  private async execute(
    command: BrowserCommand,
    source: Source,
    signal?: AbortSignal,
    controlSignal?: AbortSignal,
  ): Promise<unknown> {
    switch (command.type) {
      case "history.list":
        await this.authorize("history", "about:blank", "", source, signal);
        return this.listHistory(command.query ?? "", command.limit ?? 50, signal);
      case "tabs.list":
        return [...this.tabs.values()]
          .filter((tab) => tab.state.projectId === command.projectId)
          .map((tab) => ({ ...tab.state }));
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
        if (existing && source === "agent" && controlSignal) existing.signal = signal;
        if (existing && existing.state.projectId !== command.projectId)
          throw new BrowserError("browser-invalid");
        const tab = existing
          ? await this.requireTab(command.sessionId)
          : await this.createTab(
              command.sessionId,
              command.projectId,
              normalizeBrowserUrl(command.url ?? "about:blank", false, source === "user"),
              source,
              signal,
              controlSignal,
            );
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
    switch (command.type) {
      case "snapshot":
        return this.snapshot(tab, signal);
      case "click":
      case "fill":
        return this.interact(tab, command, source, signal);
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
          tab.source = source;
          if (source === "user") tab.signal = undefined;
          tab.navigationBlocked = false;
          tab.snapshot = undefined;
          tab.documentReady = false;
          await this.send(tab, "Page.navigateToHistoryEntry", { entryId: entry.id });
        }
        return { ...tab.state };
      }
      case "reload": {
        tab.source = source;
        tab.navigationBlocked = false;
        tab.snapshot = undefined;
        tab.documentReady = false;
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
        if (
          command.device !== undefined &&
          Boolean(command.device?.mobile) !== Boolean(tab.state.device?.mobile)
        )
          this.setAgentCursor(tab, null);
        if (command.deviceScaleFactor !== undefined)
          tab.deviceScaleFactor = command.deviceScaleFactor;
        this.update(tab, {
          width: Math.round(command.width),
          height: Math.round(command.height),
          ...(command.zoom === undefined ? {} : { zoom: command.zoom }),
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
          tab.source = source;
          if (source === "user") tab.signal = undefined;
          tab.navigationBlocked = false;
        }
        signal?.throwIfAborted();
        const { kind, ...event } = input;
        const revision = tab.state.revision;
        if (kind === "text") await this.send(tab, "Input.insertText", event);
        else if (kind === "key") await this.send(tab, "Input.dispatchKeyEvent", event);
        else await this.send(tab, "Input.dispatchMouseEvent", event);
        if (
          source === "agent" &&
          input.kind === "mouse" &&
          input.type !== "mouseWheel" &&
          tab.state.revision === revision
        )
          this.setAgentCursor(tab, {
            x: input.x,
            y: input.y,
            pressed: input.type === "mousePressed" || (input.buttons ?? 0) > 0,
          });
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
        try {
          return await this.capture(tab, command.fullPage === true);
        } catch (error) {
          if (error instanceof BrowserError && error.code === "browser-operation-failed")
            this.update(tab, { status: "error", error: error.code });
          throw error;
        }
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
        signal?.throwIfAborted();
        tab.source = source;
        const revision = tab.state.revision;
        const result = await this.send(tab, command.method, command.params);
        if (
          source === "agent" &&
          tab.state.revision === revision &&
          command.method === "Input.dispatchMouseEvent" &&
          command.params?.type !== "mouseWheel" &&
          typeof command.params?.x === "number" &&
          typeof command.params.y === "number"
        )
          this.setAgentCursor(tab, {
            x: command.params.x,
            y: command.params.y,
            pressed:
              command.params.type === "mousePressed" ||
              (typeof command.params.buttons === "number" && command.params.buttons > 0),
          });
        return result;
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
        signal?.throwIfAborted();
        tab.source = source;
        return this.evaluate(
          tab,
          `(async () => { if (document.modelContext?.getTools) { const tool = (await document.modelContext.getTools()).find(tool => tool.name === ${JSON.stringify(command.name)}); if (!tool) throw new Error("unavailable"); return document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(command.arguments))}); } return navigator.modelContextTesting.executeTool(${JSON.stringify(command.name)}, ${JSON.stringify(JSON.stringify(command.arguments))}); })()`,
        );
      }
    }
  }

  private async snapshot(tab: Tab, signal?: AbortSignal): Promise<BrowserSnapshot> {
    const until = Date.now() + 1000;
    while (tab.state.status === "loading" && !tab.documentReady && Date.now() < until) {
      signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (tab.state.status === "loading" && !tab.documentReady)
      throw new BrowserError("browser-page-loading");
    const url = tab.state.url;
    signal?.throwIfAborted();
    if (!tab.frameId) throw new BrowserError("browser-page-loading");
    const snapshot: Snapshot = { id: randomUUID(), frames: new Map(), refs: new Map() };
    tab.snapshot = snapshot;
    const current = () => {
      signal?.throwIfAborted();
      if (tab.snapshot !== snapshot || tab.state.url !== url)
        throw new BrowserError("browser-element-stale");
    };
    const readFrame = async (
      frameId: string,
      owner?: { backendNodeId: number; contextId: number },
    ) => {
      if (snapshot.frames.has(frameId)) return;
      // Track the frame before awaiting CDP so navigation also invalidates an in-flight snapshot.
      snapshot.frames.set(frameId, 0);
      try {
        if (owner) {
          const resolved = await this.send(tab, "DOM.resolveNode", {
            backendNodeId: owner.backendNodeId,
            executionContextId: owner.contextId,
          });
          const objectId = resolved.object.objectId;
          if (!objectId) throw new Error();
          try {
            const access = await this.send(tab, "Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function() { return !!this.contentDocument; }",
              returnByValue: true,
            });
            current();
            if (access.result?.value !== true) {
              snapshot.frames.delete(frameId);
              return;
            }
          } finally {
            await this.send(tab, "Runtime.releaseObject", { objectId }).catch(() => undefined);
          }
        }
        const [tree, world] = await Promise.all([
          this.send(tab, "Accessibility.getFullAXTree", { frameId }),
          this.send(tab, "Page.createIsolatedWorld", {
            frameId,
            worldName: "workbench-browser-observation",
          }),
        ]);
        current();
        snapshot.frames.set(frameId, world.executionContextId);
        return { tree, contextId: world.executionContextId as number };
      } catch (error) {
        current();
        snapshot.frames.delete(frameId);
        if (!owner) throw error;
        // Cross-origin and separate-target documents keep the existing explicit fallback.
        return;
      }
    };
    const nodes: BrowserSnapshotNode[] = [];
    let characters = 0;
    let truncated = false;
    const visitFrame = async (
      frameId: string,
      frameDepth: number,
      owner?: { backendNodeId: number; contextId: number },
    ): Promise<boolean> => {
      const frameTree = await readFrame(frameId, owner);
      if (!frameTree) return false;
      const { tree, contextId } = frameTree;
      const byId = new Map<string, Record<string, any>>(
        tree.nodes.map((node: Record<string, any>) => [node.nodeId, node]),
      );
      const seen = new Set<string>();
      const visit = async (id: string, depth: number): Promise<void> => {
        if (seen.has(id) || truncated) return;
        seen.add(id);
        const node = byId.get(id);
        if (!node) return;
        signal?.throwIfAborted();
        const role = String(node.role?.value ?? "");
        const frame = /iframe/i.test(role);
        let item: BrowserSnapshotNode | undefined;
        if (!node.ignored && role && role !== "InlineTextBox") {
          if (nodes.length >= 1000 || characters >= 65536) {
            truncated = true;
            return;
          }
          item = {
            depth,
            role,
            name: String(node.name?.value ?? "").slice(0, 2048),
          };
          const properties = new Map<string, unknown>(
            (node.properties ?? []).map((property: Record<string, any>) => [
              property.name,
              property.value?.value,
            ]),
          );
          for (const key of ["disabled", "selected", "expanded"] as const) {
            const value = properties.get(key);
            if (typeof value === "boolean") item[key] = value;
          }
          const checked = properties.get("checked");
          if (typeof checked === "boolean" || checked === "mixed") item.checked = checked;
          if (checked === "true" || checked === "false") item.checked = checked === "true";
          if (
            !frame &&
            node.backendDOMNodeId &&
            !["RootWebArea", "StaticText", "LineBreak"].includes(role)
          ) {
            item.ref = snapshot.id + ":" + nodes.length;
            snapshot.refs.set(item.ref, {
              backendNodeId: node.backendDOMNodeId,
              frameId,
              contextId,
            });
          }
          if (typeof node.value?.value === "string" && node.backendDOMNodeId && !frame) {
            const described = await this.send(tab, "DOM.describeNode", {
              backendNodeId: node.backendDOMNodeId,
            });
            const attributes: string[] = described.node.attributes ?? [];
            const type = attributes.find(
              (_, index) => index % 2 === 1 && attributes[index - 1] === "type",
            );
            if (!(described.node.localName === "input" && type?.toLowerCase() === "password"))
              item.value = node.value.value.slice(0, 4096);
          }
          characters += item.name.length + (item.value?.length ?? 0);
          nodes.push(item);
          depth++;
        }
        if (frame) {
          let childFrameId: string | undefined;
          if (node.backendDOMNodeId) {
            try {
              const described = await this.send(tab, "DOM.describeNode", {
                backendNodeId: node.backendDOMNodeId,
                depth: 0,
              });
              childFrameId = described.node.frameId;
            } catch {
              current();
            }
          }
          const expanded =
            childFrameId &&
            !truncated &&
            (await visitFrame(childFrameId, depth, {
              backendNodeId: node.backendDOMNodeId,
              contextId,
            }));
          if (item && !expanded) item.unavailable = "frame";
        } else for (const child of node.childIds ?? []) await visit(child, depth);
      };
      if (tree.nodes[0]) await visit(tree.nodes[0].nodeId, frameDepth);
      return true;
    };
    await visitFrame(tab.frameId, 0);
    current();
    return { session: { ...tab.state }, snapshotId: snapshot.id, nodes, truncated };
  }

  private async interact(
    tab: Tab,
    command: Extract<BrowserCommand, { type: "click" | "fill" }>,
    source: Source,
    signal?: AbortSignal,
  ): Promise<BrowserSessionState> {
    const snapshot = tab.snapshot;
    const reference = snapshot?.refs.get(command.ref);
    if (!snapshot || !reference) throw new BrowserError("browser-element-stale");
    const { backendNodeId, frameId, contextId } = reference;
    const controlOwner = tab.agentControl?.signal;
    const current = () => {
      signal?.throwIfAborted();
      if (
        source === "agent" &&
        (!controlOwner || controlOwner.aborted || tab.agentControl?.signal !== controlOwner)
      )
        throw new BrowserError(
          "browser-operation-failed",
          "Browser control ended before this interaction completed.",
        );
      if (tab.snapshot !== snapshot) throw new BrowserError("browser-element-stale");
    };
    current();
    tab.source = source;
    tab.signal = source === "agent" ? signal : undefined;
    tab.navigationBlocked = false;
    let objectId: string;
    try {
      const resolved = await this.send(tab, "DOM.resolveNode", {
        backendNodeId,
        executionContextId: contextId,
      });
      objectId = resolved.object.objectId;
      if (!objectId) throw new Error();
    } catch {
      throw new BrowserError("browser-element-stale");
    }
    const call = (functionDeclaration: string, args: Record<string, unknown>[] = []) =>
      this.send(tab, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args,
        returnByValue: true,
      });
    const geometry = async () => {
      const [boxes, metrics] = await Promise.all([
        this.send(tab, "DOM.getContentQuads", { backendNodeId }),
        this.send(tab, "Page.getLayoutMetrics"),
      ]);
      current();
      const viewport = metrics.cssVisualViewport;
      const points: { x: number; y: number }[] = [];
      for (const quad of (boxes.quads ?? []) as number[][]) {
        if (
          quad.length !== 8 ||
          !quad.every(Number.isFinite) ||
          Math.max(quad[0]!, quad[2]!, quad[4]!, quad[6]!) <= 0 ||
          Math.min(quad[0]!, quad[2]!, quad[4]!, quad[6]!) >= viewport.clientWidth ||
          Math.max(quad[1]!, quad[3]!, quad[5]!, quad[7]!) <= 0 ||
          Math.min(quad[1]!, quad[3]!, quad[5]!, quad[7]!) >= viewport.clientHeight
        )
          continue;
        const clipped = quad.map((value, index) =>
          Math.max(
            0,
            Math.min((index % 2 ? viewport.clientHeight : viewport.clientWidth) - 1, value),
          ),
        );
        const center = {
          x: (clipped[0]! + clipped[2]! + clipped[4]! + clipped[6]!) / 4,
          y: (clipped[1]! + clipped[3]! + clipped[5]! + clipped[7]!) / 4,
        };
        // ponytail: five points per quad; use finer sampling if tiny exposed targets need it.
        points.push(center);
        for (let index = 0; index < clipped.length; index += 2) {
          points.push({
            x: (center.x + clipped[index]!) / 2,
            y: (center.y + clipped[index + 1]!) / 2,
          });
        }
      }
      if (!points.length)
        throw new BrowserError(
          "browser-element-not-interactable",
          "No visible target area remains after scrolling. Inspect a screenshot or choose another element.",
        );
      return { viewport, points };
    };
    const hitTest = async (
      point: { x: number; y: number },
      viewport: { pageX: number; pageY: number },
    ) => {
      current();
      // Native input and quads use viewport CSS coordinates; this hit test uses document CSS coordinates.
      const hit = await this.send(tab, "DOM.getNodeForLocation", {
        x: Math.round(point.x + viewport.pageX),
        y: Math.round(point.y + viewport.pageY),
      });
      if (hit.frameId !== frameId) return false;
      const target = await this.send(tab, "DOM.resolveNode", {
        backendNodeId: hit.backendNodeId,
        executionContextId: contextId,
      });
      try {
        const visible = await call(
          "function(hit) { const element = hit.nodeType === 1 ? hit : hit.parentElement; return (this === hit || this.contains(hit)) && element?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}); }",
          [{ objectId: target.object.objectId }],
        );
        return visible.result?.value === true;
      } finally {
        await this.send(tab, "Runtime.releaseObject", { objectId: target.object.objectId }).catch(
          () => undefined,
        );
      }
    };
    try {
      const { result } = await call(
        "function() { const visible = element => element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}); return { connected: this.isConnected, visible: this.nodeType === 1 && (visible(this) || getComputedStyle(this).display === 'contents' && [...this.querySelectorAll('*')].some(visible)), disabled: this.nodeType === 1 && (this.matches(':disabled') || !!this.closest('[aria-disabled=true]')), editable: this.isContentEditable || (this.nodeName === 'TEXTAREA' || this.nodeName === 'INPUT' && /^(text|search|email|url|tel|password|number)$/.test(this.type)) && !this.readOnly }; }",
      );
      if (!result?.value?.connected) throw new BrowserError("browser-element-stale");
      if (!result.value.visible)
        throw new BrowserError(
          "browser-element-not-interactable",
          "This element has no visible content. Inspect a screenshot or choose another element.",
        );
      if (result.value.disabled)
        throw new BrowserError(
          "browser-element-not-interactable",
          "This element is disabled. Choose an enabled control.",
        );
      if (command.type === "fill" && !result.value.editable)
        throw new BrowserError(
          "browser-element-not-interactable",
          "This target is not a writable editable field. It may be read-only; use click for other controls.",
        );
      current();
      await this.send(tab, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
      current();
      if (command.type === "fill") {
        if (source === "agent") {
          const { points } = await geometry();
          await this.moveAgentPointer(tab, points[0]!, current);
        }
        current();
        await this.send(tab, "DOM.focus", { backendNodeId });
        const focused = await call(
          "function() { return this.getRootNode().activeElement === this; }",
        );
        if (focused.result?.value !== true)
          throw new BrowserError(
            "browser-element-not-interactable",
            "The field could not receive keyboard focus. Inspect the page before entering text.",
          );
        current();
        await this.send(tab, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          commands: ["selectAll"],
        });
        await this.send(tab, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA" });
        const stillFocused = await call(
          "function() { return this.getRootNode().activeElement === this; }",
        );
        if (stillFocused.result?.value !== true)
          throw new BrowserError(
            "browser-element-not-interactable",
            "The page moved keyboard focus away from this field. Inspect the page before entering text.",
          );
        current();
        if (command.text) await this.send(tab, "Input.insertText", { text: command.text });
        else {
          await this.send(tab, "Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Backspace",
            code: "Backspace",
          });
          await this.send(tab, "Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Backspace",
            code: "Backspace",
          });
        }
      } else {
        const { viewport, points } = await geometry();
        let position: { x: number; y: number } | undefined;
        for (const point of points) {
          if (await hitTest(point, viewport)) {
            position = point;
            break;
          }
        }
        if (!position)
          throw new BrowserError(
            "browser-element-not-interactable",
            "The target is covered by another element or clipped at the tested points. Inspect a screenshot or dismiss the covering UI before retrying.",
          );
        if (source === "agent") {
          await this.moveAgentPointer(tab, position, current);
          const metrics = await this.send(tab, "Page.getLayoutMetrics");
          if (!(await hitTest(position, metrics.cssVisualViewport)))
            throw new BrowserError(
              "browser-element-not-interactable",
              "Hovering changed or covered the target. Inspect a screenshot before retrying.",
            );
        }
        const { x, y } = position;
        current();
        const revision = tab.state.revision;
        await this.send(tab, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        if (source === "agent" && tab.state.revision === revision)
          this.setAgentCursor(tab, { x, y, pressed: true });
        await this.send(tab, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        if (source === "agent" && tab.state.revision === revision)
          this.setAgentCursor(tab, { x, y, pressed: false });
      }
      return { ...tab.state };
    } finally {
      await this.send(tab, "Runtime.releaseObject", { objectId }).catch(() => undefined);
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
      clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
      capture = { width: size.width, height: size.height };
    }
    if (
      capture.width * tab.deviceScaleFactor > 16384 ||
      capture.height * tab.deviceScaleFactor > 16384 ||
      capture.width * capture.height * tab.deviceScaleFactor ** 2 > 50_000_000
    )
      throw new BrowserError("browser-file-too-large");
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

  private async listHistory(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<BrowserHistoryEntry[]> {
    const cdp = await this.connection();
    signal?.throwIfAborted();
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
      background: true,
    });
    const close = () => cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeLoad: (() => void) | undefined;
    let rejectLoad: ((reason: unknown) => void) | undefined;
    const abort = () => {
      rejectLoad?.(signal?.reason);
      void close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      signal?.throwIfAborted();
      const loaded = new Promise<void>((resolve, reject) => {
        let historyCommitted = false;
        rejectLoad = reject;
        loadTimer = setTimeout(() => reject(new BrowserError("browser-operation-failed")), 5000);
        unsubscribeLoad = cdp.subscribe((event) => {
          if (event.sessionId !== sessionId) return;
          if (event.method === "Page.frameNavigated" && !event.params.frame?.parentId)
            historyCommitted = event.params.frame?.url === "chrome://history/";
          if (!historyCommitted || event.method !== "Page.loadEventFired") return;
          clearTimeout(loadTimer);
          unsubscribeLoad?.();
          rejectLoad = undefined;
          resolve();
        });
      });
      // Wait outside the page context: navigating away from about:blank destroys that context.
      await Promise.all([
        loaded,
        cdp.send("Page.navigate", { url: "chrome://history/" }, sessionId).then((result) => {
          if (result.errorText) throw new BrowserError("browser-operation-failed");
        }),
      ]);
      signal?.throwIfAborted();
      // ponytail: reuse Chrome's private WebUI service; update this bridge if Chromium changes it.
      const response = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            const module = await import("chrome://history/history.js");
            const service = (module.BrowserServiceImpl ?? module.BrowserProxyImpl).getInstance();
            const { results } = await service.handler.queryHistory(${JSON.stringify(query)}, ${limit}, null, true, true);
            return results.value.filter(entry => /^https?:\\/\\//.test(entry.url)).slice(0, ${limit}).map(entry => ({ url: entry.url, title: entry.title, time: entry.time }));
          })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
        10000,
      );
      signal?.throwIfAborted();
      if (response.exceptionDetails || !Array.isArray(response.result?.value))
        throw new BrowserError("browser-operation-failed");
      const entries: BrowserHistoryEntry[] = response.result.value;
      const seen = new Set<string>();
      // Chrome groups repeated visits per day; address suggestions need one row per URL.
      return entries.filter((entry) => {
        if (seen.has(entry.url)) return false;
        seen.add(entry.url);
        return true;
      });
    } finally {
      clearTimeout(loadTimer);
      unsubscribeLoad?.();
      signal?.removeEventListener("abort", abort);
      await close();
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
    this.clearAgentControl(tab);
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
    for (const tab of this.tabs.values()) this.clearAgentControl(tab);
    this.tabs.clear();
    this.listeners.clear();
    this.browser?.dispose();
  }
}
