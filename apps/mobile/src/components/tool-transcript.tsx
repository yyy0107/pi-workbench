import { useI18n } from "@workbench/i18n";
import type {
  RemoteConversationItemV1,
  RemoteToolCallV1,
} from "@workbench/remote-control-contracts/protocol";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { mobileTranslationBundle } from "../i18n/index.ts";
import type { MobilePalette } from "../ui/theme.ts";
import { MobileIcon } from "./mobile-icon.tsx";

type RemoteToolResult = Extract<RemoteConversationItemV1, { type: "tool-result" }>;

function TranscriptBlock(props: {
  readonly content: string;
  readonly emptyLabel: string;
  readonly label: string;
  readonly palette: MobilePalette;
}) {
  return (
    <View
      style={[
        styles.block,
        { backgroundColor: props.palette.subtleSurface, borderColor: props.palette.border },
      ]}
    >
      <Text style={[styles.blockLabel, { color: props.palette.muted }]}>{props.label}</Text>
      <Text selectable style={[styles.monospace, { color: props.palette.foreground }]}>
        {props.content || props.emptyLabel}
      </Text>
    </View>
  );
}

export function MobileToolCallTranscript(props: {
  readonly call: RemoteToolCallV1;
  readonly palette: MobilePalette;
}) {
  const { t } = useI18n(mobileTranslationBundle);
  const [expanded, setExpanded] = useState(true);
  return (
    <View style={[styles.container, { borderBottomColor: props.palette.border }]}>
      <Pressable
        accessibilityLabel={`${t("mobile.conversation.toolCall")}: ${props.call.toolName}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.heading, { opacity: pressed ? 0.62 : 1 }]}
      >
        <MobileIcon
          color={props.palette.muted}
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={17}
        />
        <View style={styles.headingCopy}>
          <Text numberOfLines={1} style={[styles.title, { color: props.palette.foreground }]}>
            {props.call.toolName}
          </Text>
          <Text style={[styles.state, { color: props.palette.muted }]}>
            {t("mobile.conversation.toolCall")}
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.content}>
          <TranscriptBlock
            content={props.call.arguments}
            emptyLabel={t("mobile.conversation.emptyToolInput")}
            label={t("mobile.conversation.toolInput")}
            palette={props.palette}
          />
          {props.call.truncated ? (
            <Text style={[styles.truncated, { color: props.palette.warningText }]}>
              {t("mobile.conversation.toolTruncated")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function MobileToolResultTranscript(props: {
  readonly item: RemoteToolResult;
  readonly palette: MobilePalette;
}) {
  const { t } = useI18n(mobileTranslationBundle);
  const [expanded, setExpanded] = useState(true);
  const state = props.item.isError
    ? t("mobile.conversation.toolFailed")
    : t("mobile.conversation.toolCompleted");
  return (
    <View style={[styles.container, { borderBottomColor: props.palette.border }]}>
      <Pressable
        accessibilityLabel={`${t("mobile.conversation.toolResult")}: ${props.item.toolName}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.heading, { opacity: pressed ? 0.62 : 1 }]}
      >
        <MobileIcon
          color={props.palette.muted}
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={17}
        />
        <View style={styles.headingCopy}>
          <Text numberOfLines={1} style={[styles.title, { color: props.palette.foreground }]}>
            {props.item.toolName}
          </Text>
          <Text
            style={[
              styles.state,
              { color: props.item.isError ? props.palette.danger : props.palette.muted },
            ]}
          >
            {state}
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.content}>
          {props.item.input !== undefined ? (
            <TranscriptBlock
              content={props.item.input}
              emptyLabel={t("mobile.conversation.emptyToolInput")}
              label={t("mobile.conversation.toolInput")}
              palette={props.palette}
            />
          ) : null}
          <TranscriptBlock
            content={props.item.output}
            emptyLabel={t("mobile.conversation.emptyToolOutput")}
            label={t("mobile.conversation.toolOutput")}
            palette={props.palette}
          />
          {props.item.truncated ? (
            <Text style={[styles.truncated, { color: props.palette.warningText }]}>
              {t("mobile.conversation.toolTruncated")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 16,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
  },
  headingCopy: { flex: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  state: { fontSize: 13, lineHeight: 18 },
  content: { gap: 8, paddingLeft: 25 },
  block: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 7,
    padding: 12,
  },
  blockLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2, lineHeight: 17 },
  monospace: {
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 13,
    lineHeight: 20,
  },
  truncated: { fontSize: 12, lineHeight: 17 },
});
