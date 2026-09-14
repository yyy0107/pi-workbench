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
import { MobileSessionActions } from "../../../../components/session-actions.tsx";
import type { MobileSessionCatalogSnapshot } from "../../../../features/session-catalog.ts";
import { mobileTranslationBundle } from "../../../../i18n/index.ts";
import { useMobileApp } from "../../../../state/mobile-app.tsx";
import { useMobilePalette } from "../../../../ui/theme.ts";

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function SessionCatalogScreen() {
  const { date, relativeTime, t } = useI18n(mobileTranslationBundle);
  const app = useMobileApp();
  const router = useRouter();
  const parameters = useLocalSearchParams<{ machineId?: string | string[] }>();
  const machineId = firstParameter(parameters.machineId);
  const machine = app.machines.items.find((item) => item.machineId === machineId);
  const machineAvailable = Boolean(machine);
  const palette = useMobilePalette();
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<MobileSessionCatalogSnapshot>();
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [expandedSessionId, setExpandedSessionId] = useState<string>();

  const load = useCallback(async () => {
    if (!machineAvailable || !machineId) {
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
  }, [app.loadSessions, machineAvailable, machineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const items =
      catalog?.items.filter((session) => {
        if (!normalizedQuery) return true;
        return [session.title, session.workspace?.displayName]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      }) ?? [];
    return [
      {
        key: "pinned",
        title: t("mobile.sessions.pinnedGroup"),
        items: items.filter(({ pinned }) => pinned),
      },
      {
        key: "recent",
        title: t("mobile.sessions.recentGroup"),
        items: items.filter(({ pinned }) => !pinned),
      },
    ];
  }, [catalog?.items, query, t]);

  const projects = useMemo(() => {
    const workspaces = new Map<
      string,
      { readonly workspaceId: string; readonly displayName: string }
    >();
    for (const session of catalog?.items ?? []) {
      if (session.workspace) workspaces.set(session.workspace.workspaceId, session.workspace);
    }
    return [...workspaces.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  }, [catalog?.items]);

  const visibleSessionCount = groups.reduce((total, group) => total + group.items.length, 0);

  const sessionTitle = (session: NonNullable<typeof catalog>["items"][number]) =>
    session.title ?? t("mobile.sessions.untitled");

  const openSession = (session: NonNullable<typeof catalog>["items"][number]) =>
    router.push({
      pathname: "/machines/[machineId]/sessions/[sessionId]",
      params: {
        machineId,
        sessionId: session.sessionId,
        title: sessionTitle(session),
        runState: session.runState,
        workspaceName: session.workspace?.displayName ?? "",
      },
    });

  const createSession = async () => {
    if (!catalog?.canMutate || creating) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      const sessionId = await app.createSession({ machineId });
      await load();
      router.push({
        pathname: "/machines/[machineId]/sessions/[sessionId]",
        params: { machineId, sessionId, title: t("mobile.conversation.title") },
      });
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  };

  const runLabel = (runState: string) => {
    if (runState === "running" || runState === "queued" || runState === "stopping") {
      return t("mobile.sessions.running");
    }
    if (runState === "waiting-for-input") return t("mobile.sessions.waitingForInput");
    if (runState === "failed") return t("mobile.sessions.failed");
    if (runState === "completed" || runState === "stopped") {
      return t("mobile.sessions.completed");
    }
    return t("mobile.sessions.idle");
  };

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
          <Text
            accessibilityRole="header"
            style={[styles.headerTitle, { color: palette.foreground }]}
          >
            {t("mobile.sessions.remoteTitle")}
          </Text>
          <MobileIconButton
            accessibilityLabel={t("mobile.machines.connectionSettings")}
            color={palette.foreground}
            disabled={!machine}
            name="ellipsis-horizontal"
            onPress={() =>
              router.push({
                pathname: "/machines/[machineId]/settings",
                params: { machineId },
              })
            }
            surface={palette.surface}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.machineRail}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.machineRailScroller}
        >
          {app.machines.items.map((item) => {
            const selected = item.machineId === machineId;
            const online = item.presence === "online";
            return (
              <Pressable
                key={item.machineId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                hitSlop={4}
                onPress={() =>
                  router.replace({
                    pathname: "/machines/[machineId]/sessions",
                    params: { machineId: item.machineId },
                  })
                }
                style={({ pressed }) => [
                  styles.machinePill,
                  {
                    backgroundColor: selected ? palette.accent : palette.subtleSurface,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <View
                  accessibilityElementsHidden
                  style={[
                    styles.presenceDot,
                    { backgroundColor: online ? palette.success : palette.muted },
                  ]}
                />
                <MobileIcon
                  color={selected ? palette.accentText : palette.foreground}
                  name="desktop-outline"
                  size={16}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.machineName,
                    { color: selected ? palette.accentText : palette.foreground },
                  ]}
                >
                  {item.displayName}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.screenContent}
          keyboardShouldPersistTaps="handled"
          style={styles.scroller}
        >
          <View style={styles.listHeading}>
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: palette.foreground }]}
            >
              {t("mobile.sessions.title")}
            </Text>
            <Pressable
              accessibilityLabel={t("mobile.common.retry")}
              accessibilityRole="button"
              accessibilityState={{ busy: loading, disabled: loading || !machine }}
              disabled={loading || !machine}
              hitSlop={4}
              onPress={() => void load()}
              style={({ pressed }) => [styles.refreshButton, { opacity: pressed ? 0.58 : 1 }]}
            >
              <MobileIcon color={palette.muted} name="refresh" size={21} />
            </Pressable>
          </View>

          <View accessibilityRole="list" style={styles.projectList}>
            {projects.map((project) => (
              <Pressable
                key={project.workspaceId}
                accessibilityLabel={project.displayName}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/machines/[machineId]/projects/[workspaceId]",
                    params: {
                      machineId,
                      workspaceId: project.workspaceId,
                      projectName: project.displayName,
                    },
                  })
                }
                style={({ pressed }) => [
                  styles.projectRow,
                  { backgroundColor: pressed ? palette.subtleSurface : "transparent" },
                ]}
              >
                <MobileIcon color={palette.foreground} name="folder-outline" size={27} />
                <Text
                  numberOfLines={1}
                  style={[styles.projectLabel, { color: palette.foreground }]}
                >
                  {project.displayName}
                </Text>
              </Pressable>
            ))}
          </View>

          {catalog?.stale ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.staleBanner, { backgroundColor: palette.warningSurface }]}
            >
              <Text style={[styles.staleText, { color: palette.warningText }]}>
                {t("mobile.sessions.stale")}
              </Text>
              <Text style={[styles.staleText, { color: palette.warningText }]}>
                {t("mobile.sessions.mutationDisabled")}
              </Text>
            </View>
          ) : null}

          {loading ? (
            <View accessibilityRole="progressbar" style={styles.loadingRow}>
              <ActivityIndicator color={palette.accent} />
              <Text style={{ color: palette.muted }}>{t("mobile.common.loading")}</Text>
            </View>
          ) : !machine ? (
            <Text accessibilityLiveRegion="polite" style={[styles.empty, { color: palette.muted }]}>
              {t("mobile.sessions.loadError")}
            </Text>
          ) : !catalog || catalog.items.length === 0 ? (
            <Text style={[styles.empty, { color: palette.muted }]}>
              {t("mobile.sessions.empty")}
            </Text>
          ) : visibleSessionCount === 0 ? (
            <Text style={[styles.empty, { color: palette.muted }]}>
              {t("mobile.sessions.searchEmpty")}
            </Text>
          ) : (
            <View accessibilityRole="list" style={styles.list}>
              {groups.map((group) => {
                const pinnedGroup = group.key === "pinned";
                return (
                  <View key={group.key} style={styles.group}>
                    {pinnedGroup ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: pinnedExpanded }}
                        onPress={() => setPinnedExpanded((expanded) => !expanded)}
                        style={({ pressed }) => [
                          styles.groupHeading,
                          { opacity: pressed ? 0.58 : 1 },
                        ]}
                      >
                        <Text style={[styles.groupTitle, { color: palette.foreground }]}>
                          {group.title}
                        </Text>
                        <MobileIcon
                          color={palette.muted}
                          name={pinnedExpanded ? "chevron-down" : "chevron-forward"}
                          size={23}
                        />
                      </Pressable>
                    ) : (
                      <View style={styles.groupHeading}>
                        <Text style={[styles.groupTitle, { color: palette.foreground }]}>
                          {group.title}
                        </Text>
                      </View>
                    )}
                    {pinnedGroup && pinnedExpanded && group.items.length === 0 ? (
                      <Text style={[styles.pinnedEmpty, { color: palette.muted }]}>
                        {t("mobile.sessions.pinnedEmpty")}
                      </Text>
                    ) : null}
                    {(!pinnedGroup || pinnedExpanded) &&
                      group.items.map((session) => {
                        const actionsExpanded = expandedSessionId === session.sessionId;
                        return (
                          <View
                            key={session.sessionId}
                            style={[styles.sessionItem, { borderBottomColor: palette.border }]}
                          >
                            <View style={styles.sessionLine}>
                              <Pressable
                                accessibilityLabel={`${t("mobile.sessions.openLabel")}: ${sessionTitle(session)}`}
                                accessibilityRole="button"
                                onPress={() => openSession(session)}
                                style={({ pressed }) => [
                                  styles.sessionMain,
                                  { opacity: pressed ? 0.58 : 1 },
                                ]}
                              >
                                <View style={styles.sessionTitleRow}>
                                  <Text
                                    ellipsizeMode="tail"
                                    numberOfLines={1}
                                    style={[styles.sessionTitle, { color: palette.foreground }]}
                                  >
                                    {sessionTitle(session)}
                                  </Text>
                                  <Text style={[styles.updatedAt, { color: palette.muted }]}>
                                    {updatedLabel(session.updatedAt)}
                                  </Text>
                                </View>
                                <View style={styles.sessionMetaRow}>
                                  {session.workspace ? (
                                    <>
                                      <MobileIcon
                                        color={palette.muted}
                                        name="folder-outline"
                                        size={15}
                                      />
                                      <Text
                                        numberOfLines={1}
                                        style={[styles.workspace, { color: palette.muted }]}
                                      >
                                        {session.workspace.displayName}
                                      </Text>
                                    </>
                                  ) : null}
                                  <Text style={[styles.runState, { color: palette.muted }]}>
                                    {runLabel(session.runState)}
                                  </Text>
                                  {session.attention !== "none" ? (
                                    <View
                                      accessibilityLabel={t("mobile.sessions.unread")}
                                      style={[
                                        styles.attentionDot,
                                        {
                                          backgroundColor:
                                            session.attention === "failed"
                                              ? palette.danger
                                              : palette.success,
                                        },
                                      ]}
                                    />
                                  ) : null}
                                </View>
                              </Pressable>
                              <Pressable
                                accessibilityLabel={t("mobile.sessions.actions")}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: actionsExpanded }}
                                hitSlop={4}
                                onPress={() =>
                                  setExpandedSessionId((current) =>
                                    current === session.sessionId ? undefined : session.sessionId,
                                  )
                                }
                                style={({ pressed }) => [
                                  styles.sessionMore,
                                  { opacity: pressed ? 0.58 : 1 },
                                ]}
                              >
                                <MobileIcon
                                  color={palette.muted}
                                  name="ellipsis-horizontal"
                                  size={22}
                                />
                              </Pressable>
                            </View>
                            {actionsExpanded ? (
                              <View style={styles.actionTray}>
                                <MobileSessionActions
                                  canMutate={catalog.canMutate}
                                  colors={palette}
                                  onArchive={async () => {
                                    try {
                                      await app.archiveSession({
                                        machineId,
                                        sessionId: session.sessionId,
                                        expectedEntityRevision: session.entityRevision,
                                      });
                                    } finally {
                                      setExpandedSessionId(undefined);
                                      await load();
                                    }
                                  }}
                                  onRename={async (title) => {
                                    try {
                                      await app.renameSession({
                                        machineId,
                                        sessionId: session.sessionId,
                                        title,
                                        expectedEntityRevision: session.entityRevision,
                                      });
                                    } finally {
                                      await load();
                                    }
                                  }}
                                  onSetPinned={async (pinned) => {
                                    try {
                                      await app.setSessionPinned({
                                        machineId,
                                        sessionId: session.sessionId,
                                        pinned,
                                        expectedEntityRevision: session.entityRevision,
                                      });
                                    } finally {
                                      setExpandedSessionId(undefined);
                                      await load();
                                    }
                                  }}
                                  session={session}
                                />
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                  </View>
                );
              })}
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
              accessibilityLabel={t("mobile.sessions.searchPlaceholder")}
              onChangeText={setQuery}
              placeholder={t("mobile.sessions.searchPlaceholder")}
              placeholderTextColor={palette.muted}
              returnKeyType="search"
              style={[styles.searchInput, { color: palette.foreground }]}
              value={query}
            />
          </View>
          <Pressable
            accessibilityLabel={t("mobile.sessions.createLabel")}
            accessibilityRole="button"
            accessibilityState={{
              busy: creating,
              disabled: catalog?.canMutate !== true || creating,
            }}
            disabled={catalog?.canMutate !== true || creating}
            onPress={() => void createSession()}
            style={({ pressed }) => [
              styles.createButton,
              {
                backgroundColor: palette.accent,
                opacity: catalog?.canMutate !== true || creating ? 0.38 : pressed ? 0.68 : 1,
              },
            ]}
          >
            {creating ? (
              <ActivityIndicator color={palette.accentText} size="small" />
            ) : (
              <MobileIcon color={palette.accentText} name="create-outline" size={26} />
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
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
  },
  headerTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  machineRailScroller: { flexGrow: 0 },
  machineRail: { gap: 10, paddingBottom: 20, paddingTop: 8 },
  machinePill: {
    alignItems: "center",
    borderRadius: 20,
    flexDirection: "row",
    gap: 6,
    height: 40,
    maxWidth: 200,
    paddingHorizontal: 12,
  },
  presenceDot: { borderRadius: 3, height: 6, width: 6 },
  machineName: { flexShrink: 1, fontSize: 14, fontWeight: "700" },
  listHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
  },
  sectionTitle: { fontSize: 25, fontWeight: "700", letterSpacing: -0.35 },
  refreshButton: { alignItems: "center", height: 48, justifyContent: "center", width: 48 },
  scroller: { flex: 1 },
  screenContent: { paddingBottom: 24 },
  projectList: { gap: 2, marginBottom: 28 },
  projectRow: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 14,
    minHeight: 54,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  projectLabel: { flexShrink: 1, fontSize: 20, letterSpacing: -0.2 },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 88 },
  staleBanner: { borderRadius: 16, gap: 4, marginVertical: 8, padding: 14 },
  staleText: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 16, lineHeight: 24, paddingVertical: 32 },
  list: { gap: 28 },
  group: { gap: 2 },
  groupHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    marginTop: 10,
    minHeight: 36,
  },
  groupTitle: { fontSize: 20, fontWeight: "700" },
  pinnedEmpty: { fontSize: 14, lineHeight: 20, paddingBottom: 12, paddingHorizontal: 4 },
  sessionItem: { borderBottomWidth: StyleSheet.hairlineWidth },
  sessionLine: { alignItems: "stretch", flexDirection: "row", minHeight: 82 },
  sessionMain: { flex: 1, gap: 8, justifyContent: "center", paddingVertical: 12 },
  sessionTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  sessionTitle: { flex: 1, fontSize: 17, fontWeight: "500", lineHeight: 23 },
  updatedAt: { flexShrink: 0, fontSize: 14, lineHeight: 22 },
  sessionMetaRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  workspace: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  runState: { fontSize: 13, lineHeight: 18, marginLeft: "auto" },
  attentionDot: { borderRadius: 4, height: 8, width: 8 },
  sessionMore: { alignItems: "center", justifyContent: "center", minHeight: 48, width: 48 },
  actionTray: { paddingBottom: 14 },
  error: { fontSize: 13, lineHeight: 18, paddingBottom: 4 },
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
    height: 56,
    justifyContent: "center",
    width: 56,
  },
});
