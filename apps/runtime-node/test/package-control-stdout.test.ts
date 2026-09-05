import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("Pi package install, removal and failure leave Runtime control stdout intact", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-package-stdout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installer = path.join(root, "installer.cjs");
  await writeFile(
    installer,
    `console.log('package command stdout');
console.error('package command stderr');
if (process.argv.includes('workbench-failing-package')) process.exit(1);
`,
  );
  const source = `
import assert from 'node:assert/strict';
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { runRuntimeNodeMain } from ${JSON.stringify(new URL("../src/main.ts", import.meta.url).href)};
import { runInstalledRuntimeHostControl } from ${JSON.stringify(new URL("../src/installed-api-only-runtime-host.ts", import.meta.url).href)};

await runRuntimeNodeMain({
  argv: [],
  async importRuntimeHost() {
    return {
      runInstalledRuntimeHostControl: (options) => runInstalledRuntimeHostControl({
        ...options,
        async runControlSession({ output }) {
          const settingsManager = SettingsManager.inMemory({
            npmCommand: [process.execPath, ${JSON.stringify(installer)}],
          }, { projectTrusted: true });
          const packages = new DefaultPackageManager({
            cwd: ${JSON.stringify(root)},
            agentDir: ${JSON.stringify(path.join(root, "agent"))},
            settingsManager,
          });
          for (const local of [false, true]) {
            await packages.install('npm:workbench-test-package', { local });
            await packages.remove('npm:workbench-test-package', { local });
            await assert.rejects(packages.install('npm:workbench-failing-package', { local }));
          }
          await new Promise((resolve, reject) => output.write(
            '{"type":"shutdown-ack","controlVersion":1}\\n',
            (error) => error ? reject(error) : resolve(),
          ));
          return { code: 'shutdown-acknowledged' };
        },
      }),
    };
  },
});
`;
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../../scripts/register-typescript-test-loader.mjs", import.meta.url).href,
      "--input-type=module",
      "--eval",
      source,
    ],
    {
      // Resolve the same SDK instance as the Pi package service, including pnpm peer contexts.
      cwd: fileURLToPath(
        new URL("../../../packages/agent-runtime/runtimes/pi/server/", import.meta.url),
      ),
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: path.join(root, "agent"),
        PI_WORKBENCH_SETTINGS_FILE: path.join(root, "workbench-settings.json"),
      },
      timeout: 15_000,
    },
  );
  assert.equal(stdout, '{"type":"shutdown-ack","controlVersion":1}\n');
  assert.equal(stderr.match(/package command stdout/g)?.length, 6);
  assert.equal(stderr.match(/package command stderr/g)?.length, 6);
});
