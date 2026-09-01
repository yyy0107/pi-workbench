import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
  RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
  RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
  type NodeRuntimeArtifactTarget,
  type RuntimeArtifactNativeInventoryFile,
} from "@workbench/host-contracts/runtime-artifact-manifest";

import {
  LINUX_WINDOW_MANAGER_SESSION_COMMAND,
  PRODUCT_RUNTIME_RESTART_COMMAND_TITLES,
  PRODUCT_TERMINAL_TOGGLE_COMMAND_TITLES,
  discoverOwnedPackagedProcesses,
  inspectPackagedRuntime,
  linuxExactProcessGroupScope,
  parseLinuxTcpSocketTable,
  parseProductWindowLine,
  prepareProductWindowForCommandPalette,
  processDescendsFrom,
  processesReferencingRoots,
  readLinuxProcessCensus,
  runtimeGenerationIsDrained,
  sameLinuxProcess,
  stopOwnedDisplay,
  summarizeRuntimeHostNetwork,
} from "../scripts/linux-packaged-product-smoke";
import {
  TAURI_SIDECAR_ENVELOPE_FILENAME,
  digestLinkFreeTree,
  serializeTauriSidecarEnvelope,
  tauriExternalBinaryFilename,
} from "../scripts/tauri-sidecar-envelope";

const TARGET = Object.freeze({
  runtimeFlavor: "node" as const,
  platform: "linux" as const,
  arch: "x64" as const,
  targetTriple: "x86_64-unknown-linux-gnu",
  libc: "glibc" as const,
  nodeVersion: "24.16.0",
  nodeModuleAbi: 137,
  napiVersion: 10,
}) satisfies NodeRuntimeArtifactTarget;

test("parses only the owned Pi Workbench window and keeps both localized command labels", () => {
  assert.deepEqual(parseProductWindowLine("0x03a00007  0 4242 host Pi Workbench", 4242), {
    id: "0x03a00007",
    title: "Pi Workbench",
  });
  assert.equal(parseProductWindowLine("0x03a00007  0 4243 host Pi Workbench", 4242), undefined);
  assert.equal(
    parseProductWindowLine("0x03a00007  0 4242 host Pi Workbench — Loading", 4242),
    undefined,
  );
  assert.equal(parseProductWindowLine("malformed", 4242), undefined);
  assert.deepEqual(PRODUCT_TERMINAL_TOGGLE_COMMAND_TITLES, [
    { locale: "en-US", title: "Toggle terminal" },
    { locale: "zh-CN", title: "切换终端" },
  ]);
  assert.deepEqual(PRODUCT_RUNTIME_RESTART_COMMAND_TITLES, [
    { locale: "en-US", title: "Restart local service" },
    { locale: "zh-CN", title: "重启本地服务" },
  ]);
});

