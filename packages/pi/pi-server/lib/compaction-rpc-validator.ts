import { rpcBoolean, rpcInteger, rpcObject, rpcOptional } from "@workbench/host-server/rpc";

export const compactionSettingsPatch = rpcObject({
  enabled: rpcOptional(rpcBoolean),
  reserveTokens: rpcOptional(rpcInteger({ minimum: 1, maximum: 10_000_000 })),
  keepRecentTokens: rpcOptional(rpcInteger({ minimum: 1, maximum: 10_000_000 })),
});
