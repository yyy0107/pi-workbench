const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  createDiagnosticForwarder,
  createPackagedSmokeOwnerReporter,
  packagedChildEnvironment,
  startPackagedWorkbenchRuntime,
} = require("../src/packaged-runtime-lifecycle.cjs");
const support = require("../scripts/desktop-artifact-support.cjs");

class ControlledChild extends EventEmitter {
  constructor({ pid, records, startupError = false, trailingFrame = false }) {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.pid = pid;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.type = "runtime";
    let input = "";
    this.stdin.on("data", (chunk) => {
      input += String(chunk);
      for (;;) {
        const newline = input.indexOf("\n");
        if (newline < 0) break;
        const frame = JSON.parse(input.slice(0, newline));
        input = input.slice(newline + 1);
        records.push({ event: frame.type, frame });
        this.#respond(frame, startupError, trailingFrame);
      }
    });
  }

  #respond(frame, startupError, trailingFrame) {
    const control = support.runtimeHostControl;
    if (frame.type === "start") {
      const output = startupError
        ? control.createRuntimeHostStartupErrorFrame(
            control.RuntimeHostStartupErrorCode.startupFailed,
          )
        : control.createRuntimeHostReadyFrame({
            instanceId: "runtime-instance",
            pid: this.pid,
            httpOrigin: "http://127.0.0.1:43102",
          });
      this.stdout.write(control.encodeRuntimeHostControlOutputFrame(output));
      return;
    }
    const acknowledgement = control.encodeRuntimeHostControlOutputFrame(
      control.createRuntimeHostShutdownAckFrame(),
    );
    const trailing = trailingFrame
      ? control.encodeRuntimeHostControlOutputFrame(
          control.createRuntimeHostReadyFrame({
            instanceId: "unexpected",
            pid: this.pid,
            httpOrigin: "http://127.0.0.1:43103",
          }),
        )
      : "";
    this.stdout.write(`${acknowledgement}${trailing}`, () =>
      queueMicrotask(() => this.exit(0, null)),
    );
  }

  exit(code, signal) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, signal);
  }
}

function harness({ startupError = false, trailingFrame = false } = {}) {
  const records = [];
  let child;
  return {
    records,
    get child() {
      return child;
    },
    options: {
      runtimeDirectory: "/release/desktop-runtime",
      supportPath: "/release/desktop-runtime/desktop-artifact-support.cjs",
      settingsFile: "/state/settings.json",
      rendererOrigin: "workbench://app",
      executable: "/release/electron",
      environment: {
        NODE_OPTIONS: "--inspect",
        WORKBENCH_RUNTIME_ACCESS_TOKEN: "stale",
      },
      createAccessToken: () => "desktop-secret-token",
      loadSupport: () => support,
      resolveLayout: async () => ({
        renderer: { artifactRoot: "/release/desktop-runtime/desktop-renderer" },
        runtime: { entrypoint: "/release/desktop-runtime/runtime-node/server.mjs" },
      }),
      spawnChild(command, args, options) {
        records.push({ event: "spawn", command, args, options });
        child = new ControlledChild({ pid: 7_100, records, startupError, trailingFrame });
        return child;
      },
      async stopProcess(process) {
        records.push({ event: "force" });
        process.exit(null, "SIGKILL");
        return { exited: true, forced: true };
      },
    },
  };
}

