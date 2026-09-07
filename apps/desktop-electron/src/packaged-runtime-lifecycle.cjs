const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");

const { removeRuntimeArtifactOverrides } = require("./runtime-artifact-environment.cjs");
const { registerServerProcess, stopServerProcess } = require("./server-process-lifecycle.cjs");

const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const PACKAGED_SMOKE_OWNER_FRAME_TYPE = "workbench:packaged-smoke-owner";
const PACKAGED_SMOKE_OWNER_ACK_FRAME_TYPE = "workbench:packaged-smoke-owner-ack";
const PACKAGED_SMOKE_OWNER_FRAME_VERSION = 1;

function isExactPackagedSmokeOwnerAcknowledgement(acknowledgement, { owner, pid, requestId }) {
  if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)) {
    return false;
  }
  const keys = Object.keys(acknowledgement).sort();
  return (
    keys.length === 6 &&
    keys.every(
      (key, index) => key === ["accepted", "owner", "pid", "requestId", "type", "version"][index],
    ) &&
    acknowledgement.type === PACKAGED_SMOKE_OWNER_ACK_FRAME_TYPE &&
    acknowledgement.version === PACKAGED_SMOKE_OWNER_FRAME_VERSION &&
    acknowledgement.requestId === requestId &&
    acknowledgement.owner === owner &&
    acknowledgement.pid === pid &&
    acknowledgement.accepted === true
  );
}

function defaultTimers() {
  return { clearTimeout, setTimeout };
}

