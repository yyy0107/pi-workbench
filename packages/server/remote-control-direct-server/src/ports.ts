import type {
  DirectEndpointV1,
  DirectSealedEnvelopeV1,
  RemoteAction,
} from "@workbench/remote-control-contracts/protocol";

export interface DirectInterfaceAddress {
  readonly interfaceId: string;
  readonly interfaceName: string;
  readonly address: string;
  readonly family: "ipv4" | "ipv6";
  readonly kind: DirectEndpointV1["kind"];
}

export interface DirectNetworkInterfacePort {
  list(): Promise<readonly DirectInterfaceAddress[]>;
}

export interface DirectSocketPort {
  readonly remoteAddress?: string;
  send(frame: string): Promise<void>;
  close(code?: number, reason?: string): void;
  onMessage(listener: (frame: string) => void): Disposable;
  onClose(listener: () => void): Disposable;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface PreparedListenerGeneration extends Disposable {
  readonly endpoints: readonly DirectEndpointV1[];
  commit(): Promise<Disposable>;
}

export interface DirectListenerPort {
  listInterfaces(): Promise<readonly DirectInterfaceAddress[]>;
  prepare(input: {
    readonly addresses: readonly DirectInterfaceAddress[];
    readonly port: number;
    readonly path: "/remote/v1/direct";
    readonly onSocket: (
      socket: DirectSocketPort,
      localEndpoint: DirectEndpointV1,
      mode: "pairing" | "authenticated",
    ) => void;
  }): Promise<PreparedListenerGeneration>;
  dispose(): Promise<void>;
}

export interface DesktopInstallationIdentity {
  readonly machineId: string;
  readonly displayName: string;
  readonly encryptionKeyId: string;
  readonly encryptionPublicKey: string;
  readonly encryptionPrivateKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}

export interface DirectListenerConfiguration {
  readonly enabled: boolean;
  readonly port: number;
  readonly selectedInterfaceIds: readonly string[];
  readonly revision: string;
  readonly updatedAt: string;
}

export interface PairedPhoneAuthorization {
  readonly deviceId: string;
  readonly displayName: string;
  readonly platform: "ios" | "android";
  readonly signingPublicKey: DirectPublicJwk;
  readonly signingKeyFingerprint: string;
  readonly encryptionKeyId: string;
  readonly encryptionPublicKey: string;
  readonly encryptionKeyFingerprint: string;
  readonly scope: readonly RemoteAction[];
  readonly revision: string;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
}

export interface DirectPublicJwk {
  readonly kty: string;
  readonly crv: string;
  readonly x: string;
  readonly y: string;
  readonly key_ops?: readonly string[];
  readonly ext?: boolean;
}

export interface DirectInstallationStorePort {
  loadInstallation(): Promise<DesktopInstallationIdentity | undefined>;
  saveInstallation(value: DesktopInstallationIdentity): Promise<void>;
  loadConfiguration(): Promise<DirectListenerConfiguration>;
  saveConfiguration(value: DirectListenerConfiguration): Promise<void>;
  listAuthorizations(): Promise<readonly PairedPhoneAuthorization[]>;
  replaceAuthorizations(value: readonly PairedPhoneAuthorization[]): Promise<void>;
  reset(): Promise<void>;
}

export interface DirectPairingApprovalPort {
  publishClaim(value: {
    readonly pairingId: string;
    readonly deviceId: string;
    readonly deviceDisplayName: string;
    readonly platform: "ios" | "android";
    readonly safetyCode: string;
    readonly expiresAt: string;
  }): void;
}

export interface DirectBusinessFramePort {
  process(input: {
    readonly connectionId: string;
    readonly authorization: PairedPhoneAuthorization;
    readonly envelope: DirectSealedEnvelopeV1;
  }): Promise<readonly DirectSealedEnvelopeV1[]>;
  subscribe(
    authorization: PairedPhoneAuthorization,
    send: (frame: DirectSealedEnvelopeV1) => Promise<void>,
  ): Disposable;
}
