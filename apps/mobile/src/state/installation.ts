export interface MobileInstallationSentinelPort {
  exists(): Promise<boolean>;
  create(): Promise<void>;
}

export interface MobileInstallationCredentialPort {
  clearAll(): Promise<void>;
  clearMachine(machineId: string): Promise<void>;
}

export interface MobileInstallationProjectionPort {
  clearAll(): Promise<void>;
  clearMachine(machineId: string): Promise<void>;
}

interface MobileInstallationPorts {
  readonly sentinel: MobileInstallationSentinelPort;
  readonly credentials: MobileInstallationCredentialPort;
  readonly projection: MobileInstallationProjectionPort;
}

export function createMobileInstallationPorts(
  input: MobileInstallationPorts,
): MobileInstallationPorts {
  return input;
}

export async function reconcileMobileInstallation(
  input: MobileInstallationPorts & { readonly platform: "android" | "ios" },
): Promise<"existing" | "initialized"> {
  if (await input.sentinel.exists()) return "existing";
  await input.credentials.clearAll();
  await input.projection.clearAll();
  await input.sentinel.create();
  return "initialized";
}

export type ClearMobileAuthorizationInput = MobileInstallationPorts & {
  readonly machineId: string;
};

export async function clearMobileAuthorization(
  input: ClearMobileAuthorizationInput,
): Promise<void> {
  await input.credentials.clearMachine(input.machineId);
  await input.projection.clearMachine(input.machineId);
}