test("starts one Runtime child with the exact renderer origin and shuts it down", async () => {
  const fixture = harness();
  delete fixture.options.settingsFile;
  const session = await startPackagedWorkbenchRuntime({
    ...fixture.options,
    async reportOwner(owner) {
      fixture.records.push({ event: "owner", owner });
    },
  });
  assert.equal(session.rendererArtifact.artifactRoot, "/release/desktop-runtime/desktop-renderer");
  assert.deepEqual(session.runtimeConnection, {
    kind: "desktop-sidecar",
    protocolVersion: 1,
    httpOrigin: "http://127.0.0.1:43102",
    instanceId: "runtime-instance",
    accessToken: "desktop-secret-token",
  });
  const spawn = fixture.records.find((record) => record.event === "spawn");
  const start = fixture.records.find((record) => record.event === "start");
  assert.deepEqual(start.frame.allowedOrigins, ["workbench://app"]);
  assert.ok(
    fixture.records.findIndex((record) => record.event === "owner") <
      fixture.records.indexOf(start),
  );
  assert.equal(JSON.stringify(spawn).includes("desktop-secret-token"), false);
  assert.equal(spawn.options.env.WORKBENCH_RUNTIME_MANAGED_CHILD, "1");
  assert.equal("PI_WORKBENCH_SETTINGS_FILE" in spawn.options.env, false);
  assert.equal("NODE_OPTIONS" in spawn.options.env, false);

  const stopping = session.stop();
  assert.equal(session.stop(), stopping);
  await stopping;
  const shutdowns = fixture.records.filter((record) => record.event === "shutdown");
  assert.equal(shutdowns.length, 1);
  assert.equal(
    shutdowns[0].frame.reason,
    support.runtimeHostControl.RuntimeHostShutdownReason.containerExit,
  );
  assert.equal(fixture.child.exitCode, 0);
});

test("drains one Runtime generation for restart without closing renderer intake", async () => {
  const fixture = harness();
  const session = await startPackagedWorkbenchRuntime({
    ...fixture.options,
    beforeStop() {
      fixture.records.push({ event: "renderer-stop" });
    },
  });

  const draining = session.drainForRestart();
  assert.equal(session.drainForRestart(), draining);
  await draining;

  const shutdown = fixture.records.find((record) => record.event === "shutdown");
  assert.equal(shutdown.frame.reason, support.runtimeHostControl.RuntimeHostShutdownReason.restart);
  assert.equal(
    fixture.records.some((record) => record.event === "renderer-stop"),
    false,
  );
  assert.equal(fixture.child.exitCode, 0);
});

test("scrubs inherited control namespaces and redacts split credentials", () => {
  const environment = packagedChildEnvironment(
    { PATH: "/usr/bin", NODE_OPTIONS: "--inspect", workbench_web_origin: "stale" },
    "/state/settings.json",
  );
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.PI_WORKBENCH_SETTINGS_FILE, "/state/settings.json");
  assert.equal(environment.WORKBENCH_RUNTIME_MANAGED_CHILD, "1");
  assert.equal("NODE_OPTIONS" in environment, false);
  assert.equal("workbench_web_origin" in environment, false);

  const stderr = new PassThrough();
  let forwarded = "";
  const diagnostics = createDiagnosticForwarder(stderr, {
    accessToken: "desktop-secret-token",
    write: (text) => {
      forwarded += text;
    },
  });
  stderr.write("before desktop-sec");
  stderr.write("ret-token after");
  diagnostics.flush();
  assert.equal(forwarded, "before [REDACTED] after");
});

test("the token-free owner report accepts only an exact Runtime acknowledgement", async () => {
  const processRef = new EventEmitter();
  processRef.send = (frame, callback) => {
    callback();
    queueMicrotask(() =>
      processRef.emit("message", {
        ...frame,
        accepted: true,
        type: "workbench:packaged-smoke-owner-ack",
      }),
    );
  };
  const reportOwner = createPackagedSmokeOwnerReporter({ processRef, timeoutMs: 1_000 });
  await reportOwner({ owner: "runtime", pid: 7124 });
  await assert.rejects(reportOwner({ owner: "web", pid: 7125 }), /owner report is invalid/u);
});

test("startup and protocol failures force-clean the sole child", async () => {
  const startup = harness({ startupError: true });
  await assert.rejects(
    startPackagedWorkbenchRuntime(startup.options),
    /Runtime Host could not start/u,
  );
  assert.equal(
    startup.records.some((record) => record.event === "force"),
    false,
  );
  assert.equal(startup.child.exitCode, 0);

  const trailing = harness({ trailingFrame: true });
  const session = await startPackagedWorkbenchRuntime(trailing.options);
  await assert.rejects(session.stop(), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.ok(error.errors.some((nested) => /unexpected trailing frame/u.test(nested.message)));
    return true;
  });
  assert.equal(
    trailing.records.some((record) => record.event === "force"),
    true,
  );
});
