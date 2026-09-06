import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nativeBuild from "./build-node-pty-native.cjs";
import processRunner from "../apps/desktop-electron/scripts/process-runner.cjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export function localRelease({
  args = process.argv.slice(2),
  root = repositoryRoot,
  environment = process.env,
  execute = execFileSync,
} = {}) {
  const [mode, ...flags] = args;
  if (
    !["build", "upload"].includes(mode) ||
    flags.length > 1 ||
    (flags.length && (mode !== "upload" || flags[0] !== "--clobber"))
  ) {
    throw new Error("Usage: pnpm release:build | pnpm release:upload [--clobber]");
  }
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const tag = `v${version}`;
  const target = nativeBuild.targetKey(nativeBuild.currentTarget());
  if (target.endsWith("-musl")) throw new Error("Linux releases require a glibc build host.");
  const output = path.join(root, "release-assets", target);
  const env = {
    ...environment,
    CI: "true",
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    WORKBENCH_NODE_PTY_EXPECTED_TARGET: target,
    WORKBENCH_NODE_PTY_NATIVE_BUILD_MANIFEST: path.join(
      root,
      ".desktop-build",
      "node-pty-native",
      target,
      "node-pty-native-build.json",
    ),
  };
  const run = (command, parameters, capture = false) =>
    execute(command, parameters, {
      cwd: root,
      env,
      windowsHide: true,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
  const node = (...parameters) => run(process.execPath, parameters);
  const pnpm = (...parameters) => {
    const invocation = processRunner.packageManagerInvocation(parameters, { env });
    run(invocation.command, invocation.args);
  };
  const commit = JSON.parse(
    run(process.execPath, ["scripts/validate-release-tag.mjs", tag], true),
  ).commit;

  if (mode === "build") {
    pnpm("install", "--frozen-lockfile");
    // Clean before compiling: the native attestation also lives in .desktop-build.
    node("scripts/prepare-workbench-build.cjs");
    rmSync(path.join(root, "dist-electron"), { recursive: true, force: true });
    pnpm("--filter", "@workbench/terminal-server", "run", "native:pty:build");
    pnpm("--filter", "@workbench/host-artifact-policy", "test");
    node(
      "--no-warnings=ExperimentalWarning",
      "--import",
      "./scripts/register-typescript-test-loader.mjs",
      "--test",
      "apps/runtime-node/test/runtime-artifact-builder.test.ts",
    );
    node(
      "--test",
      "apps/desktop-electron/test/native-runtime.test.cjs",
      "apps/desktop-electron/test/after-pack.test.cjs",
      "apps/desktop-electron/test/staged-api-only-runtime-smoke.test.cjs",
      "packages/host/server/test/windows-process-census.test.cjs",
      "scripts/local-release.test.mjs",
      "scripts/validate-release-tag.test.mjs",
      "scripts/validate-release-assets.test.mjs",
      "scripts/prepare-release-assets.test.mjs",
      "scripts/release-update-info.test.mjs",
    );
    pnpm("--filter", "@workbench/runtime-node", "typecheck");
    pnpm("--filter", "@workbench/desktop-electron", "typecheck");
    pnpm("--filter", "@workbench/runtime-node", "build:artifact");
    pnpm("--filter", "@workbench/runtime-node", "smoke:native");
    pnpm("--filter", "@workbench/web", "build");
    pnpm("--filter", "@workbench/web", "smoke:standalone");
    pnpm("--filter", "@workbench/desktop-electron", "build");
    pnpm("--filter", "@workbench/desktop-electron", "smoke:native");
    pnpm("--filter", "@workbench/desktop-electron", "dist:artifact", "--publish", "never");
    node("scripts/validate-release-tag.mjs", tag);
    node("scripts/prepare-release-assets.mjs", "--target", target, "--output", output);
  }
  node("scripts/validate-release-assets.mjs", output, tag, commit);

  if (mode === "upload") {
    const repository = run(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      true,
    ).trim();
    const ref = JSON.parse(run("gh", ["api", `repos/${repository}/git/ref/tags/${tag}`], true));
    const remoteCommit =
      ref.object.type === "tag"
        ? JSON.parse(run("gh", ["api", `repos/${repository}/git/tags/${ref.object.sha}`], true))
            .object.sha
        : ref.object.sha;
    if (remoteCommit !== commit)
      throw new Error(`Remote ${tag} does not match the built commit ${commit}.`);
    const assets = readdirSync(output)
      .sort()
      .map((name) => path.join(output, name));
    run("gh", ["release", "upload", tag, ...assets, "--repo", repository, ...flags]);
  }
  return { tag, target, output, commit };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(localRelease()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
