# @workbench/pi-model-server

src owns provider/model configuration, auth/catalog operations and protected SDK service construction; lib supplies the existing image-input probe used by ModelService. Host composition injects project trust and request-time Trace observer lookup through narrow ports. Captured host fetch and the protected ModelRuntime WeakSet remain module scoped; no extra runtime or credential owner is introduced. Keep TS and shallow roots. Config tests live in tests/; model/trust/Trace composition and RPC tests remain in pi/server/tests.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/image-probe.ts` imports `lib/image-input-probe.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
