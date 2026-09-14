import { useI18n } from "@workbench/i18n";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MobileIcon, MobileIconButton } from "../../../../components/mobile-icon.tsx";
import type { MobileSessionCatalogSnapshot } from "../../../../features/session-catalog.ts";
import { mobileTranslationBundle } from "../../../../i18n/index.ts";
import { useMobileApp } from "../../../../state/mobile-app.tsx";
import { useMobilePalette } from "../../../../ui/theme.ts";

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function isRunning(runState: string): boolean {
  return runState === "queued" || runState === "running" || runState === "stopping";
}

export default function ProjectSessionsScreen() {
  const { date, relativeTime, t } = useI18n(mobileTranslationBundle);
  const app = useMobileApp();
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    machineId?: string | string[];
    workspaceId?: string | string[];
    projectName?: string | string[];
  }>();
  const machineId = parameter(parameters.machineId);
  const workspaceId = parameter(parameters.workspaceId);
  const routeProjectName = parameter(parameters.projectName);
  const machine = app.machines.items.find((item) => item.machineId === machineId);
  const palette = useMobilePalette();
  const [catalog, setCatalog] = useState<MobileSessionCatalogSnapshot>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);

  const load = useCallback(async () => {
    if (!machineId || !workspaceId) {
      setLoading(false);
      setCatalog(undefined);
      return;
    }
    setLoading(true);
    try {
      setCatalog(await app.loadSessions(machineId));
    } finally {
      setLoading(false);
    }
  }, [app.loadSessions, machineId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (
      catalog?.items.filter(
        (session) =>
          session.workspace?.workspaceId === workspaceId &&
          (!normalizedQuery ||
            (session.title ?? t("mobile.sessions.untitled"))
              .toLocaleLowerCase()
              .includes(normalizedQuery)),
      ) ?? []
    );
  }, [catalog?.items, query, t, workspaceId]);

  const projectName =
    routeProjectName ||
    catalog?.items.find((session) => session.workspace?.workspaceId === workspaceId)?.workspace
      ?.displayName ||
    t("mobile.projectSessions.fallbackTitle");

  const connectionLabel =
    !machine || machine.presence === "offline"
      ? t("mobile.connection.offline")
      : machine.presence === "reconnecting"
        ? t("mobile.connection.reconnecting")
        : machine.presence === "incompatible"
          ? t("mobile.connection.incompatible")
          : catalog?.stale
            ? t("mobile.connection.stale")
            : t("mobile.connection.ready");

  const updatedLabel = (updatedAt: string) => {
    const value = new Date(updatedAt);
    const delta = value.getTime() - Date.now();
    if (!Number.isFinite(delta)) return updatedAt;
    const magnitude = Math.abs(delta);
    if (magnitude < 60_000) return relativeTime(0, "second");
    if (magnitude < 3_600_000) return relativeTime(Math.round(delta / 60_000), "minute");
    if (magnitude < 86_400_000) return relativeTime(Math.round(delta / 3_600_000), "hour");
    if (magnitude < 604_800_000) return relativeTime(Math.round(delta / 86_400_000), "day");
    return date(value, { month: "short", day: "numeric" });
  };

  const openSession = (session: (typeof projectSessions)[number]) =>
    router.push({
      pathname: "/machines/[machineId]/sessions/[sessionId]",
      params: {
        machineId,
        sessionId: session.sessionId,
        title: session.title ?? t("mobile.sessions.untitled"),
        runState: session.runState,
        workspaceName: projectName,
      },
    });

  const createChat = async () => {
    if (!catalog?.canMutate || creating) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      const sessionId = await app.createSession({ machineId, workspaceId });
      await load();
      router.push({
        pathname: "/machines/[machineId]/sessions/[sessionId]",
        params: {
          machineId,
          sessionId,
          title: t("mobile.conversation.title"),
          workspaceName: projectName,
        },
      });
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.page}>
        <View style={styles.header}>
          <MobileIconButton
            accessibilityLabel={t("mobile.common.back")}
            color={palette.foreground}
            name="arrow-back"
            onPress={() => router.back()}
            surface={palette.surface}
          />
          <View style={styles.headerMeta}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.title, { color: palette.foreground }]}
            >
              {projectName}
            </Text>
            <View style={styles.contextRow}>
              <MobileIcon color={palette.muted} name="desktop-outline" size={15} />
              <Text numberOfLines={1} style={[styles.contextText, { color: palette.muted }]}>
                {machine?.displayName ?? machineId}
              </Text>
              <View style={[styles.separatorDot, { backgroundColor: palette.muted }]} />
              <Text numberOfLines={1} style={[styles.connectionText, { color: palette.muted }]}>
                {connectionLabel}
              </Text>
            </View>
          </View>
        </View>

        {catalog?.stale ? (
          <View style={[styles.staleBanner, { backgroundColor: palette.warningSurface }]}>
            <Text style={[styles.staleText, { color: palette.warningText }]}>
              {t("mobile.sessions.stale")}
            </Text>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          style={styles.scroller}
        >
          {loading ? (
            <View accessibilityRole="progressbar" style={styles.loadingRow}>
              <ActivityIndicator color={palette.accent} />
              <Text style={{ color: palette.muted }}>{t("mobile.common.loading")}</Text>
            </View>
          ) : !catalog ? (
            <Text style={[styles.empty, { color: palette.muted }]}>
              {t("mobile.projectSessions.loadError")}
            </Text>
          ) : projectSessions.length === 0 ? (
            <Text style={[styles.empty, { color: palette.muted }]}>
              {t(query ? "mobile.sessions.searchEmpty" : "mobile.projectSessions.empty")}
            </Text>
          ) : (
            <View accessibilityRole="list" style={styles.list}>
              {projectSessions.map((session) => (
                <Pressable
                  key={session.sessionId}
                  accessibilityLabel={`${t("mobile.sessions.openLabel")}: ${session.title ?? t("mobile.sessions.untitled")}`}
                  accessibilityRole="button"
                  onPress={() => openSession(session)}
                  style={({ pressed }) => [styles.item, { opacity: pressed ? 0.58 : 1 }]}
                >
                  <Text
                    ellipsizeMode="tail"
                    numberOfLines={1}
                    style={[styles.sessionTitle, { color: palette.foreground }]}
                  >
                    {session.title ?? t("mobile.sessions.untitled")}
                  </Text>
                  {isRunning(session.runState) ? (
                    <View accessibilityLabel={t("mobile.sessions.running")} style={styles.running}>
                      <ActivityIndicator color={palette.accent} size="small" />
                    </View>
                  ) : (
                    <Text style={[styles.updatedAt, { color: palette.muted }]}>
                      {updatedLabel(session.updatedAt)}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        {createFailed ? (
          <Text
            accessibilityLiveRegion="assertive"
            style={[styles.error, { color: palette.warningText }]}
          >
            {t("mobile.sessions.actionFailed")}
          </Text>
        ) : null}

        <View style={styles.bottomDock}>
          <View
            style={[
              styles.searchField,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <MobileIcon color={palette.muted} name="search" size={24} />
            <TextInput
              accessibilityLabel={t("mobile.projectSessions.searchPlaceholder")}
              onChangeText={setQuery}
              placeholder={t("mobile.projectSessions.searchPlaceholder")}
              placeholderTextColor={palette.muted}
              returnKeyType="search"
              style={[styles.searchInput, { color: palette.foreground }]}
              value={query}
            />
          </View>
          <Pressable
            accessibilityLabel={t("mobile.projectSessions.createLabel")}
            accessibilityRole="button"
            accessibilityState={{
              busy: creating,
              disabled: catalog?.canMutate !== true || creating,
            }}
            disabled={catalog?.canMutate !== true || creating}
            onPress={() => void createChat()}
            style={({ pressed }) => [
              styles.createButton,
              {
                backgroundColor: palette.userSurface,
                opacity: catalog?.canMutate !== true || creating ? 0.38 : pressed ? 0.68 : 1,
              },
            ]}
          >
            {creating ? (
              <ActivityIndicator color={palette.foreground} size="small" />
            ) : (
              <>
                <MobileIcon color={palette.foreground} name="create-outline" size={23} />
                <Text style={[styles.createText, { color: palette.foreground }]}>
                  {t("mobile.projectSessions.create")}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 20 },
  header: { alignItems: "center", flexDirection: "row", gap: 14, minHeight: 84 },
  headerMeta: { flex: 1, minWidth: 0 },
  title: { fontSize: 25, fontWeight: "700", letterSpacing: -0.5, lineHeight: 29 },
  contextRow: { alignItems: "center", flexDirection: "row", gap: 7, marginTop: 5 },
  contextText: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  connectionText: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  separatorDot: { borderRadius: 2, height: 4, width: 4 },
  staleBanner: { borderRadius: 14, marginBottom: 4, padding: 11 },
  staleText: { fontSize: 13, lineHeight: 18 },
  scroller: { flex: 1 },
  listContent: { flexGrow: 1, paddingBottom: 24, paddingTop: 10 },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 80 },
  empty: { fontSize: 15, lineHeight: 22, paddingVertical: 24 },
  list: { gap: 4 },
  item: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    minHeight: 62,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  sessionTitle: { flex: 1, fontSize: 20, letterSpacing: -0.3, lineHeight: 27 },
  updatedAt: { flexShrink: 0, fontSize: 15, lineHeight: 22 },
  running: { alignItems: "center", height: 34, justifyContent: "center", width: 34 },
  error: { fontSize: 13, lineHeight: 18, paddingBottom: 2 },
  bottomDock: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 8,
    paddingTop: 10,
  },
  searchField: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    height: 56,
    paddingHorizontal: 16,
  },
  searchInput: { flex: 1, fontSize: 16, height: 52, paddingVertical: 0 },
  createButton: {
    alignItems: "center",
    borderRadius: 28,
    flexDirection: "row",
    gap: 8,
    height: 56,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  createText: { fontSize: 16, fontWeight: "700" },
});
