import { useI18n } from "@workbench/i18n";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { mobileTranslationBundle } from "../i18n/index.ts";
import { MobileIcon } from "./mobile-icon.tsx";

export interface MobileTextComposerProps {
  readonly value: string;
  readonly ready: boolean;
  readonly outcomeUnknownOperationId?: string;
  readonly colors: {
    readonly foreground: string;
    readonly muted: string;
    readonly border: string;
    readonly surface: string;
    readonly accent: string;
    readonly accentText: string;
    readonly warningText: string;
  };
  onChange(value: string): void | Promise<void>;
  onSend(): void | Promise<void>;
  onRetry?(operationId: string): void | Promise<void>;
}

export function MobileTextComposer(props: MobileTextComposerProps) {
  const { t } = useI18n(mobileTranslationBundle);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy || !props.ready || !props.value.trim()) return;
    setBusy(true);
    try {
      await props.onSend();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {!props.ready ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.notice, { color: props.colors.muted }]}
        >
          {t("mobile.composer.offline")}
        </Text>
      ) : null}
      {props.outcomeUnknownOperationId ? (
        <View style={styles.unknownRow}>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.notice, { color: props.colors.warningText }]}
          >
            {t("mobile.composer.outcomeUnknown")}
          </Text>
          {props.onRetry ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void props.onRetry?.(props.outcomeUnknownOperationId!)}
              style={({ pressed }) => [styles.retryButton, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={[styles.retryText, { color: props.colors.foreground }]}>
                {t("mobile.composer.retry")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View
        style={[
          styles.inputRow,
          { backgroundColor: props.colors.surface, borderColor: props.colors.border },
        ]}
      >
        <TextInput
          accessibilityLabel={t("mobile.composer.inputLabel")}
          editable={!busy}
          multiline
          onChangeText={(value) => void props.onChange(value)}
          placeholder={t("mobile.composer.placeholder")}
          placeholderTextColor={props.colors.muted}
          style={[
            styles.input,
            {
              backgroundColor: props.colors.surface,
              borderColor: props.colors.border,
              color: props.colors.foreground,
            },
          ]}
          value={props.value}
        />
        <Pressable
          accessibilityLabel={t("mobile.composer.send")}
          accessibilityRole="button"
          accessibilityState={{
            busy,
            disabled: busy || !props.ready || !props.value.trim(),
          }}
          disabled={busy || !props.ready || !props.value.trim()}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: props.colors.accent,
              opacity: busy || !props.ready || !props.value.trim() ? 0.4 : pressed ? 0.72 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={props.colors.accentText} size="small" />
          ) : (
            <MobileIcon color={props.colors.accentText} name="arrow-up" size={24} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, paddingHorizontal: 4, paddingTop: 8 },
  notice: { flex: 1, fontSize: 13, lineHeight: 18 },
  unknownRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  retryButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: 6 },
  retryText: { fontSize: 13, fontWeight: "600" },
  inputRow: {
    alignItems: "flex-end",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 30,
    flexDirection: "row",
    gap: 6,
    minHeight: 60,
    padding: 6,
    paddingLeft: 8,
  },
  input: {
    borderRadius: 24,
    borderWidth: 0,
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    maxHeight: 128,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
});
