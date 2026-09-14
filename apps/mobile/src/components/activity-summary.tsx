import { useI18n } from "@workbench/i18n";
import type { RemoteConversationItemV1 } from "@workbench/remote-control-contracts/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { mobileTranslationBundle } from "../i18n/index.ts";
import { MobileIcon } from "./mobile-icon.tsx";

type RemoteActivitySummary = Extract<RemoteConversationItemV1, { type: "activity-summary" }>;

export function MobileActivitySummary(props: {
  readonly item: RemoteActivitySummary;
  readonly colors: {
    readonly foreground: string;
    readonly muted: string;
    readonly border: string;
    readonly warningText: string;
  };
}) {
  const { t } = useI18n(mobileTranslationBundle);
  const [expanded, setExpanded] = useState(Boolean(props.item.summary));
  const state =
    props.item.activity === "tool-running"
      ? t("mobile.conversation.activityRunning")
      : props.item.activity === "tool-completed"
        ? t("mobile.conversation.activityCompleted")
        : t("mobile.conversation.activityFailed");
  const stateColor =
    props.item.activity === "tool-failed" ? props.colors.warningText : props.colors.muted;

  return (
    <View style={[styles.container, { borderColor: props.colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        disabled={!props.item.summary}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.62 : 1 }]}
      >
        <MobileIcon
          color={props.colors.muted}
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={18}
        />
        <View style={styles.heading}>
          <Text numberOfLines={1} style={[styles.title, { color: props.colors.foreground }]}>
            {props.item.displayName}
          </Text>
          <Text style={[styles.state, { color: stateColor }]}>{state}</Text>
        </View>
      </Pressable>
      {expanded && props.item.summary ? (
        <Text selectable style={[styles.summary, { color: props.colors.foreground }]}>
          {props.item.summary}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingBottom: 18,
    paddingTop: 4,
  },
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
  },
  heading: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  state: { fontSize: 13, lineHeight: 18 },
  summary: { fontSize: 16, lineHeight: 25, paddingLeft: 26 },
});
