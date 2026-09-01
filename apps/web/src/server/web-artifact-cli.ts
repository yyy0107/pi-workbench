export interface WebArtifactCliOptions {
  readonly control: "stdio";
}

/** The independent Web artifact has one process mode and accepts no filesystem configuration. */
export function parseWebArtifactCli(argv: readonly string[]): WebArtifactCliOptions {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--control-stdio")) {
    return Object.freeze({ control: "stdio" });
  }
  throw new Error("Unsupported Web Host command line.");
}
