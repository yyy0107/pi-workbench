const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDesktopArtifacts } = require("../scripts/build-desktop-artifacts.cjs");

test("builds the installed-Electron Runtime target before composing desktop artifacts", async () => {
  const calls = [];
  const paths = { repositoryRoot: "/workbench" };
  const target = {
    arch: "x64",
    electronVersion: "43.4.1",
    nodeModuleAbi: "148",
    nodeVersion: "24.14.0",
    platform: "linux",
    targetTriple: "x86_64-unknown-linux-gnu",
  };
  const environment = { PATH: "/bin" };
  const result = await buildDesktopArtifacts({
    paths,
    environment,
    resolveTarget() {
      calls.push(["target"]);
      return target;
    },
    async buildRuntimeArtifact(options) {
      calls.push(["runtime", options]);
      return { manifest: { target } };
    },
    async compose(options) {
      calls.push(["compose", options]);
      assert.deepEqual(options.resolveTarget(), target);
      return { compositionPath: "/workbench/.desktop-build/desktop-artifacts.json" };
    },
  });
  assert.deepEqual(result, {
    compositionPath: "/workbench/.desktop-build/desktop-artifacts.json",
  });
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["target", "runtime", "compose"],
  );
  assert.deepEqual(calls[1][1], { environment, paths, target });
  assert.equal(calls[2][1].paths, paths);
});

test("does not publish a composition when the Runtime build is incomplete", async () => {
  let composed = false;
  await assert.rejects(
    buildDesktopArtifacts({
      paths: {},
      resolveTarget: () => ({ targetTriple: "x86_64-unknown-linux-gnu" }),
      buildRuntimeArtifact: async () => ({}),
      compose: async () => {
        composed = true;
      },
    }),
    /did not return an artifact/u,
  );
  assert.equal(composed, false);
});
