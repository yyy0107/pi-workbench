const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { packagedChildEnvironment } = require("../src/packaged-runtime-lifecycle.cjs");
const {
  DEFAULTS,
  readDesktopSettings,
  validatePreferences,
  applyRuntimeTerminalShell,
  proxyEnvironment,
  createDesktopServices,
  runtimeHasActiveTasks,
} = require("../src/desktop-services.cjs");

test("update installation checks authoritative and hidden task activity and treats errors as busy", async () => {
  const connection = { httpOrigin: "http://127.0.0.1:1234", accessToken: "test-only" };
  const result = (value) => async (url, options) => {
    assert.equal(url, "http://127.0.0.1:1234/api/session.list");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    return Response.json({ result: { ok: true, value } });
  };
  assert.equal(
    await runtimeHasActiveTasks(connection, result({ items: [{ running: false }] })),
    false,
  );
  assert.equal(
    await runtimeHasActiveTasks(
      connection,
      result({ items: [], runningSessionIds: ["hidden-task"] }),
    ),
    true,
  );
  assert.equal(
    await runtimeHasActiveTasks(
      connection,
      result({ items: [{ running: false, waitingForUserInput: true }] }),
    ),
    true,
  );
  assert.equal(
    await runtimeHasActiveTasks(connection, async () => {
      throw new Error("offline");
    }),
    true,
  );
});

test("shell RPC requires an authenticated, matching Runtime acknowledgement", async () => {
  const connection = { httpOrigin: "http://127.0.0.1:1234", accessToken: "test-only" };
  await applyRuntimeTerminalShell(connection, "wsl", async (url, options) => {
    assert.equal(url, `${connection.httpOrigin}/api/terminal.setDefaultShell`);
    assert.equal(options.headers.Authorization, "Bearer test-only");
    const request = JSON.parse(options.body);
    assert.deepEqual(request.payload, { shell: "wsl" });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { shell: "wsl" } },
    });
  });
  await assert.rejects(applyRuntimeTerminalShell(undefined, "wsl"), /terminal-shell-unavailable/);
  await assert.rejects(
    applyRuntimeTerminalShell(connection, "wsl", async () =>
      Response.json({ result: { ok: true, value: { shell: "wsl" } } }),
    ),
    /terminal-shell-unavailable/,
  );
});

test("shell settings serialize live application, retain failures for retry, and start with the latest saved profile", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-shell-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map();
  const events = [];
  const calls = [];
  let fail = false;
  let release;
  let blocked = false;
  const app = { isPackaged: false, getPath: () => directory, getVersion: () => "test" };
  const service = createDesktopServices(
    {
      app,
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      Notification: { isSupported: () => false },
      powerSaveBlocker: {},
    },
    {
      settings: readDesktopSettings(app),
      platform: "win32",
      isTrusted: () => true,
      getWindow: () => ({ webContents: { send: (_channel, value) => events.push(value) } }),
      async applyTerminalShell(shell) {
        calls.push(shell);
        if (blocked)
          await new Promise((resolve) => {
            release = resolve;
          });
        if (fail) throw new Error("offline");
      },
    },
  );
  t.after(() => service.dispose());
  const settings = (patch) => handlers.get("workbench:desktop-settings")({}, patch);
  await service.synchronizeTerminalShell();
  assert.equal(settings().terminalShellStatus, "applied");
  blocked = true;
  const first = settings({ terminalShell: "command-prompt" });
  const second = settings({ terminalShell: "wsl" });
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["powershell", "command-prompt"]);
  assert.equal(settings().terminalShellStatus, "applying");
  assert.equal(readDesktopSettings(app).preferences.terminalShell, "command-prompt");
  blocked = false;
  release();
  assert.equal((await first).preferences.terminalShell, "command-prompt");
  assert.equal((await second).preferences.terminalShell, "wsl");
  assert.equal(settings().restartRequired, false);
  assert.equal(service.environment.PI_WORKBENCH_TERMINAL_SHELL_PROFILE, "wsl");
  fail = true;
  assert.equal((await settings({ terminalShell: "git-bash" })).terminalShellStatus, "failed");
  assert.equal(readDesktopSettings(app).preferences.terminalShell, "git-bash");
  fail = false;
  assert.equal((await settings({ terminalShell: "git-bash" })).terminalShellStatus, "applied");
  await service.synchronizeTerminalShell(); // The same handshake after a Runtime restart.
  assert.deepEqual(calls, [
    "powershell",
    "command-prompt",
    "wsl",
    "git-bash",
    "git-bash",
    "git-bash",
  ]);
  assert.equal(service.environment.PI_WORKBENCH_TERMINAL_SHELL_PROFILE, "git-bash");
  assert.ok(events.some((event) => event.terminalShellStatus === "failed"));
});

