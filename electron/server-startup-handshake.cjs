const WORKBENCH_READY_MESSAGE_TYPE = "workbench:ready";
const WORKBENCH_READY_MESSAGE_VERSION = 1;

function parseWorkbenchReadyMessage(message, { expectedHost, expectedPid } = {}) {
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message.type !== WORKBENCH_READY_MESSAGE_TYPE ||
    message.version !== WORKBENCH_READY_MESSAGE_VERSION ||
    typeof message.host !== "string" ||
    !Number.isInteger(message.port) ||
    message.port < 1 ||
    message.port > 65_535 ||
    !Number.isInteger(message.pid) ||
    message.pid < 1
  ) {
    return undefined;
  }

  if (expectedHost !== undefined && message.host !== expectedHost) return undefined;
  if (expectedPid !== undefined && message.pid !== expectedPid) return undefined;

  return {
    host: message.host,
    pid: message.pid,
    port: message.port,
    url: `http://${message.host}:${message.port}`,
  };
}

function waitForWorkbenchServerReady(
  child,
  { expectedHost = "127.0.0.1", timeoutMs = 120_000 } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error) reject(error);
      else resolve(ready);
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      finish(new Error(`Workbench server exited before its ready handshake (${reason}).`));
    };
    const onMessage = (message) => {
      const ready = parseWorkbenchReadyMessage(message, {
        expectedHost,
        expectedPid: child.pid,
      });
      if (ready) finish(undefined, ready);
    };
    const timeout = setTimeout(() => {
      finish(new Error(`Workbench server did not send a ready handshake within ${timeoutMs}ms.`));
    }, timeoutMs);

    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);

    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
    }
  });
}

module.exports = {
  WORKBENCH_READY_MESSAGE_TYPE,
  WORKBENCH_READY_MESSAGE_VERSION,
  parseWorkbenchReadyMessage,
  waitForWorkbenchServerReady,
};
