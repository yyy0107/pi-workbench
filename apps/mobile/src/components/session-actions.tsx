import { useI18n } from "@workbench/i18n";
import type { RemoteSessionSummaryV1 } from "@workbench/remote-control-contracts/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { mobileTranslationBundle } from "../i18n/index.ts";

interface SessionActionColors {
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly surface: string;
  readonly accent: string;
  readonly accentText: string;
  readonly danger: string;
  readonly warningText: string;
}

export function MobileSessionActions({
  canMutate,
  colors,
  onArchive,
  onRename,
  onSetPinned,
  session,
}: Readonly<{
  canMutate: boolean;
  colors: SessionActionColors;
  session: RemoteSessionSummaryV1;
  onRename(title: string): Promise<void>;
  onSetPinned(pinned: boolean): Promise<void>;
  onArchive(): Promise<void>;
}>) {
  const { t } = useI18n(mobileTranslationBundle);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(session.title ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"conflict" | "failed">();

  const safely = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? (cause as { code?: unknown }).code
          : cause instanceof Error
            ? cause.message
            : undefined;
      setError(code === "entity_revision_conflict" ? "conflict" : "failed");
    } finally {
      setPending(false);
    }
  };

  const disabled = !canMutate || pending;
  const buttonStyle = ({ pressed }: { pressed: boolean }) => [
    styles.action,
    { borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.65 : 1 },
  ];

  return (
    <View
      accessibilityLabel={t("mobile.sessions.actions")}
      accessibilityRole="toolbar"
      style={styles.container}
    >
      {renaming ? (
        <View style={styles.renameRow}>
          <TextInput
            accessibilityLabel={t("mobile.sessions.renamePlaceholder")}
            editable={!disabled}
            maxLength={512}
            onChangeText={setTitle}
            placeholder={t("mobile.sessions.renamePlaceholder")}
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={title}
          />
          <Pressable
            accessibilityRole="button"
            disabled={disabled || title.trim().length === 0}
            onPress={() =>
              void safely(async () => {
                await onRename(title.trim());
                setRenaming(false);
              })
            }
            style={({ pressed }) => [
              styles.primaryAction,
              {
                backgroundColor: colors.accent,
                opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryText, { color: colors.accentText }]}>
              {t("mobile.sessions.saveName")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => setRenaming(true)}
            style={buttonStyle}
          >
            <Text style={[styles.actionText, { color: colors.foreground }]}>
              {t("mobile.sessions.rename")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void safely(() => onSetPinned(!session.pinned))}
            style={buttonStyle}
          >
            <Text style={[styles.actionText, { color: colors.foreground }]}>
              {t(session.pinned ? "mobile.sessions.unpin" : "mobile.sessions.pin")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void safely(onArchive)}
            style={buttonStyle}
          >
            <Text style={[styles.actionText, { color: colors.danger }]}>
              {t("mobile.sessions.archive")}
            </Text>
          </Pressable>
        </View>
      )}
      {error ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[styles.error, { color: colors.warningText }]}
        >
          {t(error === "conflict" ? "mobile.sessions.conflict" : "mobile.sessions.actionFailed")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  renameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  input: { borderRadius: 10, borderWidth: 1, flex: 1, fontSize: 16, minHeight: 44, padding: 10 },
  primaryAction: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  primaryText: { fontSize: 14, fontWeight: "700" },
  error: { fontSize: 13, lineHeight: 18 },
});
