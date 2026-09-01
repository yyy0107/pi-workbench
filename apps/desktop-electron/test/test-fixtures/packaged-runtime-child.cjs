const { appendFileSync } = require("node:fs");

const type = "runtime";
const stateFile = process.env.PACKAGED_LIFECYCLE_TEST_STATE_FILE;
let input = "";

function record(event) {
  appendFileSync(stateFile, `${JSON.stringify({ event, type })}\n`);
}

function output(frame, afterWrite) {
  process.stdout.write(`${JSON.stringify(frame)}\n`, afterWrite);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf("\n");
    if (newline < 0) break;
    const frame = JSON.parse(input.slice(0, newline));
    input = input.slice(newline + 1);
    if (frame.type === "start") {
      record("start");
      output({
        type: "ready",
        controlVersion: 1,
        hostProtocolVersion: 1,
        instanceId: "fixture-runtime-instance",
        pid: process.pid,
        httpOrigin: "http://127.0.0.1:43202",
      });
    } else if (frame.type === "shutdown") {
      record("shutdown");
      output({ type: "shutdown-ack", controlVersion: 1 }, () => process.exit(0));
    }
  }
});
