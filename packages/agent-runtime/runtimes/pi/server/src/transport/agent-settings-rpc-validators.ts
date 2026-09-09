import type { AgentSettingsUpdateRequest } from "../settings/agent-settings-service";
import { compactionSettingsPatch } from "./compaction-rpc-validator";
import { resourceCatalogTarget } from "./resource-rpc-validators";
import {
  rpcBoolean,
  rpcInteger,
  rpcObject,
  rpcOptional,
  rpcString,
  type RpcValidator,
} from "@workbench/host-server/rpc";

export const scopedDescribePayload = rpcObject({ target: resourceCatalogTarget });
const settingsUpdateFields = {
  ns: rpcString({ minLength: 1 }),
  patch: rpcObject({
    showCacheMissNotices: rpcOptional(rpcBoolean),
    systemPrompt: rpcOptional(rpcString({ maxLength: 500_000 })),
    appendSystemPrompt: rpcOptional(rpcString({ maxLength: 500_000 })),
    compaction: rpcOptional(compactionSettingsPatch),
  }),
  expectedRevision: rpcOptional(rpcInteger({ minimum: 0 })),
};
export const settingsUpdatePayload = rpcObject(
  settingsUpdateFields,
) as RpcValidator<AgentSettingsUpdateRequest>;
export const scopedUpdatePayload = rpcObject({
  ...settingsUpdateFields,
  target: resourceCatalogTarget,
}) as RpcValidator<AgentSettingsUpdateRequest>;
