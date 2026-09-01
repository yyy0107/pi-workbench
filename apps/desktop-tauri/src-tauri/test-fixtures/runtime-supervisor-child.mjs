import fs from "node:fs";
import net from "node:net";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";

const scenario = process.env.RUNTIME_FIXTURE_SCENARIO;
const instanceId = process.env.RUNTIME_FIXTURE_INSTANCE_ID;
const port = Number(process.env.RUNTIME_FIXTURE_PORT);
const rendererOrigin = process.env.RUNTIME_FIXTURE_RENDERER_ORIGIN;
const pidFile = process.env.RUNTIME_FIXTURE_PID_FILE;
const grandchildPidFile = process.env.RUNTIME_FIXTURE_GRANDCHILD_PID_FILE;
const escapedPidFile = process.env.RUNTIME_FIXTURE_ESCAPED_PID_FILE;
const escapedSignalAckFile = process.env.RUNTIME_FIXTURE_ESCAPED_SIGNAL_ACK_FILE;
const escapedCleanupFile = process.env.RUNTIME_FIXTURE_ESCAPED_CLEANUP_FILE;
const escapedCleanupAckFile = process.env.RUNTIME_FIXTURE_ESCAPED_CLEANUP_ACK_FILE;
const expectedShutdownReason = process.env.RUNTIME_FIXTURE_EXPECTED_SHUTDOWN_REASON;
const expectedDeadlineMs = process.env.RUNTIME_FIXTURE_EXPECTED_DEADLINE_MS;

const escapedDescendantSource = String.raw`
const fs = require("node:fs");
const [identityFile, cleanupFile, cleanupAckFile] = process.argv.slice(1);
if (!identityFile || !cleanupFile || !cleanupAckFile) process.exit(70);
process.on("SIGHUP", () => {});
process.on("SIGTERM", () => {});
const stat = fs.readFileSync("/proc/" + process.pid + "/stat", "utf8");
const closingParenthesis = stat.lastIndexOf(") ");
if (closingParenthesis < 0) process.exit(71);
const fields = stat.slice(closingParenthesis + 2).trim().split(/\s+/);
if (fields.length < 20) process.exit(72);
const starttime = fields[19];
const identity = String(process.pid) + ":" + starttime;
fs.writeFileSync(
  identityFile,
  JSON.stringify({
    pid: process.pid,
    pgrp: Number(fields[2]),
    session: Number(fields[3]),
    starttime,
  }),
  "utf8",
);
let terminating = false;
function terminate(acknowledgement) {
  if (terminating) return;
  terminating = true;
  fs.writeFileSync(cleanupAckFile, acknowledgement, "utf8");
  try {
    process.kill(process.pid, "SIGKILL");
  } catch {
    fs.writeFileSync(cleanupAckFile, "sigkill-error:" + identity, "utf8");
    process.exit(73);
  }
}
const cleanupPoll = setInterval(() => {
  let requested;
  try {
    requested = fs.readFileSync(cleanupFile, "utf8").trim();
  } catch {
    return;
  }
  if (!requested) return;
  terminate(requested === identity ? identity : "identity-mismatch:" + requested);
}, 10);
setTimeout(() => {
  clearInterval(cleanupPoll);
  terminate("watchdog:" + identity);
}, 10_000);
`;

if (!scenario || !instanceId || !Number.isSafeInteger(port) || !rendererOrigin) {
  process.exit(90);
}