test("desktop settings apply power, secure credentials, activity notifications and guarded update installation", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map();
  const notifications = [];
  const events = [];
  const power = [];
  let installed = 0;
  let stopped = 0;
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL(value) {
      this.feed = value;
    },
    async checkForUpdates() {},
    quitAndInstall() {
      installed++;
    },
  });
  const app = { isPackaged: true, getPath: () => directory, getVersion: () => "0.1.0" };
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      notifications.push(options);
    }
    show() {
      this.emit("show");
      this.emit("show"); // A repeated OS event must not play the tone twice.
    }
    close() {}
  }
  let proxy;
  const service = createDesktopServices(
    {
      app,
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
      session: {
        defaultSession: {
          async setProxy(value) {
            proxy = value;
          },
        },
      },
      powerSaveBlocker: {
        start: (kind) => {
          power.push(kind);
          return 1;
        },
        stop: (id) => power.push(id),
      },
      Notification,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().slice(10),
      },
      dialog: {
        showMessageBox: async () => ({ response: 0 }),
        showErrorBox: (_title, message) => events.push(["runtime-error", message]),
      },
    },
    {
      settings: readDesktopSettings(app),
      isTrusted: (event) => event.trusted,
      getWindow: () => ({ webContents: { send: (...args) => events.push(args) } }),
      beforeInstall: async () => {
        stopped++;
      },
      getUpdater: () => updater,
      hasActiveTasks: async () => false,
    },
  );
  t.after(() => service.dispose());
  const call = (channel, payload) =>
    handlers.get(`workbench:desktop-${channel}`)({ trusted: true }, payload);
  assert.throws(() => handlers.get("workbench:desktop-settings")({}, {}), /untrusted/);
  call("update-token", "example-test-token");
  assert.equal(call("settings").tokenConfigured, true);
  assert.equal(call("settings").platform, process.platform);
  assert.equal(
    (await call("settings", { terminalShell: "command-prompt" })).restartRequired,
    false,
  );
  assert.equal(readDesktopSettings(app).preferences.terminalShell, "command-prompt");
  assert.ok(
    !fs
      .readFileSync(path.join(directory, "desktop-settings.json"), "utf8")
      .includes("example-test-token"),
  );
  await service.start();
  await new Promise(setImmediate);
  assert.deepEqual(proxy, { mode: "system" });
  await call("settings", { keepAwake: true, notificationSounds: false });
  assert.deepEqual(power, ["prevent-app-suspension"]);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.feed.owner, "yyy0107");
  assert.equal(updater.feed.repo, "pi-workbench");
  assert.equal(
    updater.feed.updateProvider.prototype.getChannelFilePrefix(),
    `-${process.platform}-${process.arch}${process.platform === "linux" ? "-glibc" : ""}`,
  );
  const task = {
    id: "task",
    title: "Test",
    running: true,
    waiting: false,
    completed: false,
    failed: false,
  };
  call("task-state", { locale: "zh-CN", tasks: [task] });
  service.showRuntimeError(new Error("test failure"));
  assert.match(events.at(-1)[1], /本地服务不可用/u);
  assert.match(events.at(-1)[1], /重启本地服务/u);
  assert.match(events.at(-1)[1], /test failure/u);
  await call("settings", { automaticUpdates: true });
  updater.emit("update-downloaded", { version: "0.2.0" });
  await new Promise(setImmediate);
  assert.equal(installed, 0);
  await call("update", "install"); // Busy and declined.
  assert.equal(stopped, 0);
  call("task-state", {
    locale: "zh-CN",
    tasks: [{ ...task, running: false, completed: true }],
  });
  call("task-state", {
    locale: "zh-CN",
    tasks: [{ ...task, running: false, completed: true }],
  });
  assert.deepEqual(notifications, [{ title: "任务已完成", body: "Test", silent: true }]);
  const soundEvents = () =>
    events.filter(([channel]) => channel === "workbench:desktop-notification-sound");
  assert.deepEqual(soundEvents(), []);
  for (const sound of ["chime", "soft", "bell", "droplet"]) {
    await call("settings", { notificationSounds: true, notificationSound: sound });
    assert.equal(readDesktopSettings(app).preferences.notificationSound, sound);
    call("task-state", { locale: "zh-CN", tasks: [task] });
    call("task-state", {
      locale: "zh-CN",
      tasks: [{ ...task, running: false, completed: true }],
    });
  }
  assert.deepEqual(
    soundEvents().map(([, sound]) => sound),
    ["chime", "soft", "bell", "droplet"],
  );
  assert.ok(notifications.every((notification) => notification.silent));
  await call("settings", { notificationSounds: false });
  call("task-state", { locale: "zh-CN", tasks: [task] });
  call("task-state", {
    locale: "zh-CN",
    tasks: [{ ...task, running: false, completed: true }],
  });
  assert.equal(soundEvents().length, 4);
  const countBeforeOutgoingMessage = notifications.length;
  call("task-state", { locale: "zh-CN", tasks: [task] });
  call("task-state", { locale: "zh-CN", tasks: [{ ...task, running: false }] });
  assert.equal(notifications.length, countBeforeOutgoingMessage);
  await call("settings", { notificationSounds: true, taskNotifications: false });
  const count = notifications.length;
  call("task-state", { locale: "zh-CN", tasks: [task] });
  call("task-state", {
    locale: "zh-CN",
    tasks: [{ ...task, running: false, completed: true }],
  });
  assert.equal(notifications.length, count);
  assert.equal(soundEvents().length, 4);
  await call("update", "install");
  assert.equal(stopped, 1);
  assert.equal(installed, 1);
});

