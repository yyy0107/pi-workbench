const assert = require("node:assert/strict");
const test = require("node:test");

const { packageManagerInvocation } = require("../scripts/process-runner.cjs");

test("runs pnpm's JavaScript CLI through the current Node executable", () => {
  assert.deepEqual(
    packageManagerInvocation(["deploy", "target"], {
      env: { npm_execpath: "C:\\Users\\developer\\pnpm\\bin\\pnpm.cjs" },
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    }),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\developer\\pnpm\\bin\\pnpm.cjs", "deploy", "target"],
    },
  );
});

test("runs a standalone package-manager executable directly", () => {
  assert.deepEqual(
    packageManagerInvocation(["deploy", "target"], {
      env: { npm_execpath: "C:\\Tools\\pnpm.exe" },
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    }),
    {
      command: "C:\\Tools\\pnpm.exe",
      args: ["deploy", "target"],
    },
  );
});

test("rejects Windows batch shims instead of passing them to spawnSync", () => {
  assert.throws(
    () =>
      packageManagerInvocation([], {
        env: { npm_execpath: "C:\\Users\\developer\\AppData\\Roaming\\npm\\pnpm.cmd" },
      }),
    /Windows batch shim/u,
  );
});

test("requires the package-manager lifecycle environment", () => {
  assert.throws(() => packageManagerInvocation([], { env: {} }), /Missing npm_execpath/u);
});