if (pidFile) {
  fs.writeFileSync(pidFile, String(process.pid), "utf8");
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let started = false;
let accessToken;
let runtimeServer;

function hasExactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function writeFrame(frame, callback) {
  process.stdout.write(`${JSON.stringify(frame)}\n`, callback);
}

function readyFrame(pid = process.pid) {
  return {
    type: "ready",
    controlVersion: 1,
    hostProtocolVersion: 1,
    instanceId,
    pid,
    httpOrigin: `http://127.0.0.1:${port}`,
  };
}

function shutdownAckFrame() {
  return { type: "shutdown-ack", controlVersion: 1 };
}

function startupError(code) {
  const messages = {
    "invalid-control-frame": "Runtime Host control input is invalid.",
    "startup-failed": "Runtime Host startup failed.",
  };
  writeFrame({ type: "startup-error", controlVersion: 1, code, message: messages[code] });
}

function tokenAppearsOutsideStdin(token) {
  if (process.argv.some((argument) => argument.includes(token))) {
    return true;
  }
  return Object.entries(process.env).some(([name, value]) => `${name}=${value}`.includes(token));
}

function validStart(frame) {
  return (
    hasExactKeys(frame, ["type", "controlVersion", "authMode", "accessToken", "allowedOrigins"]) &&
    frame.type === "start" &&
    frame.controlVersion === 1 &&
    frame.authMode === "desktop-sidecar" &&
    typeof frame.accessToken === "string" &&
    frame.accessToken.length > 0 &&
    Array.isArray(frame.allowedOrigins) &&
    frame.allowedOrigins.length === 1 &&
    frame.allowedOrigins[0] === rendererOrigin
  );
}

function validShutdown(frame) {
  if (
    !hasExactKeys(frame, ["type", "controlVersion", "reason", "deadlineMs"]) ||
    frame.type !== "shutdown" ||
    frame.controlVersion !== 1 ||
    !Number.isSafeInteger(frame.deadlineMs)
  ) {
    return false;
  }
  if (expectedShutdownReason && frame.reason !== expectedShutdownReason) {
    return false;
  }
  return expectedDeadlineMs === undefined || frame.deadlineMs === Number(expectedDeadlineMs);
}

function emitReadyForScenario() {
  switch (scenario) {
    case "startup-error":
      startupError("startup-failed");
      return;
    case "wrong-pid":
      writeFrame(readyFrame(process.pid + 1));
      return;
    case "ready-timeout":
      setInterval(() => {}, 1_000);
      return;
    case "crash-before-ready":
      process.exit(23);
      return;
    case "unexpected-before-ready":
      writeFrame(shutdownAckFrame());
      return;
    case "duplicate-ready": {
      const line = `${JSON.stringify(readyFrame())}\n`;
      process.stdout.write(line + line);
      return;
    }
    case "crash-after-ready":
      writeFrame(readyFrame());
      setTimeout(() => process.exit(24), 125);
      return;
    case "stderr-split":
      process.stderr.write(`${"x".repeat(8_190)}${accessToken}:fixture-stderr-tail\n`);
      writeFrame(readyFrame());
      return;
    case "restartable":
      runtimeServer = net.createServer();
      runtimeServer.once("error", () => process.exit(43));
      runtimeServer.listen(port, "127.0.0.1", () => writeFrame(readyFrame()));
      return;
    default:
      writeFrame(readyFrame());
  }
}

function handleShutdown(frame) {
  if (!validShutdown(frame)) {
    process.exit(41);
    return;
  }
  switch (scenario) {
    case "exit-before-ack":
      process.exit(0);
      return;
    case "ack-no-exit":
      writeFrame(shutdownAckFrame());
      setInterval(() => {}, 1_000);
      return;
    case "duplicate-ack": {
      const line = `${JSON.stringify(shutdownAckFrame())}\n`;
      process.stdout.write(line + line, () => process.exit(0));
      return;
    }
    case "late-ack":
      setTimeout(
        () => writeFrame(shutdownAckFrame(), () => process.exit(0)),
        frame.deadlineMs + 50,
      );
      return;
    case "grandchild-inherited-stderr": {
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      if (!grandchildPidFile) {
        process.exit(42);
        return;
      }
      fs.writeFileSync(grandchildPidFile, String(grandchild.pid), "utf8");
      writeFrame(shutdownAckFrame(), () => process.exit(0));
      return;
    }
    case "escaped-setsid-descendant": {
      if (
        !escapedPidFile ||
        !escapedSignalAckFile ||
        !escapedCleanupFile ||
        !escapedCleanupAckFile
      ) {
        process.exit(44);
        return;
      }
      const escaped = spawn(
        process.execPath,
        ["-e", escapedDescendantSource, escapedPidFile, escapedCleanupFile, escapedCleanupAckFile],
        {
          detached: true,
          stdio: ["ignore", "ignore", "inherit"],
        },
      );
      escaped.once("error", () => process.exit(45));
      escaped.unref();
      const markerDeadline = Date.now() + 2_000;
      const markerPoll = setInterval(() => {
        if (!fs.existsSync(escapedPidFile)) {
          if (Date.now() >= markerDeadline) {
            clearInterval(markerPoll);
            process.exit(46);
          }
          return;
        }
        clearInterval(markerPoll);
        try {
          process.kill(escaped.pid, "SIGHUP");
          process.kill(escaped.pid, "SIGTERM");
        } catch {
          process.exit(47);
          return;
        }
        setTimeout(() => {
          try {
            process.kill(escaped.pid, 0);
          } catch {
            process.exit(48);
            return;
          }
          fs.copyFileSync(escapedPidFile, escapedSignalAckFile);
          writeFrame(shutdownAckFrame(), () => process.exit(0));
        }, 40);
      }, 10);
      return;
    }
    case "restartable":
      runtimeServer.close(() => writeFrame(shutdownAckFrame(), () => process.exit(0)));
      return;
    default:
      writeFrame(shutdownAckFrame(), () => process.exit(0));
  }
}

lines.on("line", (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    startupError("invalid-control-frame");
    return;
  }

  if (!started) {
    if (!validStart(frame)) {
      startupError("invalid-control-frame");
      return;
    }
    accessToken = frame.accessToken;
    if (tokenAppearsOutsideStdin(accessToken)) {
      startupError("startup-failed");
      return;
    }
    started = true;
    emitReadyForScenario();
    return;
  }

  handleShutdown(frame);
});
