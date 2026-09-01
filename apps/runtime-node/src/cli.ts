export interface RuntimeNodeCliOptions {
  readonly control: "stdio";
}

/** The Runtime app has one production mode: authenticated API-only Host over NDJSON stdio control. */
export function parseRuntimeNodeCli(argv: readonly string[]): RuntimeNodeCliOptions {
  const arguments_ = [...argv];
  if (arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--control-stdio")) {
    return Object.freeze({ control: "stdio" });
  }
  throw new Error("Unsupported Runtime Host command line.");
}
