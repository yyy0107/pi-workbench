import { runRuntimeConnectedWebProcess } from "./server/runtime-connected-web-process";

void runRuntimeConnectedWebProcess().catch(() => {
  // The control path may carry a Runtime credential. Keep the fallback deliberately non-reflective.
  console.error("Failed to start Runtime-connected Workbench Web.");
  process.exit(1);
});
