import { useI18n } from "@workbench/i18n";
import type {
  RemoteConversationItemV1,
  RemoteRunStateV1,
} from "@workbench/remote-control-contracts/protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MobileIcon, MobileIconButton } from "../../../../components/mobile-icon.tsx";
import { MobileOrdinaryQuestion } from "../../../../components/ordinary-question.tsx";
import RemoteConversationDom from "../../../../components/remote-conversation.dom.tsx";
import { MobileRunControls } from "../../../../components/run-controls.tsx";
import { MobileTextComposer } from "../../../../components/text-composer.tsx";
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
const EMPTY_CONVERSATION_ITEMS: readonly RemoteConversationItemV1[] = Object.freeze([]);
const StableRemoteConversationDom = memo(RemoteConversationDom);

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function ConversationScreen() {
  const { locale, t } = useI18n(mobileTranslationBundle);
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
  const dark = useColorScheme() === "dark";
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
  const pendingQuestion = snapshot?.items.findLast(
    (item): item is Extract<RemoteConversationItemV1, { type: "ordinary-question" }> =>
      item.type === "ordinary-question",
  );
  const safely = useCallback(async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      // The controller exposes a localized, bounded state instead of raw transport errors.
    }
  }, []);
  const loadMore = useCallback(async () => {
    if (controller) await safely(() => controller.loadMore());
  }, [controller, safely]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
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

          <StableRemoteConversationDom
            dark={dark}
            dom={remoteConversationDomProps}
            hasMore={Boolean(snapshot?.nextHistoryCursor)}
            items={snapshot?.items ?? EMPTY_CONVERSATION_ITEMS}
            loadFailed={!loading && !snapshot}
            loading={loading}
            locale={locale}
            onLoadMore={loadMore}
            palette={palette}
            ready={snapshot?.ready ?? false}
            sessionId={sessionId}
          />

          {pendingQuestion?.type === "ordinary-question" && snapshot && controller ? (
            <MobileOrdinaryQuestion
              colors={palette}
              interaction={pendingQuestion}
              onAnswer={(answers) =>
                safely(() => controller.answerQuestion(pendingQuestion, answers))
              }
              ready={snapshot.ready}
            />
          ) : null}

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
});

const remoteConversationDomProps = Object.freeze({
  style: styles.scroller,
}) satisfies import("expo/dom").DOMProps;
