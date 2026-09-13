# Pi model server

Keep model capability implementation/contracts in src and consumed helpers in lib, both TS with shallow roots. Reuse installed Pi SDK public ModelRuntime/createAgentSessionServices APIs and the existing credential/runtime instance. Inject trust and request observation; do not import session registry/Trace or resource-service implementations. Preserve captured host fetch, explicit fetch overrides, SDK proxy/auth/deferred behavior and protected runtime identity. Use fakes for provider tests; tests live in tests/.
