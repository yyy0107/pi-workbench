import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { parseWebArtifactCli } from "./web-artifact-cli";
import { claimWebControlStdout } from "./web-control-stdout";

export interface RunWebArtifactMainOptions {
  readonly argv?: readonly string[];
  readonly artifactRoot?: string;
  readonly forceExit?: (code: 0 | 1) => void;
  readonly importWebHostProcess?: () => Promise<
    Pick<typeof import("./web-host-process"), "runWebHostProcess">
  >;
}

/** Claims stdout before dynamically importing Next or any other Web application module. */
export async function runWebArtifactMain({
  argv = process.argv.slice(2),
  artifactRoot = path.dirname(fileURLToPath(import.meta.url)),
  forceExit = (code) => process.exit(code),
  importWebHostProcess = () => import("./web-host-process"),
}: RunWebArtifactMainOptions = {}): Promise<void> {
  const controlStdout = claimWebControlStdout();
  try {
    parseWebArtifactCli(argv);
    const { runWebHostProcess } = await importWebHostProcess();
    await runWebHostProcess({ artifactRoot, output: controlStdout.output, forceExit });
  } finally {
    controlStdout.release();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runWebArtifactMain().catch(() => {
    // Session code already emits fixed protocol errors. Never expose paths or Next diagnostics.
    console.error("Web Host process failed.");
    process.exit(1);
  });
}
