import { useI18n } from "@workbench/i18n";
import type { RemoteRunStateV1 } from "@workbench/remote-control-contracts/protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MobileActivitySummary } from "../../../../components/activity-summary.tsx";
import { MobileIcon, MobileIconButton } from "../../../../components/mobile-icon.tsx";
import { MobileOrdinaryQuestion } from "../../../../components/ordinary-question.tsx";
import { MobileRunControls } from "../../../../components/run-controls.tsx";
import { MobileTextComposer } from "../../../../components/text-composer.tsx";
import {
  MobileToolCallTranscript,
  MobileToolResultTranscript,
} from "../../../../components/tool-transcript.tsx";
import { mobileConversationConnectionStatus } from "../../../../features/conversation.ts";
import { mobileTranslationBundle } from "../../../../i18n/index.ts";
import { useMobileApp } from "../../../../state/mobile-app.tsx";
import type { MobileRemoteSessionSnapshot } from "../../../../state/remote-session.ts";
import { useMobilePalette } from "../../../../ui/theme.ts";

const RUN_STATES: ReadonlySet<string> = new Set([
  "idle",
  "queued",
  "running",
  "waiting-for-input",
  "stopping",
  "completed",
  "stopped",
  "failed",
]);

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function ConversationScreen() {
  const { t } = useI18n(mobileTranslationBundle);
  const app = useMobileApp();
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    machineId?: string | string[];
    sessionId?: string | string[];
    title?: string | string[];
    runState?: string | string[];
    workspaceName?: string | string[];
  }>();
  const machineId = parameter(parameters.machineId);
  const sessionId = parameter(parameters.sessionId);
  const title = parameter(parameters.title) || t("mobile.conversation.title");
  const workspaceName = parameter(parameters.workspaceName);
  const rawRunState = parameter(parameters.runState);
  const runState = (RUN_STATES.has(rawRunState) ? rawRunState : "idle") as RemoteRunStateV1;
  const palette = useMobilePalette();
  const machine = app.machines.items.find((item) => item.machineId === machineId);
  const [controller, setController] =
    useState<ReturnType<typeof app.openConversation>["session"]>();
  const [snapshot, setSnapshot] = useState<MobileRemoteSessionSnapshot>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!machineId || !sessionId) {
      setLoading(false);
      return;
    }
    let active = true;
    const opened = app.openConversation({ machineId, sessionId, runState });
    setController(opened.session);
    setSnapshot(opened.session.snapshot());
    const unsubscribe = opened.session.subscribe(() => {
      if (active) setSnapshot(opened.session.snapshot());
    });
    void opened
      .initialize()
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
      opened.session.dispose();
    };
  }, [app.openConversation, machineId, runState, sessionId]);

  const outcomeUnknown = snapshot?.operations.find(
    (operation) => operation.status === "outcome-unknown",
  );
  const connectionStatus = mobileConversationConnectionStatus(snapshot);
  const connectionLabel = {
    offline: t("mobile.connection.offline"),
    reconnecting: t("mobile.connection.reconnecting"),
    resyncing: t("mobile.connection.resyncing"),
    ready: t("mobile.connection.ready"),
    incompatible: t("mobile.connection.incompatible"),
    stale: t("mobile.connection.stale"),
    "outcome-checking": t("mobile.connection.outcomechecking"),
  }[connectionStatus];
  const safely = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      // The controller exposes a localized, bounded state instead of raw transport errors.
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <MobileIconButton
              accessibilityLabel={t("mobile.common.back")}
              color={palette.foreground}
              name="arrow-back"
              onPress={() => router.back()}
              surface={palette.surface}
            />
            <View
              style={[
                styles.titlePill,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.title, { color: palette.foreground }]}
              >
                {title}
              </Text>
              <View style={styles.contextRow}>
                {workspaceName ? (
                  <>
                    <MobileIcon color={palette.muted} name="folder-outline" size={14} />
                    <Text numberOfLines={1} style={[styles.contextText, { color: palette.muted }]}>
                      {workspaceName}
                    </Text>
                  </>
                ) : null}
                <View
                  accessibilityLabel={connectionLabel}
                  accessibilityRole="text"
                  style={[
                    styles.connectionDot,
                    {
                      backgroundColor:
                        connectionStatus === "ready" ? palette.success : palette.warningText,
                    },
                  ]}
                />
                <MobileIcon color={palette.muted} name="desktop-outline" size={14} />
                <Text numberOfLines={1} style={[styles.contextText, { color: palette.muted }]}>
                  {machine?.displayName ?? machineId}
                </Text>
              </View>
            </View>
            <MobileIconButton
              accessibilityLabel={t("mobile.machines.connectionSettings")}
              color={palette.foreground}
              name="ellipsis-vertical"
              onPress={() =>
                router.push({
                  pathname: "/machines/[machineId]/settings",
                  params: { machineId },
                })
              }
              surface={palette.surface}
            />
          </View>

          {snapshot ? (
            <View style={[styles.runBar, { borderBottomColor: palette.border }]}>
              <MobileRunControls
                colors={palette}
                onStop={() => safely(() => controller!.stop())}
                ready={snapshot.ready}
                runState={snapshot.runState}
              />
            </View>
          ) : null}

          {snapshot?.stale ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.staleBanner, { backgroundColor: palette.warningSurface }]}
            >
              <Text style={[styles.staleText, { color: palette.warningText }]}>
                {t("mobile.conversation.stale")}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            style={styles.scroller}
          >
            {loading ? (
              <View accessibilityRole="progressbar" style={styles.loadingRow}>
                <ActivityIndicator color={palette.accent} />
                <Text style={{ color: palette.muted }}>{t("mobile.common.loading")}</Text>
              </View>
            ) : !snapshot ? (
              <Text style={[styles.empty, { color: palette.muted }]}>
                {t("mobile.conversation.loadError")}
              </Text>
            ) : (
              <>
                {snapshot.nextHistoryCursor ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!snapshot.ready}
                    onPress={() => void safely(() => controller!.loadMore())}
                    style={({ pressed }) => [styles.loadMore, { opacity: pressed ? 0.62 : 1 }]}
                  >
                    <Text style={[styles.loadMoreText, { color: palette.muted }]}>
                      {t("mobile.conversation.loadOlder")}
                    </Text>
                    <MobileIcon color={palette.muted} name="chevron-up" size={17} />
                  </Pressable>
                ) : null}
                {snapshot.items.length === 0 ? (
                  <Text style={[styles.empty, { color: palette.muted }]}>
                    {t("mobile.conversation.empty")}
                  </Text>
                ) : null}
                {snapshot.items.map((item) => {
                  if (item.type === "ordinary-question") {
                    return (
                      <MobileOrdinaryQuestion
                        key={item.interactionId}
                        colors={palette}
                        interaction={item}
                        onAnswer={(answers) =>
                          safely(() => controller!.answerQuestion(item, answers))
                        }
                        ready={snapshot.ready}
                      />
                    );
                  }
                  if (item.type === "activity-summary") {
                    return <MobileActivitySummary key={item.itemId} colors={palette} item={item} />;
                  }
                  if (item.type === "tool-result") {
                    return (
                      <MobileToolResultTranscript key={item.itemId} item={item} palette={palette} />
                    );
                  }
                  if (item.type === "system-status") {
                    if (item.status === "content-available-on-desktop") return null;
                    return (
                      <Text key={item.itemId} style={[styles.system, { color: palette.muted }]}>
                        {item.status === "stopped"
                          ? t("mobile.conversation.stopped")
                          : t("mobile.conversation.failed")}
                      </Text>
                    );
                  }
                  if (item.type === "user-message") {
                    return (
                      <View
                        key={item.itemId}
                        style={[styles.userMessage, { backgroundColor: palette.userSurface }]}
                      >
                        <Text selectable style={[styles.body, { color: palette.foreground }]}>
                          {item.text}
                        </Text>
                        {item.textTruncated ? (
                          <Text style={[styles.truncated, { color: palette.warningText }]}>
                            {t("mobile.conversation.messageTruncated")}
                          </Text>
                        ) : null}
                      </View>
                    );
                  }
                  return (
                    <View key={item.itemId} style={styles.assistantMessage}>
                      {item.text ? (
                        <Text selectable style={[styles.body, { color: palette.foreground }]}>
                          {item.text}
                        </Text>
                      ) : null}
                      {item.textTruncated ? (
                        <Text style={[styles.truncated, { color: palette.warningText }]}>
                          {t("mobile.conversation.messageTruncated")}
                        </Text>
                      ) : null}
                      {item.toolCalls?.map((call) => (
                        <MobileToolCallTranscript
                          key={call.toolCallId}
                          call={call}
                          palette={palette}
                        />
                      ))}
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>

          {snapshot && controller ? (
            <MobileTextComposer
              colors={palette}
              onChange={(value) => controller.setDraft(value)}
              onRetry={(operationId) => safely(() => controller.retry(operationId))}
              onSend={() => safely(() => controller.sendText())}
              outcomeUnknownOperationId={outcomeUnknown?.operationId}
              ready={snapshot.ready}
              value={snapshot.draft}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboardView: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 16 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 76,
  },
  titlePill: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 2,
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2, lineHeight: 21 },
  contextRow: { alignItems: "center", flexDirection: "row", gap: 4, maxWidth: "100%" },
  contextText: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
  connectionDot: { borderRadius: 4, height: 7, marginLeft: 3, width: 7 },
  runBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    paddingTop: 2,
  },
  staleBanner: { borderRadius: 14, marginTop: 8, padding: 11 },
  staleText: { fontSize: 13, lineHeight: 18 },
  scroller: { flex: 1 },
  messages: { flexGrow: 1, gap: 20, paddingBottom: 24, paddingTop: 20 },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 80 },
  loadMore: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 48,
  },
  loadMoreText: { fontSize: 14, fontWeight: "600" },
  empty: { fontSize: 15, lineHeight: 22, paddingVertical: 24 },
  userMessage: {
    alignSelf: "flex-end",
    borderRadius: 22,
    maxWidth: "86%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  assistantMessage: { alignSelf: "stretch", gap: 12 },
  body: { fontSize: 17, lineHeight: 27 },
  truncated: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  system: { alignSelf: "center", fontSize: 13, lineHeight: 18, paddingVertical: 4 },
});