test("task notifications are dismissed when read or clicked without clearing other unread tasks", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-notifications-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map();
  const notifications = [];
  const events = [];
  const app = { getPath: () => directory, getVersion: () => "test" };
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor() {
      super();
      this.closeCount = 0;
      notifications.push(this);
    }
    show() {}
    close() {
      this.closeCount++;
      // Electron does not guarantee a close event after programmatic dismissal.
    }
  }
  const service = createDesktopServices(
    {
      app,
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      Notification,
      powerSaveBlocker: {},
    },
    {
      settings: readDesktopSettings(app),
      isTrusted: () => true,
      getWindow: () => ({
        show: () => events.push("show"),
        focus: () => events.push("focus"),
        webContents: { send: (...args) => events.push(args) },
      }),
    },
  );
  t.after(() => service.dispose());
  const sync = (tasks) =>
    handlers.get("workbench:desktop-task-state")(
      {},
      {
        locale: "en-US",
        tasks: tasks.map((task) => ({ ...task })),
      },
    );
  const tasks = ["completed", "failed", "waiting", "other"].map((id) => ({
    id,
    title: id,
    running: true,
    waiting: false,
    completed: false,
    failed: false,
  }));
  sync(tasks);
  for (const task of tasks) {
    task.running = task.waiting = task.id === "waiting";
    task.completed = !task.waiting;
    task.failed = task.id === "failed";
  }
  sync(tasks);
  assert.equal(notifications.length, 4);
  // A timed-out Windows toast can still be present in the Action Center.
  notifications[1].emit("close", { reason: "timedOut" });
  await handlers.get("workbench:desktop-settings")({}, { taskNotifications: false });
  events.length = 0;

  tasks[0].completed = tasks[1].completed = false;
  sync(tasks);
  assert.deepEqual(
    notifications.map((notice) => notice.closeCount),
    [1, 1, 0, 0],
  );
  sync(tasks);
  assert.deepEqual(
    notifications.map((notice) => notice.closeCount),
    [1, 1, 0, 0],
  );

  notifications[2].emit("click");
  assert.deepEqual(
    notifications.map((notice) => notice.closeCount),
    [1, 1, 1, 0],
  );
  assert.deepEqual(events, ["show", "focus", ["workbench:desktop-open-task", "waiting"]]);
  sync(tasks);
  assert.equal(notifications.length, 4);

  sync([]);
  assert.deepEqual(
    notifications.map((notice) => notice.closeCount),
    [1, 1, 1, 1],
  );
  service.dispose();
  assert.deepEqual(
    notifications.map((notice) => notice.closeCount),
    [1, 1, 1, 1],
  );
});

