const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const linuxLauncher = readFileSync(path.join(__dirname, "_run.sh"), "utf8");
const windowsLauncher = readFileSync(
  path.join(repositoryRoot, "run_scripts/windows/_run.cmd"),
  "utf8",
);

test("desktop launchers delegate the one-renderer topology without claiming ports or stale owners", () => {
  for (const source of [linuxLauncher, windowsLauncher]) {
    assert.match(source, /pnpm install --frozen-lockfile --prod=false/u);
    assert.match(source, /WORKBENCH_DESKTOP_RENDERER_ORIGIN/u);
    assert.match(source, /pnpm electron:dev:connect/u);
    assert.match(source, /pnpm electron:dev/u);
    assert.doesNotMatch(source, /WORKBENCH_WEB_ORIGIN|WORKBENCH_RUNTIME_ORIGIN/u);
    assert.doesNotMatch(
      source,
      /release[_-](?:port|electron)|electron-dev-watch|web-runtime-(?:watch|orchestrator)|sentinel/u,
    );
  }

  assert.match(linuxLauncher, /exec pnpm electron:dev/u);
  assert.match(windowsLauncher, /cd \/d "%PROJECT_ROOT%"/u);
  assert.equal(
    existsSync(
      path.join(repositoryRoot, "run_scripts/windows/release-electron-dev-orchestrators.ps1"),
    ),
    false,
  );
});
