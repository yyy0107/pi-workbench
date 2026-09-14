import { useI18n } from "@workbench/i18n";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { RemoteRunStateV1 } from "@workbench/remote-control-contracts/protocol";
import { mobileTranslationBundle } from "../i18n/index.ts";

const ACTIVE_STATES: ReadonlySet<RemoteRunStateV1> = new Set([
  "queued",
  "running",
  "waiting-for-input",
  "stopping",
]);

export function MobileRunControls(props: {
  readonly runState: RemoteRunStateV1;
  readonly ready: boolean;
  readonly colors: {
    readonly foreground: string;
    readonly muted: string;
    readonly border: string;
    readonly danger: string;
  };
  onStop(): void | Promise<void>;
}) {
  const { t } = useI18n(mobileTranslationBundle);
  const labels: Record<RemoteRunStateV1, string> = {
    idle: t("mobile.run.idle"),
    queued: t("mobile.run.queued"),
    running: t("mobile.run.running"),
    "waiting-for-input": t("mobile.run.waitingForInput"),
    stopping: t("mobile.run.stopping"),
    completed: t("mobile.run.completed"),
    stopped: t("mobile.run.stopped"),
    failed: t("mobile.run.failed"),
  };
  const canStop = props.ready && ACTIVE_STATES.has(props.runState) && props.runState !== "stopping";
  return (
    <View style={styles.row}>
      <Text style={[styles.state, { color: props.colors.muted }]}>{labels[props.runState]}</Text>
      {ACTIVE_STATES.has(props.runState) ? (
        <Pressable
          accessibilityRole="button"
          disabled={!canStop}
          onPress={() => void props.onStop()}
          style={({ pressed }) => [
            styles.stopButton,
            {
              borderColor: props.colors.border,
              opacity: canStop ? (pressed ? 0.65 : 1) : 0.4,
            },
          ]}
        >
          <Text style={[styles.stopText, { color: props.colors.danger }]}>
            {props.runState === "stopping" ? t("mobile.run.stopping") : t("mobile.run.stop")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  state: { fontSize: 14, fontWeight: "600" },
  stopButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  stopText: { fontSize: 14, fontWeight: "600" },
});
