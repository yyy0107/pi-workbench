import { useI18n } from "@workbench/i18n";
import { StyleSheet, Text, View } from "react-native";

import type { MobileRemoteConnectionStatus } from "../state/remote-client.ts";
import { mobileTranslationBundle } from "../i18n/index.ts";

export function MobileConnectionStatus(props: {
  readonly status: MobileRemoteConnectionStatus;
  readonly colors: {
    readonly foreground: string;
    readonly muted: string;
    readonly border: string;
    readonly warningText?: string;
  };
  readonly compact?: boolean;
}) {
  const { t } = useI18n(mobileTranslationBundle);
  const labels: Record<MobileRemoteConnectionStatus, string> = {
    offline: t("mobile.connection.offline"),
    reconnecting: t("mobile.connection.reconnecting"),
    resyncing: t("mobile.connection.resyncing"),
    ready: t("mobile.connection.ready"),
    incompatible: t("mobile.connection.incompatible"),
    stale: t("mobile.connection.stale"),
    "outcome-checking": t("mobile.connection.outcomechecking"),
  };
  const emphasized = props.status !== "ready";
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={[
        styles.badge,
        {
          borderColor: props.colors.border,
          paddingHorizontal: props.compact ? 7 : 10,
          minHeight: props.compact ? 26 : 32,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        style={[
          styles.dot,
          {
            backgroundColor: emphasized
              ? (props.colors.warningText ?? props.colors.muted)
              : props.colors.foreground,
          },
        ]}
      />
      <Text
        style={[
          styles.label,
          {
            color: emphasized
              ? (props.colors.warningText ?? props.colors.muted)
              : props.colors.muted,
          },
        ]}
      >
        {labels[props.status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  dot: { borderRadius: 4, height: 7, width: 7 },
  label: { fontSize: 12, fontWeight: "600" },
});
