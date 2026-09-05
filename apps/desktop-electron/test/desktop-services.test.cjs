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
      dialog: { showMessageBox: async () => ({ response: 0 }) },
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
  assert.ok(
    !fs
      .readFileSync(path.join(directory, "desktop-settings.json"), "utf8")
      .includes("example-test-token"),
  );
  await service.start();
  await new Promise(setImmediate);
  assert.deepEqual(proxy, { mode: "system" });
  call("settings", { keepAwake: true, notificationSounds: false });
  assert.deepEqual(power, ["prevent-app-suspension"]);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.feed.owner, "yyy0107");
  assert.equal(updater.feed.repo, "pi-workbench");
  assert.equal(
    updater.feed.updateProvider.prototype.getChannelFilePrefix(),
    `-${process.platform}-${process.arch}${process.platform === "linux" ? "-glibc" : ""}`,
  );
  const task = { id: "task", title: "Test", running: true, waiting: false, failed: false };
  call("task-state", { locale: "zh-CN", tasks: [task] });
  call("settings", { automaticUpdates: true });
  updater.emit("update-downloaded", { version: "0.2.0" });
  await new Promise(setImmediate);
  assert.equal(installed, 0);
  await call("update", "install"); // Busy and declined.
  assert.equal(stopped, 0);
  call("task-state", { locale: "zh-CN", tasks: [{ ...task, running: false }] });
  call("task-state", { locale: "zh-CN", tasks: [{ ...task, running: false }] });
  assert.deepEqual(notifications, [{ title: "任务已完成", body: "Test", silent: true }]);
  const soundEvents = () =>
    events.filter(([channel]) => channel === "workbench:desktop-notification-sound");
  assert.deepEqual(soundEvents(), []);
  for (const sound of ["chime", "soft", "bell", "droplet"]) {
    call("settings", { notificationSounds: true, notificationSound: sound });
    assert.equal(readDesktopSettings(app).preferences.notificationSound, sound);
    call("task-state", { locale: "zh-CN", tasks: [task] });
    call("task-state", { locale: "zh-CN", tasks: [{ ...task, running: false }] });
  }
  assert.deepEqual(
    soundEvents().map(([, sound]) => sound),
    ["chime", "soft", "bell", "droplet"],
  );
  assert.ok(notifications.every((notification) => notification.silent));
  call("settings", { notificationSounds: false });
  call("task-state", { locale: "zh-CN", tasks: [task] });
  call("task-state", { locale: "zh-CN", tasks: [{ ...task, running: false }] });
  assert.equal(soundEvents().length, 4);
  call("settings", { notificationSounds: true, taskNotifications: false });
  const count = notifications.length;
  call("task-state", { locale: "zh-CN", tasks: [task] });
  call("task-state", { locale: "zh-CN", tasks: [{ ...task, running: false }] });
  assert.equal(notifications.length, count);
  assert.equal(soundEvents().length, 4);
  await call("update", "install");
  assert.equal(stopped, 1);
  assert.equal(installed, 1);
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
    proxyEnvironment(process.env, { ...DEFAULTS, httpProxy: address }),
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
  assert.throws(() => validatePreferences({ notificationSound: "unknown" }), /invalid-settings/);
  assert.throws(() => validatePreferences({ notificationSound: "" }), /invalid-settings/);
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
  );
  assert.deepEqual(direct, {
    PATH: "/bin",
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
  });
  const configured = proxyEnvironment(
    {},
    { ...DEFAULTS, httpProxy: "http://127.0.0.1:7890", noProxy: ".example.com" },
  );
  assert.equal(configured.HTTPS_PROXY, configured.http_proxy);
  assert.equal(configured.NO_PROXY, "localhost,127.0.0.1,::1,.example.com");
});
