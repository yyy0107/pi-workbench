export interface MobileNetworkState {
  readonly connected: boolean;
  readonly reachable: boolean;
}

interface NetInfoState {
  readonly isConnected: boolean | null;
  readonly isInternetReachable: boolean | null;
}

interface NetInfoPort {
  fetch(): Promise<NetInfoState>;
  addEventListener(listener: (state: NetInfoState) => void): () => void;
}

function normalize(value: NetInfoState): MobileNetworkState {
  return Object.freeze({
    connected: value.isConnected === true,
    reachable: value.isInternetReachable !== false && value.isConnected === true,
  });
}

export function createMobileNetworkPlatform(options: { readonly netInfo?: NetInfoPort } = {}) {
  const netInfo = options.netInfo ?? NetInfo;
  return {
    async current(): Promise<MobileNetworkState> {
      return normalize(await netInfo.fetch());
    },
    subscribe(listener: (state: MobileNetworkState) => void): () => void {
      return netInfo.addEventListener((state) => listener(normalize(state)));
    },
  };
}
import NetInfo from "@react-native-community/netinfo";