test("moves focus out of an active terminal before opening the command palette", async () => {
  const calls: Array<Readonly<{ executable: string; args: readonly string[] }>> = [];
  const productWindow = { id: "0x03a00007", title: "Pi Workbench" } as const;
  const environment = { DISPLAY: ":99" };

  await prepareProductWindowForCommandPalette(
    productWindow,
    environment,
    async (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "getactivewindow") {
        return { stdout: String(Number.parseInt(productWindow.id.slice(2), 16)), stderr: "" };
      }
      if (args[0] === "getwindowgeometry") {
        return {
          stdout: "WINDOW=60817415\nX=0\nY=0\nWIDTH=1200\nHEIGHT=760\nSCREEN=0\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  );

  assert.deepEqual(
    calls.map(({ executable, args }) => [executable, ...args]),
    [
      ["xdotool", "windowactivate", "--sync", productWindow.id],
      ["xdotool", "getactivewindow"],
      ["xdotool", "key", "--clearmodifiers", "Escape"],
      ["xdotool", "getwindowgeometry", "--shell", productWindow.id],
      ["xdotool", "mousemove", "--window", productWindow.id, "600", "20"],
      ["xdotool", "click", "--clearmodifiers", "1"],
      ["xdotool", "windowactivate", "--sync", productWindow.id],
      ["xdotool", "getactivewindow"],
    ],
  );
});

test("parses only owned Linux TCP listener and established sockets", () => {
  const table = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:A86C 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242",
    "   1: 0100007F:A86C 0100007F:BEEF 01 00000000:00000000 00:00000000 00000000  1000        0 4243",
    "   2: 0100007F:A86D 0100007F:BEEE 01 00000000:00000000 00:00000000 00000000  1000        0 4244",
  ].join("\n");

  const sockets = parseLinuxTcpSocketTable(table, new Set(["4242", "4243", "4244"]));
  assert.deepEqual(sockets, [
    { inode: "4242", localPort: 43_116, state: "0A" },
    { inode: "4243", localPort: 43_116, state: "01" },
    { inode: "4244", localPort: 43_117, state: "01" },
  ]);
  assert.deepEqual(summarizeRuntimeHostNetwork(sockets), {
    hasEstablishedConnection: true,
    listeningPorts: [43_116],
  });
  assert.deepEqual(summarizeRuntimeHostNetwork(sockets.filter(({ inode }) => inode !== "4243")), {
    hasEstablishedConnection: false,
    listeningPorts: [43_116],
  });
});

test("stops the owned window manager and Xvfb before the residue proof", async () => {
  const order: string[] = [];
  let display: Readonly<{ windowManager: string; xvfb: string }> | undefined = {
    windowManager: "window-manager",
    xvfb: "xvfb",
  };
  display = await stopOwnedDisplay(display, async (child) => {
    order.push(`stop:${child}`);
  });
  order.push("prove:no-residue");

  assert.equal(display, undefined);
  assert.deepEqual(order, ["stop:window-manager", "stop:xvfb", "prove:no-residue"]);
});

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("admits one extracted final Debian envelope and rejects native resource drift", async (t) => {
  const extractionRoot = await temporaryDirectory(t, "workbench-tauri-deb-fixture-");
  const binRoot = path.join(extractionRoot, "usr", "bin");
  const runtimeRoot = path.join(extractionRoot, "usr", "lib", "Pi Workbench", "runtime");
  await mkdir(binRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  const mainExecutable = path.join(binRoot, "workbench-desktop-tauri");
  const sidecarExecutable = path.join(binRoot, "workbench-runtime-node");
  const sidecarBytes = "final packaged node fixture\n";
  await writeFile(mainExecutable, "tauri fixture\n", { mode: 0o755 });
  await writeFile(sidecarExecutable, sidecarBytes, { mode: 0o755 });
  await chmod(mainExecutable, 0o755);
  await chmod(sidecarExecutable, 0o755);
  await writeFile(path.join(runtimeRoot, "server.mjs"), "export {};\n");

  const nativePaths = [
    "node_modules/node-pty/pty.node",
    "node_modules/tree-sitter-bash/tree-sitter-bash.node",
    "node_modules/tree-sitter/tree-sitter.node",
  ];
  const nativeFiles: RuntimeArtifactNativeInventoryFile[] = [];
  for (const [index, relative] of nativePaths.entries()) {
    const absolute = path.join(runtimeRoot, ...relative.split("/"));
    const bytes = `native-${index}\n`;
    const packagedMode = index === 0 ? 0o755 : 0o644;
    const inventoryMode = packagedMode | 0o020;
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { mode: packagedMode });
    await chmod(absolute, packagedMode);
    nativeFiles.push({
      path: relative,
      size: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
      mode: inventoryMode,
    });
  }
  const inventory = {
    schemaVersion: 1,
    target: TARGET,
    files: nativeFiles,
  } as const;
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const inventoryPath = path.join(runtimeRoot, "native-runtime-inventory.json");
  await writeFile(inventoryPath, inventoryBytes);
  const manifest = {
    schemaVersion: 2,
    artifactKind: "workbench-runtime-node",
    runtimeMode: "api-only",
    controlVersion: 1,
    hostProtocolVersion: 1,
    target: TARGET,
    entrypoint: "server.mjs",
    externalPackages: RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
    dynamicPackages: RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
    resources: [],
    modelReadableResources: [],
    nativePackages: RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
    nativeInventory: {
      path: "native-runtime-inventory.json",
      size: Buffer.byteLength(inventoryBytes),
      sha256: sha256(inventoryBytes),
    },
    links: [],
    upgradeRequiredPaths: ["/api/runtime-upgrade"],
  } as const;
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(runtimeRoot, RUNTIME_ARTIFACT_MANIFEST_FILENAME), manifestBytes);
  const runtimeTree = await digestLinkFreeTree(runtimeRoot);
  const envelope = {
    schemaVersion: 1,
    kind: "workbench-tauri-sidecar-envelope",
    target: TARGET,
    nodeBinary: {
      filename: tauriExternalBinaryFilename(TARGET),
      size: Buffer.byteLength(sidecarBytes),
      sha256: sha256(sidecarBytes),
    },
    sourceManifest: {
      filename: RUNTIME_ARTIFACT_MANIFEST_FILENAME,
      size: Buffer.byteLength(manifestBytes),
      sha256: sha256(manifestBytes),
    },
    materializedTree: runtimeTree,
  } as const;
  await writeFile(
    path.join(runtimeRoot, TAURI_SIDECAR_ENVELOPE_FILENAME),
    serializeTauriSidecarEnvelope(envelope),
  );

  const packaged = await inspectPackagedRuntime(extractionRoot, {
    packageMetadata: {
      packageName: "pi-workbench",
      version: "0.1.0",
      architecture: "amd64",
    },
    commandRunner: async () => ({ stdout: "", stderr: "" }),
    probeSidecar: async (executable) => {
      assert.equal(executable, sidecarExecutable);
      return {
        runtimeFlavor: "node",
        platform: "linux",
        arch: "x64",
        nodeVersion: "24.16.0",
        nodeModuleAbi: 137,
        napiVersion: 10,
        glibcVersionRuntime: "2.39",
      };
    },
  });
  assert.equal(packaged.envelope.materializedTree.sha256, runtimeTree.sha256);
  assert.equal(packaged.nativeInventory.files.length, 3);

  await writeFile(path.join(runtimeRoot, nativePaths[0]), "drifted\n");
  await assert.rejects(
    inspectPackagedRuntime(extractionRoot, {
      packageMetadata: {
        packageName: "pi-workbench",
        version: "0.1.0",
        architecture: "amd64",
      },
      probeSidecar: async () => {
        throw new Error("probe must not run after integrity drift");
      },
    }),
    /resource tree|native inventory/u,
  );
});

function procStat({
  pid,
  ppid,
  processGroupId,
  sessionId,
  ttyNumber,
  startTimeTicks,
}: {
  readonly pid: number;
  readonly ppid: number;
  readonly processGroupId: number;
  readonly sessionId: number;
  readonly ttyNumber: number;
  readonly startTimeTicks: string;
}): string {
  const fields = [
    "S",
    String(ppid),
    String(processGroupId),
    String(sessionId),
    String(ttyNumber),
    ...Array.from({ length: 14 }, () => "0"),
    startTimeTicks,
  ];
  return `${pid} (fixture process) ${fields.join(" ")}\n`;
}

async function writeProcProcess(
  procRoot: string,
  fixture: {
    readonly pid: number;
    readonly ppid: number;
    readonly processGroupId: number;
    readonly sessionId: number;
    readonly ttyNumber: number;
    readonly startTimeTicks: string;
    readonly executable: string;
    readonly cwd: string;
    readonly stdinTarget?: string;
    readonly environ?: string;
    readonly socketInode?: string;
  },
): Promise<void> {
  const directory = path.join(procRoot, String(fixture.pid));
  await mkdir(path.join(directory, "fd"), { recursive: true });
  await writeFile(path.join(directory, "stat"), procStat(fixture));
  await writeFile(path.join(directory, "cmdline"), `fixture\0${fixture.pid}\0`);
  await writeFile(path.join(directory, "environ"), fixture.environ ?? "LANG=C\0");
  await symlink(fixture.executable, path.join(directory, "exe"));
  await symlink(fixture.cwd, path.join(directory, "cwd"));
  if (fixture.stdinTarget) await symlink(fixture.stdinTarget, path.join(directory, "fd", "0"));
  if (fixture.socketInode)
    await symlink(`socket:[${fixture.socketInode}]`, path.join(directory, "fd", "7"));
}

test("Linux census preserves exact ancestry, PTY scope, roots, sockets, and credential signal", async (t) => {
  const procRoot = await temporaryDirectory(t, "workbench-tauri-proc-fixture-");
  await writeProcProcess(procRoot, {
    pid: 90,
    ppid: 1,
    processGroupId: 90,
    sessionId: 90,
    ttyNumber: 0,
    startTimeTicks: "900",
    executable: "/usr/bin/dbus-run-session",
    cwd: "/state/home",
  });
  await writeProcProcess(procRoot, {
    pid: 100,
    ppid: 90,
    processGroupId: 90,
    sessionId: 90,
    ttyNumber: 0,
    startTimeTicks: "1000",
    executable: "/package/usr/bin/workbench-desktop-tauri",
    cwd: "/state/home",
  });
  await writeProcProcess(procRoot, {
    pid: 105,
    ppid: 100,
    processGroupId: 105,
    sessionId: 90,
    ttyNumber: 0,
    startTimeTicks: "1050",
    executable: "/package/usr/bin/workbench-desktop-tauri",
    cwd: "/state/home",
  });
  await writeProcProcess(procRoot, {
    pid: 110,
    ppid: 100,
    processGroupId: 105,
    sessionId: 90,
    ttyNumber: 0,
    startTimeTicks: "1100",
    executable: "/package/usr/bin/workbench-runtime-node",
    cwd: "/package/usr/lib/app/runtime",
    environ: "WORKBENCH_RUNTIME_ACCESS_TOKEN=secret-material-123456789\0",
    socketInode: "4242",
  });
  await writeProcProcess(procRoot, {
    pid: 120,
    ppid: 110,
    processGroupId: 120,
    sessionId: 120,
    ttyNumber: 34_817,
    startTimeTicks: "1200",
    executable: "/bin/bash",
    cwd: "/state/home",
    stdinTarget: "/dev/pts/7",
  });
  await writeProcProcess(procRoot, {
    pid: 121,
    ppid: 120,
    processGroupId: 121,
    sessionId: 120,
    ttyNumber: 34_817,
    startTimeTicks: "1210",
    executable: "/bin/sleep",
    cwd: "/state/home",
    stdinTarget: "/dev/pts/7",
  });
  await writeProcProcess(procRoot, {
    pid: 200,
    ppid: 1,
    processGroupId: 200,
    sessionId: 200,
    ttyNumber: 0,
    startTimeTicks: "2000",
    executable: "/package/usr/bin/workbench-desktop-tauri",
    cwd: "/unrelated",
  });
  const census = await readLinuxProcessCensus(procRoot);
  assert.equal(census.size, 7);
  assert.equal(processDescendsFrom(census, 120, 100), true);
  assert.equal(processDescendsFrom(census, 100, 120), false);
  assert.equal(sameLinuxProcess(census, { pid: 110, startTimeTicks: "1100" }), true);
  assert.equal(sameLinuxProcess(census, { pid: 110, startTimeTicks: "changed" }), false);
  assert.equal(census.get(110)?.credentialMaterialPresent, true);
  assert.deepEqual(census.get(110)?.socketInodes, ["4242"]);
  assert.equal(census.get(120)?.stdinTarget, "/dev/pts/7");
  const discovered = discoverOwnedPackagedProcesses(census, {
    ownerPid: 90,
    mainExecutable: "/package/usr/bin/workbench-desktop-tauri",
    sidecarExecutable: "/package/usr/bin/workbench-runtime-node",
  });
  assert.deepEqual(
    discovered.owned.map((process) => process.pid),
    [90, 100, 105, 110, 120, 121],
  );
  assert.equal(discovered.tauri?.pid, 100);
  assert.equal(discovered.watchdog?.pid, 105);
  assert.equal(discovered.host?.pid, 110);
  assert.equal(discovered.pty?.pid, 120);
  const firstGeneration = {
    watchdog: discovered.watchdog!,
    host: discovered.host!,
    pty: discovered.pty,
    hostPorts: new Set([43_100]),
  };
  assert.equal(runtimeGenerationIsDrained(census, firstGeneration, new Set()), false);
  const replacementCensus = new Map(census);
  for (const pid of [105, 110, 120, 121]) replacementCensus.delete(pid);
  assert.equal(
    runtimeGenerationIsDrained(replacementCensus, firstGeneration, new Set([43_100])),
    false,
  );
  assert.equal(
    runtimeGenerationIsDrained(replacementCensus, firstGeneration, new Set([43_101])),
    true,
  );
  const exactScope = linuxExactProcessGroupScope(discovered);
  assert.equal(exactScope.processGroupId, 105);
  assert.deepEqual(
    exactScope.members.map((process) => process.pid),
    [105, 110],
  );
  assert.equal(exactScope.ptyInsideScope, false);
  assert.deepEqual(LINUX_WINDOW_MANAGER_SESSION_COMMAND, {
    executable: "dbus-run-session",
    args: ["--", "metacity", "--sm-disable", "--replace"],
  });
  assert.deepEqual(
    processesReferencingRoots(census, ["/package", "/state"])
      .map((process) => process.pid)
      .sort((left, right) => left - right),
    [90, 100, 105, 110, 120, 121, 200],
  );
});
