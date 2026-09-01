const runtimeHostControl = require("@workbench/host-contracts/runtime-host-control");

const { resolveDesktopArtifactLayout } = require("./desktop-artifact-layout.cjs");

module.exports = {
  resolveDesktopArtifactLayout,
  runtimeHostControl,
};