function withTimeout(promise, label, timeoutMs, timers) {
  return new Promise((resolve, reject) => {
    const timeout = timers.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
    Promise.resolve(promise).then(
      (value) => {
        timers.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        timers.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function childExitReason(label, code, signal) {
  const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  return new Error(`${label} exited unexpectedly (${reason}).`);
}

function isChildRunning(child) {
  return child && child.exitCode === null && child.signalCode == null;
}

function waitForExit(child) {
  if (!isChildRunning(child)) {
    return Promise.resolve({ code: child?.exitCode, signal: child?.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function writeControlFrame(child, encoded, label) {
  return new Promise((resolve, reject) => {
    if (!child.stdin || child.stdin.destroyed) {
      reject(new Error(`${label} control stdin is unavailable.`));
      return;
    }
    try {
      child.stdin.write(encoded, (error) => {
        if (error) reject(new Error(`${label} control stdin write failed.`));
        else resolve();
      });
    } catch {
      reject(new Error(`${label} control stdin write failed.`));
    }
  });
}

function createDiagnosticForwarder(
  stream,
  { accessToken, write = (text) => process.stderr.write(text) } = {},
) {
  if (!stream?.on) return Object.freeze({ flush() {} });
  const retainedLength = accessToken ? Math.max(0, accessToken.length - 1) : 0;
  let pending = "";
  const redact = (text) =>
    accessToken && text.includes(accessToken) ? text.split(accessToken).join("[REDACTED]") : text;
  const safeWrite = (text) => {
    try {
      write(text);
    } catch {
      // A diagnostic sink is never allowed to crash the Electron main process.
    }
  };
  stream.on("data", (chunk) => {
    const combined = redact(`${pending}${String(chunk)}`);
    const forwardLength = Math.max(0, combined.length - retainedLength);
    if (forwardLength > 0) safeWrite(combined.slice(0, forwardLength));
    pending = combined.slice(forwardLength);
  });
  const flush = () => {
    if (!pending) return;
    safeWrite(redact(pending));
    pending = "";
  };
  stream.once("end", flush);
  stream.once("error", () => {
    flush();
    safeWrite("Runtime Host stderr stream failed.\n");
  });
  return Object.freeze({ flush });
}

function createControlChannel(
  child,
  { Decoder, encodeInput, label, onFailure = () => undefined, parseOutput, timeoutMs, timers },
) {
  const decoder = new Decoder();
  const queuedFrames = [];
  const frameWaiters = [];
  let failure;
  let expectedClose = false;
  let expectedResponses = 0;

  const fail = (error) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(`${label} control channel failed.`);
    for (const waiter of frameWaiters.splice(0)) waiter.reject(failure);
    onFailure(failure);
  };
  const deliver = (frame) => {
    if (expectedResponses < 1) {
      fail(new Error(`${label} control stdout sent an unexpected trailing frame.`));
      return;
    }
    expectedResponses -= 1;
    const waiter = frameWaiters.shift();
    if (waiter) waiter.resolve(frame);
    else queuedFrames.push(frame);
  };

  child.stdout.on("data", (chunk) => {
    try {
      for (const record of decoder.push(chunk)) {
        const frame = parseOutput(record);
        if (!frame) {
          fail(new Error(`${label} control stdout sent an invalid output frame.`));
          return;
        }
        deliver(frame);
      }
    } catch {
      fail(new Error(`${label} control stdout sent invalid NDJSON.`));
    }
  });
  child.stdout.once("error", () => fail(new Error(`${label} control stdout failed.`)));
  child.stdout.once("end", () => {
    try {
      decoder.finish();
    } catch {
      fail(new Error(`${label} control stdout ended with incomplete NDJSON.`));
    }
    if (frameWaiters.length > 0 || expectedResponses > 0) {
      fail(new Error(`${label} control stdout ended before the expected frame.`));
    } else if (!expectedClose) {
      fail(new Error(`${label} control stdout ended unexpectedly.`));
    }
  });
  child.once("error", (error) => fail(error));
  child.once("exit", (code, signal) => {
    if (frameWaiters.length > 0 || expectedResponses > 0) {
      fail(childExitReason(label, code, signal));
    }
  });

  return Object.freeze({
    assertDrained() {
      if (failure) throw failure;
      if (queuedFrames.length > 0) {
        throw new Error(`${label} control stdout sent an unexpected trailing frame.`);
      }
      if (expectedResponses !== 0) {
        throw new Error(`${label} control response is still outstanding.`);
      }
    },
    expectClose() {
      if (failure) throw failure;
      expectedClose = true;
    },
    async next(operationLabel, operationTimeoutMs = timeoutMs) {
      if (failure) throw failure;
      if (queuedFrames.length > 0) return queuedFrames.shift();
      try {
        return await withTimeout(
          new Promise((resolve, reject) => frameWaiters.push({ reject, resolve })),
          operationLabel,
          operationTimeoutMs,
          timers,
        );
      } catch (error) {
        fail(error);
        throw error;
      }
    },
    async send(frame, operationLabel, operationTimeoutMs = timeoutMs) {
      if (failure) throw failure;
      expectedResponses += 1;
      try {
        await withTimeout(
          writeControlFrame(child, encodeInput(frame), label),
          operationLabel,
          operationTimeoutMs,
          timers,
        );
      } catch (error) {
        expectedResponses -= 1;
        fail(error);
        throw error;
      }
      if (failure) throw failure;
    },
  });
}

function packagedChildEnvironment(environment, settingsFile) {
  const childEnvironment = { ...environment };
  for (const name of Object.keys(childEnvironment)) {
    const normalizedName = name.toUpperCase();
    if (normalizedName.startsWith("NODE_") || normalizedName.startsWith("WORKBENCH_")) {
      delete childEnvironment[name];
    }
  }
  removeRuntimeArtifactOverrides(childEnvironment);
  delete childEnvironment.HOSTNAME;
  delete childEnvironment.PORT;
  childEnvironment.ELECTRON_RUN_AS_NODE = "1";
  childEnvironment.NODE_ENV = "production";
  // Electron's Node runtime uses the desktop-owned HTTP(S)_PROXY and NO_PROXY for fetch/http.
  childEnvironment.NODE_USE_ENV_PROXY = "1";
  if (settingsFile) childEnvironment.PI_WORKBENCH_SETTINGS_FILE = settingsFile;
  childEnvironment.WORKBENCH_RUNTIME_MANAGED_CHILD = "1";
  return childEnvironment;
}

/**
 * The release smoke is the only parent that creates Node IPC for Electron.  It
 * receives a deliberately tiny owner frame before Runtime can process its
 * start request: no origin, credential, argv, environment, or file path can
 * cross this channel.  Waiting for the parent's acknowledgement makes a
 * pre-bootstrap Electron crash recoverable without guessing at a re-parented
 * Runtime process group.
 */
function createPackagedSmokeOwnerReporter({
  processRef = process,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  timers = defaultTimers(),
} = {}) {
  if (typeof processRef?.send !== "function" || typeof processRef?.on !== "function")
    return undefined;
  let nextRequestId = 1;
  return async ({ owner, pid }) => {
    if (!(owner === "runtime" && Number.isSafeInteger(pid) && pid > 0)) {
      throw new Error("Packaged smoke owner report is invalid.");
    }
    const requestId = nextRequestId++;
    const frame = Object.freeze({
      owner,
      pid,
      requestId,
      type: PACKAGED_SMOKE_OWNER_FRAME_TYPE,
      version: PACKAGED_SMOKE_OWNER_FRAME_VERSION,
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) timers.clearTimeout(timeout);
        processRef.off("message", onMessage);
        if (error) reject(error);
        else resolve();
      };
      const onMessage = (acknowledgement) => {
        if (
          !acknowledgement ||
          acknowledgement.type !== PACKAGED_SMOKE_OWNER_ACK_FRAME_TYPE ||
          acknowledgement.version !== PACKAGED_SMOKE_OWNER_FRAME_VERSION ||
          acknowledgement.requestId !== requestId
        ) {
          return;
        }
        if (!isExactPackagedSmokeOwnerAcknowledgement(acknowledgement, frame)) {
          finish(
            new Error("Packaged smoke parent returned an invalid child ownership acknowledgement."),
          );
          return;
        }
        finish();
      };
      timeout = timers.setTimeout(
        () => finish(new Error("Packaged smoke parent did not acknowledge child ownership.")),
        timeoutMs,
      );
      processRef.on("message", onMessage);
      try {
        processRef.send(frame, (error) => {
          if (error) finish(new Error("Packaged smoke ownership report could not be sent."));
        });
      } catch {
        finish(new Error("Packaged smoke ownership report could not be sent."));
      }
    });
  };
}

function spawnControlledChild(
  executable,
  args,
  {
    accessToken,
    cwd,
    environment,
    label,
    onControlFailure,
    platform,
    spawnChild,
    support,
    timeoutMs,
    timers,
    writeDiagnostic,
  },
) {
  const child = spawnChild(executable, args, {
    cwd,
    detached: platform !== "win32",
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (!child?.stdin || !child.stdout || !child.stderr) {
    throw new Error(`${label} requires piped control stdin, stdout, and stderr.`);
  }
  const diagnostics = createDiagnosticForwarder(child.stderr, {
    accessToken,
    write: writeDiagnostic,
  });
  const contracts = support.runtimeHostControl;
  const channel = createControlChannel(child, {
    Decoder: contracts.RuntimeHostControlNdjsonDecoder,
    encodeInput: contracts.encodeRuntimeHostControlInputFrame,
    label,
    onFailure: onControlFailure,
    parseOutput: contracts.parseRuntimeHostControlOutputFrame,
    timeoutMs,
    timers,
  });
  return { channel, child, contracts, diagnostics, label, type: "runtime" };
}

function startupError(frame, parseStartupError, label) {
  const parsed = parseStartupError(frame);
  return parsed ? new Error(`${label} could not start (${parsed.code}).`) : undefined;
}

async function startRuntimeChild(options, rendererOrigin, accessToken) {
  const managed = spawnControlledChild(options.executable, [options.layout.runtime.entrypoint], {
    ...options,
    accessToken,
    environment: packagedChildEnvironment(options.baseEnvironment, options.settingsFile),
    label: "Runtime Host",
  });
  try {
    // Install child stream/error listeners before awaiting the Windows census, but capture its
    // identity before the control protocol starts work so forced cleanup never guesses by PID.
    await registerServerProcess(managed.child, { platform: options.platform });
    await options.reportOwner?.({ owner: "runtime", pid: managed.child.pid });
    const { contracts } = managed;
    await managed.channel.send(
      contracts.createRuntimeHostStartFrame({ accessToken, allowedOrigins: [rendererOrigin] }),
      "Runtime Host start control frame",
    );
    const output = await managed.channel.next("Runtime Host ready control frame");
    const error = startupError(output, contracts.parseRuntimeHostStartupErrorFrame, managed.label);
    if (error) throw error;
    const ready = contracts.parseRuntimeHostReadyFrame(output);
    if (!ready || ready.pid !== managed.child.pid || ready.instanceId === accessToken) {
      throw new Error("Runtime Host did not emit the exact expected ready frame.");
    }
    managed.ready = ready;
    managed.channel.assertDrained();
    return managed;
  } catch (error) {
    throw Object.assign(error, { managedChild: managed });
  }
}

async function forceCleanup(managed, { platform, stopProcess }) {
  if (!managed?.child) return;
  const result = await stopProcess(managed.child, { platform });
  managed.diagnostics?.flush();
  if (!result?.exited) throw new Error(`${managed.label} process tree did not exit.`);
}

async function shutdownControlledChild(
  managed,
  { platform, reason, shutdownTimeoutMs, stopProcess, timers },
) {
  if (!managed?.child) return;
  if (!isChildRunning(managed.child)) {
    await forceCleanup(managed, { platform, stopProcess });
    return;
  }
  const { contracts } = managed;
  try {
    const exit = waitForExit(managed.child);
    const frame = contracts.createRuntimeHostShutdownFrame({
      reason,
      deadlineMs: shutdownTimeoutMs,
    });
    // Authorize terminal stdout before writing shutdown so ack + process exit cannot race the
    // promise continuation and look like an unexpected post-ready channel loss.
    managed.channel.expectClose();
    await managed.channel.send(frame, `${managed.label} shutdown control frame`, shutdownTimeoutMs);
    const output = await managed.channel.next(
      `${managed.label} shutdown acknowledgement`,
      shutdownTimeoutMs,
    );
    const acknowledgement = contracts.parseRuntimeHostShutdownAckFrame(output);
    if (!acknowledgement) throw new Error(`${managed.label} sent an invalid shutdown response.`);
    managed.child.stdin.end();
    const result = await withTimeout(
      exit,
      `${managed.label} clean exit`,
      shutdownTimeoutMs,
      timers,
    );
    if (result.code !== 0 || result.signal !== null) {
      throw new Error(`${managed.label} did not exit cleanly.`);
    }
    managed.channel.assertDrained();
    managed.diagnostics.flush();
  } catch (error) {
    await forceCleanup(managed, { platform, stopProcess });
    throw error;
  }
}

function loadPackagedSupport(supportPath) {
  return require(supportPath);
}

function assertPackagedSupport(support) {
  if (
    !support ||
    typeof support.resolveDesktopArtifactLayout !== "function" ||
    !support.runtimeHostControl
  ) {
    throw new Error("The packaged desktop artifact module does not expose lifecycle support.");
  }
  return support;
}

async function startPackagedWorkbenchRuntime({
  runtimeDirectory,
  supportPath,
  settingsFile,
  rendererOrigin,
  environment = process.env,
  executable = process.execPath,
  platform = process.platform,
  spawnChild = spawn,
  stopProcess = stopServerProcess,
  createAccessToken = () => randomBytes(32).toString("base64url"),
  loadSupport = loadPackagedSupport,
  resolveLayout,
  timers = defaultTimers(),
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  beforeStop = async () => undefined,
  onUnexpectedExit = () => undefined,
  reportOwner,
  writeDiagnostic,
} = {}) {
  if (!runtimeDirectory || !supportPath || !rendererOrigin) {
    throw new Error("Packaged Runtime lifecycle paths and renderer origin are required.");
  }
  const support = assertPackagedSupport(loadSupport(supportPath));
  const layout = await (resolveLayout ?? support.resolveDesktopArtifactLayout)(runtimeDirectory);
  const baseEnvironment = packagedChildEnvironment(environment, settingsFile);
  const common = {
    baseEnvironment,
    cwd: runtimeDirectory,
    environment: baseEnvironment,
    executable,
    layout,
    onControlFailure(error) {
      if (startupComplete) handleUnexpected(error);
    },
    platform,
    reportOwner,
    settingsFile,
    spawnChild,
    support,
    timeoutMs: readyTimeoutMs,
    timers,
    writeDiagnostic,
  };
  const accessToken = createAccessToken();
  let runtime;
  let startupComplete = false;
  let stopping = false;
  let stopPromise;
  let restartDrainPromise;
  let unexpectedHandled = false;

  const stopWithReason = (reason, stopRenderer) => {
    stopping = true;
    stopPromise ??= (async () => {
      const failures = [];
      if (stopRenderer) {
        try {
          await beforeStop();
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await shutdownControlledChild(runtime, {
          platform,
          reason,
          shutdownTimeoutMs,
          stopProcess,
          timers,
        });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Packaged Runtime Host could not be stopped.");
      }
    })();
    return stopPromise;
  };
  const stop = () =>
    stopWithReason(support.runtimeHostControl.RuntimeHostShutdownReason.containerExit, true);
  const drainForRestart = () => {
    restartDrainPromise ??= stopWithReason(
      support.runtimeHostControl.RuntimeHostShutdownReason.restart,
      false,
    ).catch(async () => {
      // A crashed control channel cannot acknowledge shutdown. Require confirmed tree cleanup
      // before allowing a replacement, even when the earlier graceful shutdown failed.
      try {
        await forceCleanup(runtime, { platform, stopProcess });
      } catch (error) {
        restartDrainPromise = undefined;
        throw error;
      }
    });
    return restartDrainPromise;
  };

  const handleUnexpected = (error) => {
    if (!startupComplete || stopping || unexpectedHandled) return;
    unexpectedHandled = true;
    // The static desktop renderer owns the recovery UI and must survive a sidecar failure.
    void stopWithReason(support.runtimeHostControl.RuntimeHostShutdownReason.restart, false).then(
      () => onUnexpectedExit(error),
      (cleanupError) =>
        onUnexpectedExit(
          new AggregateError(
            [error, cleanupError],
            `${error.message} Ordered child cleanup also reported a failure.`,
          ),
        ),
    );
  };

  const observeUnexpectedExit = (managed) => {
    managed.child.once("exit", (code, signal) => {
      handleUnexpected(childExitReason(managed.label, code, signal));
    });
  };

  try {
    runtime = await startRuntimeChild(common, rendererOrigin, accessToken);
    observeUnexpectedExit(runtime);
    if (!isChildRunning(runtime.child)) {
      throw new Error("The packaged Runtime Host exited during startup.");
    }
    runtime.channel.assertDrained();
    startupComplete = true;
  } catch (error) {
    runtime ??= error?.managedChild?.type === "runtime" ? error.managedChild : runtime;
    try {
      // A failed replacement must leave the existing desktop available for another attempt.
      await drainForRestart();
    } catch (cleanupError) {
      throw Object.assign(
        new AggregateError([error, cleanupError], "Packaged Workbench startup cleanup failed."),
        { code: "WORKBENCH_RUNTIME_CLEANUP_FAILED", cleanup: drainForRestart },
      );
    }
    throw error;
  }

  return Object.freeze({
    rendererArtifact: layout.renderer,
    runtimeConnection: Object.freeze({
      kind: "desktop-sidecar",
      protocolVersion: runtime.ready.hostProtocolVersion,
      httpOrigin: runtime.ready.httpOrigin,
      instanceId: runtime.ready.instanceId,
      accessToken,
    }),
    runtimeReady: runtime.ready,
    drainForRestart,
    stop,
  });
}

module.exports = {
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  createControlChannel,
  createDiagnosticForwarder,
  createPackagedSmokeOwnerReporter,
  packagedChildEnvironment,
  startPackagedWorkbenchRuntime,
};
