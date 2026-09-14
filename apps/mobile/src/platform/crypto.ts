import {
  openDirectRemoteEnvelope,
  sealDirectRemoteEnvelope,
  type DirectEnvelopeOpenInput,
  type DirectEnvelopeSealInput,
} from "@workbench/remote-control-contracts/direct-crypto";

interface MobileNativeCryptoModule {
  install(): void;
}

interface RequiredHpkeCrypto {
  readonly getRandomValues: (...arguments_: never[]) => unknown;
  readonly subtle: {
    readonly decrypt: (...arguments_: never[]) => unknown;
    readonly deriveBits: (...arguments_: never[]) => unknown;
    readonly digest: (...arguments_: never[]) => unknown;
    readonly encrypt: (...arguments_: never[]) => unknown;
    readonly exportKey: (...arguments_: never[]) => unknown;
    readonly generateKey: (...arguments_: never[]) => unknown;
    readonly importKey: (...arguments_: never[]) => unknown;
  };
}

export interface MobileHpkeRuntimeOptions {
  readonly forceNativeInstall?: boolean;
  readonly loadNativeCrypto?: () => Promise<MobileNativeCryptoModule>;
  readonly readCrypto?: () => unknown;
}

export type MobileHpkeRuntimeSource = "existing-webcrypto" | "react-native-quick-crypto";

function hasFunction(value: unknown): boolean {
  return typeof value === "function";
}

function isRequiredHpkeCrypto(value: unknown): value is RequiredHpkeCrypto {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RequiredHpkeCrypto>;
  const subtle = candidate.subtle;
  return (
    hasFunction(candidate.getRandomValues) &&
    subtle !== null &&
    typeof subtle === "object" &&
    hasFunction(subtle.decrypt) &&
    hasFunction(subtle.deriveBits) &&
    hasFunction(subtle.digest) &&
    hasFunction(subtle.encrypt) &&
    hasFunction(subtle.exportKey) &&
    hasFunction(subtle.generateKey) &&
    hasFunction(subtle.importKey)
  );
}

async function loadReactNativeQuickCrypto(): Promise<MobileNativeCryptoModule> {
  return import("react-native-quick-crypto");
}

export async function initializeMobileHpkeRuntime(
  options: MobileHpkeRuntimeOptions = {},
): Promise<MobileHpkeRuntimeSource> {
  const readCrypto = options.readCrypto ?? (() => globalThis.crypto);
  if (!options.forceNativeInstall && isRequiredHpkeCrypto(readCrypto())) {
    return "existing-webcrypto";
  }

  const nativeCrypto = await (options.loadNativeCrypto ?? loadReactNativeQuickCrypto)();
  nativeCrypto.install();
  if (!isRequiredHpkeCrypto(readCrypto())) {
    throw new Error(
      "Workbench Remote requires a development build with native WebCrypto support; Expo Go is unsupported.",
    );
  }
  return "react-native-quick-crypto";
}

export async function sealMobileRemoteEnvelope(
  input: DirectEnvelopeSealInput,
): Promise<Awaited<ReturnType<typeof sealDirectRemoteEnvelope>>> {
  await initializeMobileHpkeRuntime();
  return sealDirectRemoteEnvelope(input);
}

export async function openMobileRemoteEnvelope(
  input: DirectEnvelopeOpenInput,
): Promise<Uint8Array> {
  await initializeMobileHpkeRuntime();
  return openDirectRemoteEnvelope(input);
}
