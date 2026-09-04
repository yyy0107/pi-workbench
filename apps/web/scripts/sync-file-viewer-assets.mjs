import { createRequire } from "node:module";

import workbenchPaths from "../../../scripts/workbench-paths.cjs";
import { syncFileViewerAssets } from "../../../scripts/sync-static-assets.mjs";

await syncFileViewerAssets({
  publicRoot: workbenchPaths.defaultWorkbenchPaths.webPublicRoot,
  require: createRequire(import.meta.url),
});
