import { pathToFileURL } from "node:url";

import { parseRuntimeNodeCli } from "./cli";
import { claimRuntimeControlStdout } from "./runtime-control-stdout";

export interface RuntimeNodeMainOptions {
  readonly argv?: readonly string[];
  readonly forceExit?: (code: 0 | 1) => void;
  readonly importRuntimeHost?: () => Promise<
    Pick<typeof import("./installed-api-only-runtime-host"), "runInstalledRuntimeHostControl">
  >;
}

/** Claims stdout before importing the Pi/Terminal graph, so only control frames can reach it. */
export async function runRuntimeNodeMain({
  argv = process.argv.slice(2),
  forceExit = (code) => process.exit(code),
  importRuntimeHost = () => import("./installed-api-only-runtime-host"),
}: RuntimeNodeMainOptions = {}): Promise<void> {
  const controlStdout = claimRuntimeControlStdout();
  try {
    parseRuntimeNodeCli(argv);
    const { runInstalledRuntimeHostControl } = await importRuntimeHost();
    await runInstalledRuntimeHostControl({ output: controlStdout.output, forceExit });
  } finally {
    controlStdout.release();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runRuntimeNodeMain().catch(() => {
    // Control/session implementations already emit their stable protocol errors. Never include
    // argv, credentials, child stderr or third-party error text in the process-level fallback.
    console.error("Runtime Host process failed.");
    process.exit(1);
  });
}
