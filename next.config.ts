import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Pi keeps several Node-only providers behind variable dynamic imports. Let Node resolve both
  // packages at runtime so Turbopack does not replace those imports with throwing stubs.
  serverExternalPackages: ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"],
};
export default withAui(nextConfig);