test("the actual Electron Node child applies the shared proxy to fetch and HTTP requests", async (t) => {
  const proxy = http.createServer((_request, response) => response.end("proxied"));
  const sockets = new Set();
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("connect", (_request, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"),
    );
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    proxy.close();
  });
  const address = `http://127.0.0.1:${proxy.address().port}`;
  const environment = packagedChildEnvironment(
    proxyEnvironment(process.env, { ...DEFAULTS, httpProxy: address }, "linux"),
  );
  const { stdout } = await promisify(execFile)(
    require("electron"),
    [
      "-e",
      `
    (async () => {
      console.log(await (await fetch('http://workbench-proxy-test.invalid/')).text());
      require('node:http').get('http://workbench-proxy-test.invalid/', response => {
        let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => console.log(body));
      }).on('error', error => { console.error(error); process.exitCode = 1; });
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
    ],
    { env: environment, timeout: 5000 },
  );
  assert.equal(stdout.trim(), "proxied\nproxied");
});

test("proxy settings replace inherited values and keep credentials in the main process", () => {
  const shells = ["powershell", "command-prompt", "git-bash", "wsl"];
  assert.throws(() => validatePreferences({ notificationSound: "unknown" }), /invalid-settings/);
  assert.throws(() => validatePreferences({ notificationSound: "" }), /invalid-settings/);
  assert.throws(() => validatePreferences({ terminalShell: "unknown" }), /invalid-settings/);
  assert.deepEqual(
    shells.map((terminalShell) => validatePreferences({ terminalShell }).terminalShell),
    shells,
  );
  assert.throws(() => validatePreferences({ httpProxy: "file:///tmp/proxy" }), /invalid-proxy/);
  assert.throws(() => validatePreferences({ keepAwake: "true" }), /invalid-settings/);
  assert.throws(() => validatePreferences({ noProxy: "host;other" }), /invalid-bypass/);
  const direct = proxyEnvironment(
    {
      HTTP_PROXY: "old",
      https_proxy: "old",
      ALL_PROXY: "old",
      PI_WORKBENCH_UPDATE_TOKEN: "secret",
      PATH: "/bin",
    },
    DEFAULTS,
    "linux",
  );
  assert.deepEqual(direct, {
    PATH: "/bin",
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
  });
  const configured = proxyEnvironment(
    {},
    { ...DEFAULTS, httpProxy: "http://127.0.0.1:7890", noProxy: ".example.com" },
    "linux",
  );
  assert.equal(configured.HTTPS_PROXY, configured.http_proxy);
  assert.equal(configured.NO_PROXY, "localhost,127.0.0.1,::1,.example.com");
  assert.equal(
    proxyEnvironment({}, DEFAULTS, "win32").PI_WORKBENCH_TERMINAL_SHELL_PROFILE,
    "powershell",
  );
  assert.equal(
    proxyEnvironment({}, { ...DEFAULTS, terminalShell: "command-prompt" }, "win32")
      .PI_WORKBENCH_TERMINAL_SHELL_PROFILE,
    "command-prompt",
  );
});
