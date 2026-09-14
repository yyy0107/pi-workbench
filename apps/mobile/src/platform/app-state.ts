export type MobileAppState = "active" | "background" | "inactive";

interface AppStateSubscription {
  remove(): void;
}

interface ReactNativeAppStatePort {
  readonly currentState: string | null;
  addEventListener(event: "change", listener: (state: string) => void): AppStateSubscription;
}

function normalize(value: string | null): MobileAppState {
  return value === "active" ? "active" : value === "background" ? "background" : "inactive";
}

export function createMobileAppStatePlatform(
  options: { readonly appState?: ReactNativeAppStatePort } = {},
) {
  const appState = options.appState ?? AppState;
  return {
    current: () => normalize(appState.currentState),
    subscribe(listener: (state: MobileAppState) => void): () => void {
      const subscription = appState.addEventListener("change", (state) =>
        listener(normalize(state)),
      );
      return () => subscription.remove();
    },
  };
}
import { AppState } from "react-native";
