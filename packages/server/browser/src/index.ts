/* eslint-disable no-control-regex -- Browser file names must exclude ASCII control characters. */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  BROWSER_CLICK_PREPARE_MS,
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
  type BrowserElementTarget,
} from "@workbench/browser-contracts";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";

import { BrowserCdp, launchBrowser, type CdpEvent } from "./cdp";
import { BrowserError } from "./errors";
import { parseCookieJson, parsePasswordCsv } from "./imports";
import { BrowserSettingsStore } from "./settings";
import { connectExternalBrowser, listBrowserProfiles } from "./profiles";
import { BrowserDiagnostics } from "./diagnostics";
import { createPointerTrajectory } from "./pointer-motion";
import {
  elementAction,
  keyEvent,
  pageInfoExpression,
  readPageExpression,
  searchExpression,
} from "./page-scripts";

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
  refsByNode: Map<string, string>;
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
  observation?: BrowserSnapshot;
  diagnostics: BrowserDiagnostics;
  dialog?: Extract<BrowserEvent, { type: "dialog" }>;
  agentControl?: { signal: AbortSignal; dispose(): void };
  agentOperations: Set<AbortController>;
  agentReleases: Map<string, { method: string; params: Record<string, unknown> }>;
  userActivityTimer?: ReturnType<typeof setTimeout>;
  pointerPosition?: { x: number; y: number };
}
interface DownloadRecord {
  download: BrowserDownload;
  sessionId?: string;
  path: string;
}

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TABS = 32;
const USER_ACTIVITY_MS = 1500;
const MOUSE_BUTTONS: Record<string, number> = {
  "mouse:left": 1,
  "mouse:right": 2,
  "mouse:middle": 4,
  "mouse:back": 8,
  "mouse:forward": 16,
};
const OBSERVATION_COMMANDS = new Set<BrowserCommand["type"]>([
  "attach",
  "snapshot",
  "screenshot",
  "copy",
  "print",
  "site-tools.list",
  "page-info",
  "tabs.current",
  "console",
  "network",
  "read-page",
  "web-search",
  "wait",
  "wait-for",
  "wait-for-load",
]);
const PAGE_CHANGE_COMMANDS = new Set<BrowserCommand["type"]>([
  "click",
  "fill",
  "fill-form",
  "select",
  "set-checked",
  "type",
  "press-key",
  "dispatch-key",
  "scroll",
  "drag",
  "navigate",
  "back",
  "forward",
  "reload",
  "dialog.respond",
  "site-tools.call",
]);
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
  private readonly agentOperation = new AsyncLocalStorage<{
    tab: Tab;
    signal?: AbortSignal;
    source: Source;
  }>();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private referenceSequence = 0;
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
  private external?: Awaited<ReturnType<typeof connectExternalBrowser>>;
  private connectionGeneration = 0;
  private starting?: Promise<BrowserCdp>;
  private disposed = false;
  private passwordTarget?: Promise<{ targetId: string; sessionId: string }>;
  private passwordTargetId?: string;
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
      for (const { method, params } of tab.agentReleases.values())
        void this.browser
          ?.send(
            method,
            {
              ...params,
              ...(method === "Input.dispatchMouseEvent" ? tab.pointerPosition : {}),
            },
            tab.cdpSessionId,
          )
          .catch(() => undefined);
      tab.agentReleases.clear();
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
    if (patch.status === "disconnected" || patch.status === "error") tab.snapshot = undefined;
    if (patch.status === "loading") tab.documentReady = false;
    tab.state = { ...tab.state, ...patch, revision: tab.state.revision + 1 };
    this.publish({ type: "state", session: { ...tab.state } });
    return { ...tab.state };
  }

  private beginAgentControl(tab: Tab, signal: AbortSignal): void {
    if (signal.aborted || tab.state.userControlled || tab.agentControl?.signal === signal) return;
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

  private recordUserActivity(tab: Tab, command: BrowserCommand): void {
    const input = command.type === "input" ? command.event : undefined;
    if (input?.kind === "mouse") {
      tab.pointerPosition = { x: input.x, y: input.y };
      tab.state = {
        ...tab.state,
        userCursor: {
          ...tab.pointerPosition,
          pressed: input.type === "mousePressed" || (input.buttons ?? 0) > 0,
        },
      };
    }
    for (const operation of tab.agentOperations)
      operation.abort(new BrowserError("browser-user-active"));
    if (!tab.state.userControlled)
      this.update(tab, { userControlled: true, agentControlled: false });
    clearTimeout(tab.userActivityTimer);
    // ponytail: recent input estimates activity; use explicit leases if long held gestures need priority.
    // Expiry also avoids retaining ownership when a client disconnects without a release event.
    tab.userActivityTimer = setTimeout(() => {
      tab.userActivityTimer = undefined;
      this.update(tab, { userControlled: false });
    }, USER_ACTIVITY_MS);
    tab.userActivityTimer.unref();
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
    if (
      cursor &&
      tab.state.agentCursor?.x === cursor.x &&
      tab.state.agentCursor.y === cursor.y &&
      !!tab.state.agentCursor.pressed === !!cursor.pressed &&
      !!tab.state.agentCursor.preparingClick === !!cursor.preparingClick
    )
      return;
    tab.state = { ...tab.state, agentCursor: cursor ?? undefined };
    this.publish({ type: "cursor", sessionId: tab.state.id, cursor });
  }

  private async connection(): Promise<BrowserCdp> {
    if (this.disposed) throw new BrowserError("browser-unavailable");
    if (this.browser) return this.browser;
    if (!this.starting) {
      const generation = ++this.connectionGeneration;
      this.starting = (async () => {
        const disconnected = () => {
          if (this.connectionGeneration !== generation) return;
          this.browser = undefined;
          this.starting = undefined;
          this.passwordTarget = undefined;
          for (const tab of this.tabs.values()) {
            if (!this.external) tab.targetId = "";
            tab.cdpSessionId = "";
            tab.snapshot = undefined;
            tab.observation = undefined;
            tab.screencasting = false;
            this.update(tab, { status: "disconnected", error: "browser-unavailable" });
          }
        };
        const settings = await this.settings.get();
        let cdp: BrowserCdp;
        let external: typeof this.external;
        if (settings.connection === "chrome") {
          external = await connectExternalBrowser(
            settings,
            disconnected,
            this.external?.anchorTargetId,
          );
          cdp = external.cdp;
          if (this.passwordTargetId)
            await cdp
              .send("Target.closeTarget", { targetId: this.passwordTargetId })
              .catch(() => undefined);
          this.passwordTargetId = undefined;
        } else cdp = await launchBrowser(path.join(this.directory, "profile"), disconnected);
        if (this.disposed || generation !== this.connectionGeneration) {
          cdp.dispose();
          throw new BrowserError("browser-unavailable");
        }
        this.external = external;
        this.browser = cdp;
        const version = await cdp.send("Browser.getVersion");
        this.defaultUserAgent = version.userAgent;
        cdp.subscribe((event) => {
          void this.agentOperation
            .exit(() => this.onEvent(event))
            .catch((error) =>
              this.publish({
                type: "error",
                code: error instanceof BrowserError ? error.code : "browser-operation-failed",
              }),
            );
        });
        await cdp.send("Target.setDiscoverTargets", { discover: true });
        if (!this.external)
          await cdp.send("Target.setAutoAttach", {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: true,
            filter: [{ type: "page" }],
          });
        if (!this.external) await this.configureDownloads(settings);
        return cdp;
      })().catch((error) => {
        if (generation === this.connectionGeneration) {
          this.browser?.dispose();
          this.browser = undefined;
          this.starting = undefined;
        }
        throw error;
      });
    }
    return this.starting;
  }

  private async send<T = Record<string, any>>(
    tab: Tab,
    method: string,
    params: Record<string, unknown> = {},
    smoothPointer = true,
    beforeDispatch?: () => void | Promise<void>,
  ): Promise<T> {
    const operation = this.agentOperation.getStore();
    const signal = operation?.tab === tab ? operation.signal : undefined;
    signal?.throwIfAborted();
    if (
      smoothPointer &&
      operation?.tab === tab &&
      operation.source === "agent" &&
      method === "Input.dispatchMouseEvent" &&
      ["mouseMoved", "mousePressed", "mouseReleased"].includes(String(params.type)) &&
      typeof params.x === "number" &&
      Number.isFinite(params.x) &&
      params.x >= 0 &&
      typeof params.y === "number" &&
      Number.isFinite(params.y) &&
      params.y >= 0
    ) {
      const buttons = [...tab.agentReleases.keys()].reduce(
        (mask, key) => mask | (MOUSE_BUTTONS[key] ?? 0),
        0,
      );
      if (
        params.type === "mouseMoved" ||
        !tab.pointerPosition ||
        tab.pointerPosition.x !== params.x ||
        tab.pointerPosition.y !== params.y
      ) {
        const result = await this.moveAgentPointer(
          tab,
          { x: params.x, y: params.y },
          () => signal?.throwIfAborted(),
          {
            ...params,
            buttons: params.type === "mouseMoved" ? (params.buttons ?? buttons) : buttons,
            button: params.type === "mouseMoved" ? params.button : "none",
          },
        );
        if (params.type === "mouseMoved") return result as T;
      }
      if (params.type === "mousePressed" && !buttons && Number(params.clickCount ?? 1) <= 1) {
        const pointer = { x: params.x, y: params.y, pressed: false, preparingClick: true };
        this.setAgentCursor(tab, pointer);
        try {
          await delay(BROWSER_CLICK_PREPARE_MS, undefined, { signal });
          signal?.throwIfAborted();
          if (tab.state.agentCursor !== pointer) throw new BrowserError("browser-element-stale");
          await beforeDispatch?.();
          beforeDispatch = undefined;
        } finally {
          if (tab.state.agentCursor === pointer)
            this.setAgentCursor(tab, { x: pointer.x, y: pointer.y, pressed: false });
        }
      }
    }
    const cdp = await this.connection();
    await beforeDispatch?.();
    signal?.throwIfAborted();
    if (
      signal &&
      method === "Input.dispatchMouseEvent" &&
      params.button &&
      params.button !== "none"
    ) {
      const key = `mouse:${params.button}`;
      if (params.type === "mousePressed")
        tab.agentReleases.set(key, {
          method,
          params: {
            type: "mouseReleased",
            button: params.button,
            x: params.x,
            y: params.y,
            buttons: 0,
            clickCount: params.clickCount,
          },
        });
      else if (params.type === "mouseReleased") tab.agentReleases.delete(key);
    } else if (signal && method === "Input.dispatchKeyEvent") {
      const key = `key:${params.code || params.key}`;
      if (params.type === "keyDown" || params.type === "rawKeyDown")
        tab.agentReleases.set(key, {
          method,
          params: {
            type: "keyUp",
            key: params.key,
            code: params.code,
            windowsVirtualKeyCode: params.windowsVirtualKeyCode,
            modifiers: 0,
          },
        });
      else if (params.type === "keyUp") tab.agentReleases.delete(key);
    }
    const result = await cdp.send<T>(method, params, tab.cdpSessionId, undefined, signal);
    signal?.throwIfAborted();
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
    event: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const operation = this.agentOperation.getStore();
    const signal = operation?.tab === tab ? operation.signal : undefined;
    const move = async (point: { x: number; y: number }) => {
      current();
      const result = await this.send(
        tab,
        "Input.dispatchMouseEvent",
        {
          ...event,
          type: "mouseMoved",
          ...point,
          buttons: event.buttons ?? 0,
        },
        false,
      );
      current();
      this.setAgentCursor(tab, { ...point, pressed: Number(event.buttons ?? 0) > 0 });
      return result;
    };
    const start = tab.pointerPosition ?? { x: 0, y: 0 };
    if (!tab.pointerPosition) await move(start);
    const trajectory = createPointerTrajectory(start, destination, tab.viewport);
    if (!trajectory.length) return move(destination);
    let result: Record<string, unknown> = {};
    for (const { x, y, delayMs } of trajectory) {
      current();
      await delay(delayMs, undefined, { signal });
      result = await move({ x, y });
    }
    return result;
  }

  private async evaluate(tab: Tab, expression: string): Promise<any> {
    const response = await this.send(tab, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new BrowserError(
        "browser-operation-failed",
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
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
    target?: { targetId: string; sessionId: string },
    threadId?: string,
  ): Promise<Tab> {
    const settings = await this.settings.get();
    signal?.throwIfAborted();
    if (this.tabs.size >= MAX_TABS) throw new BrowserError("browser-operation-failed");
    const tab: Tab = {
      state: {
        id: sessionId,
        projectId,
        ...(threadId ? { threadId } : {}),
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
      targetId: target?.targetId ?? "",
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
      diagnostics: new BrowserDiagnostics(),
      agentOperations: new Set(),
      agentReleases: new Map(),
    };
    this.tabs.set(sessionId, tab);
    if (controlSignal) this.beginAgentControl(tab, controlSignal);
    try {
      await this.connectTab(tab, target);
      if (!target && (url !== "about:blank" || this.external))
        await this.navigate(tab, url, source);
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

  private async connectTab(
    tab: Tab,
    target?: { targetId: string; sessionId: string },
  ): Promise<void> {
    const cdp = await this.connection();
    if (tab.cdpSessionId) return;
    tab.pointerPosition = undefined;
    const restored =
      this.external &&
      tab.targetId &&
      (await cdp.send("Target.getTargetInfo", { targetId: tab.targetId }).catch(() => undefined));
    const { targetId } =
      target ??
      (restored
        ? { targetId: tab.targetId }
        : this.external
          ? await this.external.createTarget()
          : await cdp.send<{ targetId: string }>("Target.createTarget", {
              url: "about:blank",
              // Unrevealed tabs must not background the page the user is currently operating.
              background: [...this.tabs.values()].some((candidate) => candidate.visible),
            }));
    const { sessionId } =
      target ??
      (await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true }));
    tab.targetId = targetId;
    tab.cdpSessionId = sessionId;
    if (this.external)
      await cdp.send("Target.autoAttachRelated", {
        targetId,
        waitForDebuggerOnStart: true,
        filter: [{ type: "page" }],
      });
    await this.send(tab, "Fetch.enable", {
      patterns: [
        { resourceType: "Document", requestStage: "Request" },
        { requestStage: "Response" },
      ],
    });
    await Promise.all([
      this.send(tab, "Page.enable"),
      this.send(tab, "Runtime.enable"),
      // Background tabs otherwise stall native input while waiting for compositor acknowledgements.
      this.send(tab, "Emulation.setFocusEmulationEnabled", { enabled: true }),
      this.send(tab, "DOM.enable"),
      this.send(tab, "Network.enable", {
        maxTotalBufferSize: 8 * 1024 * 1024,
        maxResourceBufferSize: 512 * 1024,
      }),
      this.send(tab, "Log.enable"),
      this.send(tab, "Page.setInterceptFileChooserDialog", { enabled: true }),
      // A paused noopener popup cannot answer renderer commands until it resumes.
      ...(target ? [this.send(tab, "Runtime.runIfWaitingForDebugger")] : []),
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
      const previousTarget = tab.targetId;
      await this.connectTab(tab);
      if (previousTarget !== tab.targetId && tab.state.url !== "about:blank")
        await this.navigate(tab, tab.state.url, "user", true);
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
          2,
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
          format: "jpeg",
          quality: 90,
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
      if (
        opener &&
        ![...this.tabs.values()].some((tab) => tab.targetId === params.targetInfo.targetId)
      ) {
        try {
          const url = normalizeBrowserUrl(
            opener.popupUrls.shift() || params.targetInfo.url || "about:blank",
            false,
            opener.source === "user",
          );
          // Preserve the native opener/preload flow; install navigation interception before resuming.
          const popup = await this.createTab(
            randomUUID(),
            opener.state.projectId,
            url,
            opener.source,
            opener.signal,
            opener.agentControl?.signal,
            { targetId: params.targetInfo.targetId, sessionId: params.sessionId },
            opener.state.threadId,
          );
          this.publish({
            type: "popup",
            session: { ...popup.state },
            openerSessionId: opener.state.id,
          });
        } catch (error) {
          await this.browser
            ?.send("Target.closeTarget", { targetId: params.targetInfo.targetId })
            .catch(() => undefined);
          throw error;
        }
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
    tab.diagnostics.record(event);
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
              mimeType: "image/jpeg",
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
      tab.dialog = {
        type: "dialog",
        sessionId: tab.state.id,
        kind: params.type,
        message: String(params.message).slice(0, 65536),
        defaultPrompt: params.defaultPrompt,
        url: typeof params.url === "string" ? params.url : undefined,
      };
      this.publish(tab.dialog);
    } else if (method === "Page.javascriptDialogClosed") {
      tab.dialogPending = false;
      tab.dialog = undefined;
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
          if (this.external) await this.configureDownloads(await this.settings.get());
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
    const run = () => this.perform(command, options);
    if (
      options.source !== "agent" ||
      !("sessionId" in command) ||
      (OBSERVATION_COMMANDS.has(command.type) && command.type !== "attach")
    )
      return run();
    const key = command.sessionId;
    const operation = (this.mutations.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(run);
    this.mutations.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.mutations.get(key) === operation) this.mutations.delete(key);
    }
  }

  private async perform(
    command: BrowserCommand,
    options: { source?: Source; signal?: AbortSignal; controlSignal?: AbortSignal },
  ): Promise<unknown> {
    const source = options.source ?? "user";
    if (
      source !== "user" &&
      [
        "settings.update",
        "permission.respond",
        "cookies.import",
        "passwords.import",
        "downloads.clear",
        "profiles.list",
        "connection.test",
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
    const tab = sessionId ? this.tabs.get(sessionId) : undefined;
    if (source === "agent" && tab && tab.state.threadId !== command.threadId)
      throw new BrowserError(
        "browser-permission-denied",
        "This tab belongs to another conversation. Use tabs.list to find this conversation's tabs.",
      );
    const mutation =
      !!tab &&
      !OBSERVATION_COMMANDS.has(command.type) &&
      !(source === "user" && command.type === "viewport");
    const operation = source === "agent" && mutation ? new AbortController() : undefined;
    try {
      options.signal?.throwIfAborted();
      if (operation && tab?.state.userControlled) throw new BrowserError("browser-user-active");
      if (operation && tab) tab.agentOperations.add(operation);
      if (tab && controlSignal) this.beginAgentControl(tab, controlSignal);
      if (controlSignal) options.signal?.addEventListener("abort", abortControl, { once: true });
      if (mutation && source === "user") this.recordUserActivity(tab, command);
      if (operation && tab) {
        const signal = AbortSignal.any([
          operation.signal,
          ...(options.signal ? [options.signal] : []),
          ...(controlSignal ? [controlSignal] : []),
        ]);
        return await this.agentOperation.run({ tab, signal, source }, async () => {
          const previous = tab.observation;
          const result = await this.execute(command, source, signal, controlSignal);
          if (!previous || !PAGE_CHANGE_COMMANDS.has(command.type)) return result;
          let pageChanges: unknown;
          try {
            if (tab.dialogPending) pageChanges = { dialog: tab.dialog };
            else {
              const next = await this.snapshot(tab, signal);
              const key = (node: BrowserSnapshotNode) => node.ref ?? `${node.role}:${node.name}`;
              const before = new Map(previous.nodes.map((node) => [key(node), node]));
              const after = new Map(next.nodes.map((node) => [key(node), node]));
              const signature = ({
                bounds: _bounds,
                depth: _depth,
                ...node
              }: BrowserSnapshotNode) => JSON.stringify(node);
              // Keep controls and dialogs ahead of video timers, chat and other changing text.
              const priority = (node: BrowserSnapshotNode) =>
                "ref" in command && node.ref === command.ref
                  ? 0
                  : /^(dialog|alertdialog|alert)$/.test(node.role)
                    ? 1
                    : /^(button|link|checkbox|radio|textbox|combobox|menuitem|tab|switch)$/.test(
                          node.role,
                        )
                      ? 2
                      : 3;
              const relevant = (nodes: BrowserSnapshotNode[]) =>
                nodes.sort((a, b) => priority(a) - priority(b));
              const added = [...after.values()].filter((node) => !before.has(key(node)));
              const changed = [...after.values()].filter(
                (node) =>
                  before.has(key(node)) && signature(before.get(key(node))!) !== signature(node),
              );
              const removed = next.truncated
                ? []
                : [...before.values()].filter((node) => !after.has(key(node)));
              pageChanges = {
                snapshotId: next.snapshotId,
                added: relevant(added).slice(0, 12),
                changed: relevant(changed).slice(0, 12),
                removed: relevant(removed).slice(0, 8),
                truncated:
                  next.truncated || added.length > 12 || changed.length > 12 || removed.length > 8,
              };
            }
          } catch (error) {
            signal.throwIfAborted();
            pageChanges = {
              unavailable: error instanceof BrowserError ? error.code : "browser-operation-failed",
            };
          }
          return result && typeof result === "object" && !Array.isArray(result)
            ? { ...result, pageChanges }
            : { session: { ...tab.state }, result, pageChanges };
        });
      }
      if (tab)
        return await this.agentOperation.run({ tab, signal: options.signal, source }, () =>
          this.execute(command, source, options.signal, controlSignal),
        );
      return await this.agentOperation.exit(() =>
        this.execute(command, source, options.signal, controlSignal),
      );
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("browser-operation-failed");
    } finally {
      if (operation) tab?.agentOperations.delete(operation);
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
      case "profiles.list":
        return listBrowserProfiles(command.userDataDirectory || undefined);
      case "connection.test": {
        const cdp = await this.connection();
        if (this.external) await this.external.profileSession();
        const { product } = await cdp.send("Browser.getVersion");
        return { connected: true, product };
      }
      case "history.list":
        await this.authorize("history", "about:blank", "", source, signal);
        return this.listHistory(command.query ?? "", command.limit ?? 50, signal);
      case "tabs.list": {
        const owned = [...this.tabs.values()]
          .filter((tab) =>
            source === "agent"
              ? !!command.threadId && tab.state.threadId === command.threadId
              : tab.state.projectId === command.projectId,
          )
          .filter(
            (tab) => command.includeInternal !== false || !tab.state.url.startsWith("chrome:"),
          );
        if (source === "agent" || command.scope !== "all")
          return owned.map((tab) => ({ ...tab.state, targetId: tab.state.id, owned: true }));
        const { targetInfos } = await (await this.connection()).send("Target.getTargets");
        return targetInfos
          .filter(
            (target: Record<string, any>) =>
              target.type === "page" &&
              target.targetId !== this.external?.anchorTargetId &&
              (command.includeInternal !== false || !target.url.startsWith("chrome:")),
          )
          .map((target: Record<string, any>) => {
            const tab = owned.find((candidate) => candidate.targetId === target.targetId);
            return {
              ...(tab?.state ?? {}),
              id: tab?.state.id ?? target.targetId,
              targetId: tab?.state.id ?? target.targetId,
              url: target.url,
              title: target.title,
              owned: !!tab,
            };
          });
      }
      case "read-page":
        if (command.url)
          return this.research(
            command.sessionId,
            command.url,
            readPageExpression,
            source,
            signal,
            command.threadId,
          );
        break;
      case "web-search": {
        const url = new URL("https://www.google.com/search");
        url.searchParams.set("q", command.query);
        url.searchParams.set("num", String(command.limit ?? 10));
        const result = await this.research(
          command.sessionId,
          url.href,
          `${searchExpression}(${command.limit ?? 10})`,
          source,
          signal,
          command.threadId,
        );
        return { ...result, query: command.query, engine: "google" };
      }
      case "settings.get":
        return this.settings.get();
      case "settings.update": {
        const previous = await this.settings.get();
        const connectionChanged = (
          ["connection", "chromeEndpoint", "chromeUserDataDirectory", "chromeProfile"] as const
        ).some((key) => command.patch[key] !== undefined && command.patch[key] !== previous[key]);
        if (connectionChanged && this.tabs.size)
          throw new BrowserError("browser-connection-active");
        const settings = await this.settings.update(command.patch);
        if (connectionChanged) {
          ++this.connectionGeneration;
          if (this.passwordTargetId)
            await this.browser
              ?.send("Target.closeTarget", { targetId: this.passwordTargetId })
              .catch(() => undefined);
          if (this.external) await this.external.close();
          else this.browser?.dispose();
          this.external = undefined;
          this.browser = undefined;
          this.starting = undefined;
          this.passwordTarget = undefined;
          this.passwordTargetId = undefined;
        } else if (
          this.browser &&
          (command.patch.downloadDirectory !== undefined || !this.external)
        )
          await this.configureDownloads(settings);
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
        const cdp = await this.connection();
        if (this.external)
          await cdp.send("Network.setCookies", { cookies }, await this.external.profileSession());
        else await cdp.send("Storage.setCookies", { cookies });
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
        if (
          existing &&
          source === "user" &&
          command.threadId !== undefined &&
          existing.state.threadId !== command.threadId
        )
          this.update(existing, { threadId: command.threadId });
        const tab = existing
          ? await this.requireTab(command.sessionId)
          : await this.createTab(
              command.sessionId,
              command.projectId,
              normalizeBrowserUrl(command.url ?? "about:blank", false, source === "user"),
              source,
              signal,
              controlSignal,
              undefined,
              command.threadId,
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
      case "snapshot": {
        const snapshot = await this.snapshot(tab, signal, command.query);
        return command.includeScreenshot
          ? { ...snapshot, screenshot: await this.capture(tab, false) }
          : snapshot;
      }
      case "page-info":
        return tab.dialogPending
          ? { session: { ...tab.state }, dialog: tab.dialog }
          : { session: { ...tab.state }, ...(await this.evaluate(tab, pageInfoExpression)) };
      case "tabs.current":
        return { ...tab.state };
      case "tabs.switch":
        await this.send(tab, "Page.bringToFront");
        return { ...tab.state };
      case "wait":
        await delay(command.seconds * 1000, undefined, { signal });
        return { seconds: command.seconds };
      case "wait-for":
      case "wait-for-load": {
        const expression =
          command.type === "wait-for-load"
            ? "document.readyState === 'complete'"
            : command.selector !== undefined
              ? `Boolean(document.querySelector(${JSON.stringify(command.selector)})) === ${!command.gone}`
              : `(document.body?.innerText || '').includes(${JSON.stringify(command.text)}) === ${!command.gone}`;
        return this.waitFor(
          tab,
          expression,
          command.timeout ?? (command.type === "wait-for-load" ? 15 : 5),
          signal,
        );
      }
      case "console":
        return tab.diagnostics.console(command);
      case "network": {
        const result = tab.diagnostics.network(command);
        if (command.includeResponseBodies) {
          const cdp = await this.connection();
          let remaining = 200000;
          for (const request of result.requests) {
            signal?.throwIfAborted();
            if (!request.finished || request.failed || request.redirected || remaining <= 0)
              continue;
            try {
              const body = await cdp.send(
                "Network.getResponseBody",
                { requestId: request.requestId },
                tab.cdpSessionId,
                5000,
                signal,
              );
              const text = body.base64Encoded
                ? Buffer.from(body.body, "base64").toString("utf8")
                : String(body.body);
              request.body = text.slice(0, Math.min(50000, remaining));
              request.bodyTruncated = text.length > request.body.length;
              remaining -= request.body.length;
            } catch {
              signal?.throwIfAborted();
              request.body = null;
            }
          }
        }
        return result;
      }
      case "read-page":
        return { session: { ...tab.state }, ...(await this.evaluate(tab, readPageExpression)) };
      case "evaluate": {
        if (!(await this.settings.get()).fullCdpAccess)
          throw new BrowserError("browser-permission-denied");
        let contextId;
        if (command.frameId) {
          if (!tab.frameIds.has(command.frameId)) throw new BrowserError("browser-invalid");
          ({ executionContextId: contextId } = await this.send(tab, "Page.createIsolatedWorld", {
            frameId: command.frameId,
            worldName: "workbench-browser-script",
          }));
        }
        const result = await this.send(tab, "Runtime.evaluate", {
          expression: /^\s*return\b/.test(command.expression)
            ? `(() => { ${command.expression} })()`
            : command.expression,
          contextId,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw new BrowserError(
            "browser-operation-failed",
            result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
          );
        return {
          session: { ...tab.state },
          value: result.result?.value ?? result.result?.unserializableValue,
        };
      }
      case "click":
        if ("x" in command) {
          await tab.viewportOperation;
          const { cssVisualViewport: viewport } = await this.send(tab, "Page.getLayoutMetrics");
          if (command.x >= viewport.clientWidth || command.y >= viewport.clientHeight)
            throw new BrowserError(
              "browser-invalid",
              "Click coordinates are outside the viewport. Use CSS coordinates from a current viewport screenshot.",
            );
          const current = () => signal?.throwIfAborted();
          const position = { x: command.x, y: command.y };
          tab.source = source;
          if (source === "user") tab.signal = undefined;
          tab.navigationBlocked = false;
          if (source === "agent") await this.moveAgentPointer(tab, position, current);
          await this.clickAt(tab, position, source, current);
          return { ...tab.state };
        }
        return this.interact(tab, command, source, signal);
      case "fill":
      case "select":
      case "set-checked":
      case "focus":
      case "dispatch-key":
        return this.interact(tab, command, source, signal);
      case "fill-form": {
        const results = [];
        for (const field of command.fields) {
          signal?.throwIfAborted();
          try {
            const result = await this.interact(
              tab,
              typeof field.value === "boolean"
                ? {
                    type: "set-checked",
                    sessionId: command.sessionId,
                    ref: field.ref,
                    checked: field.value,
                  }
                : { type: "fill", sessionId: command.sessionId, ref: field.ref, text: field.value },
              source,
              signal,
            );
            results.push({ ref: field.ref, ...result.field });
          } catch (error) {
            signal?.throwIfAborted();
            results.push({
              ref: field.ref,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return {
          session: { ...tab.state },
          results,
          completed: results.filter((result) => result.ok).length,
        };
      }
      case "type": {
        const editable = await this.evaluate(
          tab,
          `(() => { let el = document.activeElement; while(el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return !!el && !el.matches(':disabled') && !el.readOnly && (el.isContentEditable || ['INPUT','TEXTAREA','IFRAME'].includes(el.tagName)); })()`,
        );
        if (!editable)
          throw new BrowserError(
            "browser-element-not-interactable",
            "Focus an editable element before typing.",
          );
        tab.source = source;
        await this.send(tab, "Input.insertText", { text: command.text });
        return { ...tab.state };
      }
      case "press-key": {
        tab.source = source;
        const event = keyEvent(command.key, command.modifiers);
        const text =
          command.key.length === 1 && !((command.modifiers ?? 0) & 7) ? command.key : undefined;
        await this.send(tab, "Input.dispatchKeyEvent", {
          ...event,
          type: "keyDown",
          ...(text ? { text, unmodifiedText: text } : {}),
        });
        await this.send(tab, "Input.dispatchKeyEvent", { ...event, type: "keyUp" });
        return { ...tab.state };
      }
      case "scroll": {
        const { cssVisualViewport: viewport } = await this.send(tab, "Page.getLayoutMetrics");
        const x = command.x ?? viewport.clientWidth / 2,
          y = command.y ?? viewport.clientHeight / 2;
        if (x >= viewport.clientWidth || y >= viewport.clientHeight)
          throw new BrowserError("browser-invalid");
        await this.send(tab, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x,
          y,
          deltaX: command.deltaX ?? 0,
          deltaY: command.deltaY,
        });
        return { ...tab.state };
      }
      case "drag": {
        const { cssVisualViewport: viewport } = await this.send(tab, "Page.getLayoutMetrics");
        if (
          Math.max(command.fromX, command.toX) >= viewport.clientWidth ||
          Math.max(command.fromY, command.toY) >= viewport.clientHeight
        )
          throw new BrowserError("browser-invalid");
        const current = () => signal?.throwIfAborted();
        tab.source = source;
        await this.moveAgentPointer(tab, { x: command.fromX, y: command.fromY }, current);
        await this.send(tab, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: command.fromX,
          y: command.fromY,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        const data = command.dataTransfer && {
          items: Object.entries(command.dataTransfer).map(([mimeType, data]) => ({
            mimeType,
            data,
          })),
          dragOperationsMask: 1,
        };
        if (data)
          await this.send(tab, "Input.dispatchDragEvent", {
            type: "dragEnter",
            x: command.fromX,
            y: command.fromY,
            data,
          });
        for (const { x, y, delayMs } of createPointerTrajectory(
          { x: command.fromX, y: command.fromY },
          { x: command.toX, y: command.toY },
          { width: viewport.clientWidth, height: viewport.clientHeight },
        )) {
          await delay(delayMs, undefined, { signal });
          const point = { x, y };
          if (data)
            await this.send(tab, "Input.dispatchDragEvent", { type: "dragOver", ...point, data });
          else
            await this.send(
              tab,
              "Input.dispatchMouseEvent",
              {
                type: "mouseMoved",
                ...point,
                button: "left",
                buttons: 1,
              },
              false,
            );
          tab.pointerPosition = point;
          if (source === "agent") this.setAgentCursor(tab, { ...point, pressed: true });
        }
        if (data)
          await this.send(tab, "Input.dispatchDragEvent", {
            type: "drop",
            x: command.toX,
            y: command.toY,
            data,
          });
        await this.send(tab, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: command.toX,
          y: command.toY,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
        if (source === "agent")
          this.setAgentCursor(tab, { x: command.toX, y: command.toY, pressed: false });
        return { ...tab.state };
      }
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
            pressed:
              input.type === "mousePressed" ||
              (input.buttons ??
                (input.type === "mouseMoved" && tab.state.agentCursor?.pressed ? 1 : 0)) > 0,
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
          return await this.capture(tab, command.fullPage === true, command);
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
      case "download.configure": {
        await this.authorize("download", tab.state.url, tab.state.id, source, signal);
        if (command.directory !== undefined && !path.isAbsolute(command.directory))
          throw new BrowserError("browser-invalid");
        await this.configureDownloads({
          ...(await this.settings.get()),
          ...(command.directory === undefined ? {} : { downloadDirectory: command.directory }),
        });
        return { session: { ...tab.state }, directory: this.downloadDirectory };
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
        if (source === "agent" && /^(Browser|Target)\./.test(command.method))
          throw new BrowserError(
            "browser-permission-denied",
            "Browser-wide CDP commands are unavailable to agents. Use this conversation's tab tools.",
          );
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
              (typeof command.params.buttons === "number"
                ? command.params.buttons > 0
                : command.params.type === "mouseMoved" && !!tab.state.agentCursor?.pressed),
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

  private async waitFor(tab: Tab, expression: string, seconds: number, signal?: AbortSignal) {
    const start = Date.now();
    const deadline = AbortSignal.timeout(Math.max(1, Math.round(seconds * 1000)));
    const bounded = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
    try {
      return await this.agentOperation.run(
        { tab, signal: bounded, source: this.agentOperation.getStore()?.source ?? "user" },
        async () => {
          while (true) {
            bounded.throwIfAborted();
            if (tab.dialogPending)
              throw new BrowserError(
                "browser-operation-failed",
                "A page dialog is open. Use dialog.respond first.",
              );
            try {
              if (await this.evaluate(tab, expression))
                return { matched: true, elapsedMs: Date.now() - start };
            } catch (error) {
              bounded.throwIfAborted();
              if (tab.state.status !== "loading") throw error;
            }
            await delay(50, undefined, { signal: bounded });
          }
        },
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (deadline.aborted)
        throw new BrowserError(
          "browser-operation-failed",
          `Timed out after ${seconds} seconds waiting for the page condition.`,
        );
      throw error;
    }
  }

  private async research(
    sessionId: string,
    url: string,
    expression: string,
    source: Source,
    signal?: AbortSignal,
    threadId?: string,
  ) {
    const parent = this.tabs.get(sessionId);
    const tab = await this.createTab(
      randomUUID(),
      parent?.state.projectId ?? sessionId,
      normalizeBrowserUrl(url),
      source,
      signal,
      undefined,
      undefined,
      threadId,
    );
    try {
      return await this.agentOperation.run({ tab, signal, source }, async () => {
        await this.waitFor(tab, "document.readyState === 'complete'", 15, signal);
        return await this.evaluate(tab, expression);
      });
    } finally {
      await this.agentOperation.exit(() => this.closeTab(tab));
    }
  }

  private async snapshot(tab: Tab, signal?: AbortSignal, query = ""): Promise<BrowserSnapshot> {
    const search = query.trim().toLowerCase();
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
    const snapshot = (tab.snapshot ??= {
      id: randomUUID(),
      frames: new Map(),
      refs: new Map(),
      refsByNode: new Map(),
    });
    const snapshotId = randomUUID();
    const current = () => {
      signal?.throwIfAborted();
      if (tab.snapshot !== snapshot || tab.state.url !== url)
        throw new BrowserError("browser-element-stale");
    };
    const readFrame = async (
      frameId: string,
      owner?: { backendNodeId: number; contextId: number },
    ) => {
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
        tab.frameIds.add(frameId);
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
        const name = String(node.name?.value ?? "");
        const properties = new Map<string, unknown>(
          (node.properties ?? []).map((property: Record<string, any>) => [
            property.name,
            property.value?.value,
          ]),
        );
        // Empty layout wrappers consume the budget without identifying a target.
        const layoutOnly =
          ["generic", "none", "presentation"].includes(role) &&
          !name.trim() &&
          !node.value &&
          !["focusable", "editable", "disabled", "selected", "expanded", "checked"].some((key) =>
            properties.has(key),
          );
        let item: BrowserSnapshotNode | undefined;
        if (
          !node.ignored &&
          role &&
          role !== "InlineTextBox" &&
          !layoutOnly &&
          (!search || name.toLowerCase().includes(search) || frame)
        ) {
          if (nodes.length >= 1000 || characters >= 65536) {
            truncated = true;
            return;
          }
          item = {
            depth,
            role,
            name: name.slice(0, 2048),
          };
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
            item.ref = this.elementRef(snapshot, {
              backendNodeId: node.backendDOMNodeId,
              frameId,
              contextId,
            });
            item.frameId = frameId;
            if (properties.get("focusable") === true || properties.has("editable")) {
              const boxes = await this.send(tab, "DOM.getBoxModel", {
                backendNodeId: node.backendDOMNodeId,
              }).catch(() => undefined);
              const quad = boxes?.model?.content as number[] | undefined;
              if (quad?.length === 8 && quad.every(Number.isFinite)) {
                const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
                const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
                item.bounds = {
                  x: Math.min(...xs),
                  y: Math.min(...ys),
                  width: Math.max(...xs) - Math.min(...xs),
                  height: Math.max(...ys) - Math.min(...ys),
                };
              }
            }
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
    const observation = { session: { ...tab.state }, snapshotId, nodes, truncated };
    if (!search) tab.observation = observation;
    return observation;
  }

  private elementRef(snapshot: Snapshot, reference: SnapshotReference): string {
    const key = `${reference.frameId}:${reference.backendNodeId}`;
    const ref = snapshot.refsByNode.get(key) ?? `e${++this.referenceSequence}`;
    snapshot.refsByNode.set(key, ref);
    snapshot.refs.set(ref, reference);
    // ponytail: retain 10,000 refs per document; evicted refs require another observation.
    if (snapshot.refs.size > 10000) {
      const oldest = snapshot.refs.keys().next().value!;
      const node = snapshot.refs.get(oldest)!;
      snapshot.refs.delete(oldest);
      snapshot.refsByNode.delete(`${node.frameId}:${node.backendNodeId}`);
    }
    return ref;
  }

  private async resolveElement(
    tab: Tab,
    target: BrowserElementTarget,
    signal?: AbortSignal,
  ): Promise<string> {
    if (target.ref) return target.ref;
    const frameId = ("frameId" in target ? target.frameId : undefined) ?? tab.frameId;
    if (!frameId || !tab.frameIds.has(frameId)) throw new BrowserError("browser-element-stale");
    const snapshot = (tab.snapshot ??= {
      id: randomUUID(),
      frames: new Map(),
      refs: new Map(),
      refsByNode: new Map(),
    });
    const { executionContextId } = await this.send(tab, "Page.createIsolatedWorld", {
      frameId,
      worldName: "workbench-browser-observation",
    });
    snapshot.frames.set(frameId, executionContextId);
    const resolved = await this.send(tab, "Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(target.selector)})`,
      contextId: executionContextId,
    });
    const objectId = resolved.result?.objectId;
    if (!objectId)
      throw new BrowserError(
        "browser-element-not-interactable",
        "The selector did not match an element.",
      );
    try {
      const { node } = await this.send(tab, "DOM.describeNode", { objectId });
      signal?.throwIfAborted();
      if (tab.snapshot !== snapshot) throw new BrowserError("browser-element-stale");
      return this.elementRef(snapshot, {
        backendNodeId: node.backendNodeId,
        frameId,
        contextId: executionContextId,
      });
    } finally {
      void this.agentOperation
        .exit(() => this.send(tab, "Runtime.releaseObject", { objectId }))
        .catch(() => undefined);
    }
  }

  private async interact(
    tab: Tab,
    command: Exclude<
      Extract<
        BrowserCommand,
        { type: "click" | "fill" | "select" | "set-checked" | "focus" | "dispatch-key" }
      >,
      { x: number }
    >,
    source: Source,
    signal?: AbortSignal,
  ): Promise<
    BrowserSessionState & {
      field?: Record<string, unknown>;
      target?: Record<string, unknown>;
    }
  > {
    const ref = await this.resolveElement(tab, command, signal);
    const snapshot = tab.snapshot;
    const reference = snapshot?.refs.get(ref);
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
      current();
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
        void this.agentOperation
          .exit(() => this.send(tab, "Runtime.releaseObject", { objectId: target.object.objectId }))
          .catch(() => undefined);
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
      current();
      await this.send(tab, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
      current();
      /* Native click remains compositor-driven, including hit testing and user takeover. */
      {
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
        const ready = async () => {
          current();
          const metrics = await this.send(tab, "Page.getLayoutMetrics");
          if (!(await hitTest(position, metrics.cssVisualViewport)))
            throw new BrowserError(
              "browser-element-not-interactable",
              "Hovering changed or covered the target. Inspect a screenshot before retrying.",
            );
        };
        if (source === "agent") {
          await this.moveAgentPointer(tab, position, current);
          if (command.type !== "click") await ready();
        }
        if (command.type !== "click") {
          const response = await call(elementAction, [
            {
              value: {
                ...command,
                ...("key" in command ? keyEvent(command.key, command.modifiers) : {}),
              },
            },
          ]);
          current();
          const field = response.result?.value;
          if (response.exceptionDetails || !field?.ok)
            throw new BrowserError(
              "browser-element-not-interactable",
              field?.error ??
                response.exceptionDetails?.exception?.description ??
                "The field did not accept the operation.",
            );
          return { ...tab.state, field };
        }
        await this.clickAt(tab, position, source, source === "agent" ? ready : current);
      }
      if (tab.dialogPending || tab.snapshot !== snapshot)
        return { ...tab.state, target: { ref, unavailable: true } };
      const target = await call(
        "function() { return { connected: this.isConnected, visible: this.isConnected && this.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) }; }",
      )
        .then(({ result, exceptionDetails }) =>
          exceptionDetails || !result?.value ? { unavailable: true } : result.value,
        )
        .catch(() => ({ unavailable: true }));
      signal?.throwIfAborted();
      return { ...tab.state, target: { ref, ...target } };
    } finally {
      void this.agentOperation
        .exit(() => this.send(tab, "Runtime.releaseObject", { objectId }))
        .catch(() => undefined);
    }
  }

  private async clickAt(
    tab: Tab,
    { x, y }: { x: number; y: number },
    source: Source,
    current: () => void | Promise<void>,
  ): Promise<void> {
    const revision = tab.state.revision;
    for (const type of ["mousePressed", "mouseReleased"] as const) {
      await this.send(
        tab,
        "Input.dispatchMouseEvent",
        { type, x, y, button: "left", clickCount: 1 },
        true,
        type === "mousePressed" ? current : undefined,
      );
      if (source === "agent" && tab.state.revision === revision)
        this.setAgentCursor(tab, { x, y, pressed: type === "mousePressed" });
    }
  }

  private file(name: string, mimeType: string, data: unknown): BrowserFile {
    if (typeof data !== "string") throw new BrowserError("browser-operation-failed");
    if (Buffer.byteLength(data, "base64") > MAX_FILE_BYTES)
      throw new BrowserError("browser-file-too-large");
    return { name, mimeType, data };
  }

  private async capture(
    tab: Tab,
    fullPage: boolean,
    options: { format?: "png" | "jpeg"; quality?: number; maxDim?: number } = {},
  ): Promise<BrowserFile> {
    await tab.viewportOperation;
    const agent = this.agentOperation.getStore()?.source === "agent";
    const maxDim = options.maxDim ?? (agent ? 1600 : undefined);
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
    const scale = maxDim
      ? Math.min(1, maxDim / (Math.max(capture.width, capture.height) * tab.deviceScaleFactor))
      : 1;
    if (scale < 1)
      clip = {
        x: fullPage ? 0 : metrics.cssVisualViewport.pageX,
        y: fullPage ? 0 : metrics.cssVisualViewport.pageY,
        ...capture,
        scale,
      };
    if (
      capture.width * tab.deviceScaleFactor * scale > 16384 ||
      capture.height * tab.deviceScaleFactor * scale > 16384 ||
      capture.width * capture.height * (tab.deviceScaleFactor * scale) ** 2 > 50_000_000
    )
      throw new BrowserError("browser-file-too-large");
    const format = options.format ?? (agent ? "jpeg" : "png");
    const result = await this.send(tab, "Page.captureScreenshot", {
      format,
      ...(format === "jpeg" ? { quality: options.quality ?? 80 } : {}),
      captureBeyondViewport: fullPage,
      ...(clip ? { clip } : {}),
    });
    const file = this.file(
      `${fileName(tab.state.title)}.${format}`,
      `image/${format}`,
      result.data,
    );
    const bytes = Buffer.from(file.data, "base64");
    let pixels;
    if (format === "png" && bytes.length >= 24)
      pixels = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    else {
      // Chrome emits baseline/progressive JPEG; read its SOF dimensions without recompressing it.
      for (let offset = 2; offset + 9 < bytes.length;) {
        const marker = bytes.readUInt16BE(offset);
        const length = bytes.readUInt16BE(offset + 2);
        if ([0xffc0, 0xffc1, 0xffc2].includes(marker)) {
          pixels = {
            width: bytes.readUInt16BE(offset + 7),
            height: bytes.readUInt16BE(offset + 5),
          };
          break;
        }
        if (length < 2 || offset + 2 + length > bytes.length) break;
        offset += 2 + length;
      }
    }
    if (!pixels)
      throw new BrowserError(
        "browser-operation-failed",
        "Chrome returned an unreadable screenshot.",
      );
    return {
      ...file,
      viewport,
      capture,
      pixels,
    };
  }

  private async upload(
    tab: Tab,
    command: Extract<BrowserCommand, { type: "upload" }>,
    source: Source,
  ): Promise<void> {
    let request;
    if ("requestId" in command) request = tab.fileRequests.get(command.requestId);
    else {
      const ref = await this.resolveElement(tab, command, tab.signal);
      const reference = tab.snapshot?.refs.get(ref);
      if (!reference) throw new BrowserError("browser-element-stale");
      const { node } = await this.send(tab, "DOM.describeNode", {
        backendNodeId: reference.backendNodeId,
      });
      const attributes: string[] = node.attributes ?? [];
      const attribute = (name: string) =>
        attributes.find((_, i) => i % 2 === 1 && attributes[i - 1] === name);
      if (node.localName !== "input" || attribute("type")?.toLowerCase() !== "file")
        throw new BrowserError("browser-element-not-interactable");
      request = { nodeId: reference.backendNodeId, multiple: attribute("multiple") !== undefined };
    }
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
      if ("requestId" in command) tab.fileRequests.delete(command.requestId);
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
    const { targetId } = this.external
      ? await this.external.createTarget()
      : await cdp.send("Target.createTarget", {
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
      const { targetId } = this.external
        ? await this.external.createTarget()
        : await cdp.send("Target.createTarget", {
            url: "chrome://password-manager/settings",
            background: true,
          });
      this.passwordTargetId = targetId;
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      if (this.external)
        await cdp.send("Page.navigate", { url: "chrome://password-manager/settings" }, sessionId);
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
    if (this.external && !tab) return;
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
    this.agentOperation.getStore()?.signal?.throwIfAborted();
    clearTimeout(tab.userActivityTimer);
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
    const targets = [...this.tabs.values()].map((tab) => tab.targetId).filter(Boolean);
    if (this.passwordTargetId) targets.push(this.passwordTargetId);
    for (const tab of this.tabs.values())
      for (const directory of tab.uploadDirectories)
        void rm(directory, { recursive: true, force: true }).catch(() => undefined);
    for (const tab of this.tabs.values()) {
      clearTimeout(tab.userActivityTimer);
      this.clearAgentControl(tab);
    }
    this.tabs.clear();
    this.listeners.clear();
    if (this.external) {
      const external = this.external;
      void Promise.allSettled(
        targets.map((targetId) => external.cdp.send("Target.closeTarget", { targetId })),
      )
        .then(() => external.close())
        .catch(() => external.cdp.dispose());
    } else this.browser?.dispose();
  }
}
