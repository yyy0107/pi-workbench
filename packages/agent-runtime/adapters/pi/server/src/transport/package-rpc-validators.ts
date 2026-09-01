import type {
  InstalledPackageDescribePayload,
  PiPackageCatalogDescribePayload,
  PiPackageCatalogSearchPayload,
  PiPackageInstallPayload,
  PiPackageMutationTarget,
  PiPackageRemovePayload,
  PiPackageUpdatePayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { resourceCatalogTarget } from "./resource-rpc-validators";
import {
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcObject,
  rpcOptional,
  rpcRefine,
  rpcString,
  rpcUnion,
  type RpcValidator,
} from "./rpc-transport";

const nonEmptyString = rpcString({ minLength: 1 });

export const packageCatalogNameValidator = rpcRefine(
  rpcString({ minLength: 1, maxLength: 214, trim: true }),
  (name) => /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name),
  { message: "Expected a valid npm package name." },
);

export const packageSourceValidator = rpcRefine(
  rpcString({ minLength: 1, maxLength: 2_048, trim: true }),
  (source) =>
    [...source].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    }),
  { message: "Package sources cannot contain control characters." },
);

export const packageMutationTargetValidator = rpcUnion([
  rpcObject({ scope: rpcLiteral("user"), sessionId: rpcOptional(nonEmptyString) }),
  rpcObject({ scope: rpcLiteral("project"), workspaceId: nonEmptyString }),
]) as RpcValidator<PiPackageMutationTarget>;

export const packageCatalogSearchPayload = rpcObject({
  query: rpcOptional(rpcString({ maxLength: 200, trim: true })),
  type: rpcOptional(rpcEnum(["extension", "skill", "prompt", "theme"])),
  sort: rpcOptional(rpcEnum(["downloads", "recent", "name"])),
  page: rpcOptional(rpcInteger({ minimum: 1, maximum: 10_000 })),
}) as RpcValidator<PiPackageCatalogSearchPayload>;

export const packageCatalogDescribePayload = rpcObject({
  name: packageCatalogNameValidator,
}) as RpcValidator<PiPackageCatalogDescribePayload>;

export const packageDescribePayload = rpcObject({
  source: packageSourceValidator,
  target: resourceCatalogTarget,
}) as RpcValidator<InstalledPackageDescribePayload>;

export const packageInstallPayload = rpcObject({
  name: packageCatalogNameValidator,
  target: packageMutationTargetValidator,
}) as RpcValidator<PiPackageInstallPayload>;

export const packageSourceMutationPayload = rpcObject({
  source: packageSourceValidator,
  target: packageMutationTargetValidator,
}) as RpcValidator<PiPackageUpdatePayload | PiPackageRemovePayload>;
