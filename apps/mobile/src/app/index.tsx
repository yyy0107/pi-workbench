import { useI18n } from "@workbench/i18n";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MobileConnectionStatus } from "../components/connection-status.tsx";
import { mobileMachineConnectionStatus } from "../features/machines.ts";
import { mobileTranslationBundle } from "../i18n/index.ts";
import { useMobileApp } from "../state/mobile-app.tsx";
import { useMobilePalette } from "../ui/theme.ts";

export default function LandingScreen() {
  const { date, t } = useI18n(mobileTranslationBundle);
  const app = useMobileApp();
  const router = useRouter();
  const palette = useMobilePalette();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
            {t("mobile.home.title")}
          </Text>
          <Text style={[styles.description, { color: palette.muted }]}>
            {t("mobile.home.description")}
          </Text>
          <View
            accessibilityRole="summary"
            style={[
              styles.securityNote,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.securityTitle, { color: palette.foreground }]}>
              {t("mobile.home.privateTitle")}
            </Text>
            <Text style={[styles.securityCopy, { color: palette.muted }]}>
              {t("mobile.home.privateDescription")}
            </Text>
          </View>
        </View>

        {app.status === "booting" ? (
          <View accessibilityRole="progressbar" style={styles.progressRow}>
            <ActivityIndicator color={palette.accent} />
            <Text style={{ color: palette.muted }}>{t("mobile.common.loading")}</Text>
          </View>
        ) : app.status === "error" ? (
          <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>
            {t("mobile.common.configurationError")}
          </Text>
        ) : (
          <View style={styles.content}>
            <View style={styles.machineHeader}>
              <Text
                accessibilityRole="header"
                style={[styles.sectionTitle, { color: palette.foreground }]}
              >
                {t("mobile.machines.title")}
              </Text>
              <Pressable
                accessibilityLabel={t("mobile.machines.refreshLabel")}
                accessibilityRole="button"
                disabled={app.machines.loading}
                onPress={() => void app.refreshMachines()}
                style={({ pressed }) => [
                  styles.compactButton,
                  { opacity: app.machines.loading ? 0.4 : pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.compactButtonText, { color: palette.foreground }]}>
                  {t("mobile.common.retry")}
                </Text>
              </Pressable>
            </View>

            {app.machines.stale && app.machines.items.length > 0 ? (
              <Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>
                {t("mobile.machines.stale")}
              </Text>
            ) : null}

            {app.machines.items.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>
                  {t("mobile.machines.empty")}
                </Text>
                <Text style={[styles.securityCopy, { color: palette.muted }]}>
                  {t("mobile.machines.emptyDescription")}
                </Text>
              </View>
            ) : (
              app.machines.items.map((machine) => {
                const presence =
                  machine.presence === "online"
                    ? t("mobile.machines.online")
                    : machine.presence === "offline"
                      ? t("mobile.machines.offline")
                      : machine.presence === "reconnecting"
                        ? t("mobile.machines.reconnecting")
                        : t("mobile.machines.incompatible");
                return (
                  <View
                    key={machine.machineId}
                    style={[
                      styles.machineCard,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <Pressable
                      accessibilityLabel={`${t("mobile.machines.openSessionsLabel")}: ${machine.displayName}`}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: "/machines/[machineId]/sessions",
                          params: { machineId: machine.machineId },
                        })
                      }
                      style={({ pressed }) => [styles.machineMain, { opacity: pressed ? 0.72 : 1 }]}
                    >
                      <View style={styles.machineCopy}>
                        <Text style={[styles.machineName, { color: palette.foreground }]}>
                          {machine.displayName}
                        </Text>
                        <Text style={[styles.machineMeta, { color: palette.muted }]}>
                          {presence} · {t("mobile.machines.lastSeen")}{" "}
                          {date(new Date(machine.lastSeenAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </Text>
                        <MobileConnectionStatus
                          colors={palette}
                          compact
                          status={mobileMachineConnectionStatus(machine, app.machines.stale)}
                        />
                      </View>
                      <Text accessibilityElementsHidden style={{ color: palette.muted }}>
                        ›
                      </Text>
                    </Pressable>
                    <View style={[styles.machineFooter, { borderTopColor: palette.border }]}>
                      <Pressable
                        accessibilityLabel={`${t("mobile.machines.connectionSettings")}: ${machine.displayName}`}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: "/machines/[machineId]/settings",
                            params: { machineId: machine.machineId },
                          })
                        }
                        style={({ pressed }) => [
                          styles.settingsButton,
                          { opacity: pressed ? 0.65 : 1 },
                        ]}
                      >
                        <Text style={[styles.settingsText, { color: palette.foreground }]}>
                          {t("mobile.machines.connectionSettings")}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/pair")}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: palette.accent, opacity: pressed ? 0.78 : 1 },
              ]}
            >
              <Text style={[styles.primaryButtonText, { color: palette.accentText }]}>
                {t("mobile.machines.pair")}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flexGrow: 1, gap: 26, paddingHorizontal: 20, paddingVertical: 24 },
  hero: { gap: 12 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  description: { fontSize: 17, lineHeight: 25 },
  securityNote: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6, padding: 16 },
  securityTitle: { fontSize: 16, fontWeight: "600" },
  securityCopy: { fontSize: 14, lineHeight: 20 },
  progressRow: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 48 },
  content: { gap: 12 },
  machineHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { fontSize: 22, fontWeight: "700" },
  compactButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  compactButtonText: { fontSize: 15, fontWeight: "600" },
  emptyCard: { borderRadius: 16, borderWidth: 1, gap: 6, padding: 18 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  machineCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  machineMain: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 72,
    padding: 14,
  },
  machineCopy: { flex: 1, gap: 4 },
  machineName: { fontSize: 17, fontWeight: "600" },
  machineMeta: { fontSize: 13, lineHeight: 18 },
  machineFooter: { borderTopWidth: StyleSheet.hairlineWidth },
  settingsButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  settingsText: { fontSize: 15, fontWeight: "600" },
  primaryButton: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  primaryButtonText: { fontSize: 17, fontWeight: "600" },
});
