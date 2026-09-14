import { useI18n } from "@workbench/i18n";
import { classifyDirectClientHost } from "@workbench/remote-control-client/endpoint-policy";
import type { DirectConnectionProfile } from "@workbench/remote-control-client/profiles";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mobileTranslationBundle } from "../../../i18n/index.ts";
import { useMobileApp } from "../../../state/mobile-app.tsx";
import { useMobilePalette } from "../../../ui/theme.ts";

export default function MachineConnectionSettingsScreen() {
  const { machineId } = useLocalSearchParams<{ readonly machineId: string }>();
  const { t } = useI18n(mobileTranslationBundle);
  const app = useMobileApp();
  const router = useRouter();
  const palette = useMobilePalette();
  const [profile, setProfile] = useState<DirectConnectionProfile>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEndpointId, setEditingEndpointId] = useState<string>();
  const [endpointHost, setEndpointHost] = useState("");
  const [endpointPort, setEndpointPort] = useState("8787");
  const [endpointTestState, setEndpointTestState] = useState<
    "idle" | "testing" | "verified" | "error"
  >("idle");
  const [confirmEndpointRemovalId, setConfirmEndpointRemovalId] = useState<string>();
  const [error, setError] = useState(false);

  const refreshProfile = async () => {
    setProfile(await app.getConnectionProfile(machineId));
  };

  const draftEndpoint = () => {
    const host = endpointHost.trim().toLowerCase();
    const port = Number(endpointPort);
    const kind = classifyDirectClientHost(host);
    if (!kind || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error("endpoint_not_allowed");
    }
    return { kind, host, port } as const;
  };

  const openEndpointEditor = (endpointId?: string) => {
    const endpoint = profile?.endpoints.find((value) => value.endpointId === endpointId);
    setEditingEndpointId(endpoint?.endpointId);
    setEndpointHost(endpoint?.host ?? "");
    setEndpointPort(String(endpoint?.port ?? 8787));
    setEndpointTestState("idle");
    setConfirmEndpointRemovalId(undefined);
    setEditorOpen(true);
  };

  const testEndpoint = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    setEndpointTestState("testing");
    try {
      await app.testConnectionEndpoint(machineId, draftEndpoint());
      setEndpointTestState("verified");
    } catch {
      setEndpointTestState("error");
    } finally {
      setBusy(false);
    }
  };

  const saveEndpoint = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    setEndpointTestState("testing");
    try {
      await app.saveConnectionEndpoint({
        machineId,
        ...(editingEndpointId ? { endpointId: editingEndpointId } : {}),
        endpoint: draftEndpoint(),
      });
      await refreshProfile();
      setEndpointTestState("verified");
      setEditorOpen(false);
      setEditingEndpointId(undefined);
    } catch {
      setEndpointTestState("error");
    } finally {
      setBusy(false);
    }
  };

  const removeEndpoint = async (endpointId: string) => {
    if (busy) return;
    if (confirmEndpointRemovalId !== endpointId) {
      setConfirmEndpointRemovalId(endpointId);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      await app.removeConnectionEndpoint(machineId, endpointId);
      await refreshProfile();
      setConfirmEndpointRemovalId(undefined);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    void app.getConnectionProfile(machineId).then((value) => {
      if (!active) return;
      setProfile(value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [app.getConnectionProfile, machineId]);

  const prefer = async (endpointId: string) => {
    if (!profile || profile.preferredEndpointId === endpointId || busy) return;
    setBusy(true);
    setError(false);
    try {
      const endpointIds = [
        endpointId,
        ...profile.endpoints
          .map((endpoint) => endpoint.endpointId)
          .filter((value) => value !== endpointId),
      ];
      await app.reorderConnectionEndpoints(machineId, endpointIds);
      await refreshProfile();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      await app.removeMachine(machineId);
      router.replace("/");
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Text style={[styles.backText, { color: palette.foreground }]}>
            {t("mobile.common.back")}
          </Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
          {t("mobile.connectionSettings.title")}
        </Text>

        {loading ? (
          <ActivityIndicator accessibilityRole="progressbar" color={palette.accent} />
        ) : !profile ? (
          <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>
            {t("mobile.connectionSettings.notFound")}
          </Text>
        ) : (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: palette.foreground }]}>
                {profile.displayName}
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                {t("mobile.connectionSettings.identityDescription")}
              </Text>
              <Text selectable style={[styles.fingerprint, { color: palette.foreground }]}>
                {profile.desktopFingerprint}
              </Text>
            </View>

            <View style={styles.section}>
              <Text
                accessibilityRole="header"
                style={[styles.sectionTitle, { color: palette.foreground }]}
              >
                {t("mobile.connectionSettings.endpoints")}
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                {t("mobile.connectionSettings.endpointsDescription")}
              </Text>
              {profile.endpoints.map((endpoint) => {
                const preferred = endpoint.endpointId === profile.preferredEndpointId;
                return (
                  <View
                    key={endpoint.endpointId}
                    style={[
                      styles.endpoint,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.endpointCopy}>
                      <Text style={[styles.endpointAddress, { color: palette.foreground }]}>
                        {endpoint.host}:{endpoint.port}
                      </Text>
                      <Text style={[styles.endpointMeta, { color: palette.muted }]}>
                        {endpoint.kind === "tailscale"
                          ? t("mobile.connectionSettings.tailscale")
                          : t("mobile.connectionSettings.localNetwork")}
                        {preferred ? ` · ${t("mobile.connectionSettings.preferred")}` : ""}
                      </Text>
                    </View>
                    <View style={styles.endpointActions}>
                      {!preferred ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() => void prefer(endpoint.endpointId)}
                          style={({ pressed }) => [
                            styles.endpointButton,
                            {
                              borderColor: palette.border,
                              opacity: busy ? 0.4 : pressed ? 0.65 : 1,
                            },
                          ]}
                        >
                          <Text style={[styles.endpointButtonText, { color: palette.foreground }]}>
                            {t("mobile.connectionSettings.makePreferred")}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityLabel={`${t("mobile.connectionSettings.editEndpoint")}: ${endpoint.host}`}
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => openEndpointEditor(endpoint.endpointId)}
                        style={({ pressed }) => [
                          styles.endpointButton,
                          { borderColor: palette.border, opacity: busy ? 0.4 : pressed ? 0.65 : 1 },
                        ]}
                      >
                        <Text style={[styles.endpointButtonText, { color: palette.foreground }]}>
                          {t("mobile.connectionSettings.editEndpoint")}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`${t("mobile.connectionSettings.removeEndpoint")}: ${endpoint.host}`}
                        accessibilityRole="button"
                        disabled={busy || profile.endpoints.length === 1}
                        onPress={() => void removeEndpoint(endpoint.endpointId)}
                        style={({ pressed }) => [
                          styles.endpointButton,
                          {
                            borderColor: palette.danger,
                            opacity:
                              busy || profile.endpoints.length === 1 ? 0.4 : pressed ? 0.65 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.endpointButtonText, { color: palette.danger }]}>
                          {confirmEndpointRemovalId === endpoint.endpointId
                            ? t("mobile.connectionSettings.confirmEndpointRemoval")
                            : t("mobile.connectionSettings.removeEndpoint")}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {profile.endpoints.length === 1 ? (
                <Text style={[styles.caption, { color: palette.muted }]}>
                  {t("mobile.connectionSettings.endpointRequired")}
                </Text>
              ) : null}
              {editorOpen ? (
                <View
                  style={[
                    styles.editorCard,
                    { backgroundColor: palette.surface, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.cardTitle, { color: palette.foreground }]}>
                    {editingEndpointId
                      ? t("mobile.connectionSettings.editEndpoint")
                      : t("mobile.connectionSettings.addEndpoint")}
                  </Text>
                  <Text style={[styles.body, { color: palette.muted }]}>
                    {t("mobile.connectionSettings.identityVerificationHint")}
                  </Text>
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>
                    {t("mobile.connectionSettings.host")}
                  </Text>
                  <TextInput
                    accessibilityLabel={t("mobile.connectionSettings.host")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    onChangeText={(value) => {
                      setEndpointHost(value);
                      setEndpointTestState("idle");
                    }}
                    placeholder={t("mobile.connectionSettings.hostPlaceholder")}
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                        color: palette.foreground,
                      },
                    ]}
                    value={endpointHost}
                  />
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>
                    {t("mobile.connectionSettings.port")}
                  </Text>
                  <TextInput
                    accessibilityLabel={t("mobile.connectionSettings.port")}
                    editable={!busy}
                    keyboardType="number-pad"
                    maxLength={5}
                    onChangeText={(value) => {
                      setEndpointPort(value);
                      setEndpointTestState("idle");
                    }}
                    placeholder="8787"
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                        color: palette.foreground,
                      },
                    ]}
                    value={endpointPort}
                  />
                  {endpointTestState !== "idle" ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={{
                        color:
                          endpointTestState === "verified" ? palette.foreground : palette.danger,
                      }}
                    >
                      {t(`mobile.connectionSettings.${endpointTestState}`)}
                    </Text>
                  ) : null}
                  <View style={styles.editorActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void testEndpoint()}
                      style={({ pressed }) => [
                        styles.editorButton,
                        { borderColor: palette.border, opacity: busy ? 0.4 : pressed ? 0.65 : 1 },
                      ]}
                    >
                      <Text style={[styles.endpointButtonText, { color: palette.foreground }]}>
                        {t("mobile.connectionSettings.testEndpoint")}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void saveEndpoint()}
                      style={({ pressed }) => [
                        styles.editorButton,
                        {
                          backgroundColor: palette.accent,
                          opacity: busy ? 0.4 : pressed ? 0.78 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.endpointButtonText, { color: palette.accentText }]}>
                        {t("mobile.connectionSettings.saveEndpoint")}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => setEditorOpen(false)}
                      style={styles.editorButton}
                    >
                      <Text style={[styles.endpointButtonText, { color: palette.foreground }]}>
                        {t("mobile.common.cancel")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || profile.endpoints.length >= 8}
                  onPress={() => openEndpointEditor()}
                  style={({ pressed }) => [
                    styles.addButton,
                    { borderColor: palette.border, opacity: busy ? 0.4 : pressed ? 0.65 : 1 },
                  ]}
                >
                  <Text style={[styles.endpointButtonText, { color: palette.foreground }]}>
                    {t("mobile.connectionSettings.addEndpoint")}
                  </Text>
                </Pressable>
              )}
            </View>

            <View
              style={[
                styles.warningCard,
                { backgroundColor: palette.warningSurface, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: palette.warningText }]}>
                {t("mobile.connectionSettings.removeTitle")}
              </Text>
              <Text style={[styles.body, { color: palette.warningText }]}>
                {confirmRemove
                  ? t("mobile.connectionSettings.removeConfirm")
                  : t("mobile.connectionSettings.removeDescription")}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void remove()}
                style={({ pressed }) => [
                  styles.removeButton,
                  { borderColor: palette.danger, opacity: busy ? 0.4 : pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.removeText, { color: palette.danger }]}>
                  {confirmRemove
                    ? t("mobile.connectionSettings.removeNow")
                    : t("mobile.connectionSettings.remove")}
                </Text>
              </Pressable>
            </View>
          </>
        )}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>
            {t("mobile.connectionSettings.updateFailed")}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { gap: 16, padding: 20, paddingBottom: 40 },
  backButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 4,
  },
  backText: { fontSize: 17, fontWeight: "600" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  card: { borderRadius: 16, borderWidth: 1, gap: 8, padding: 16 },
  warningCard: { borderRadius: 16, borderWidth: 1, gap: 10, padding: 16 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20 },
  fingerprint: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 12,
    lineHeight: 18,
  },
  section: { gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: "700" },
  endpoint: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 68,
    padding: 14,
  },
  endpointCopy: { flex: 1, gap: 4 },
  endpointAddress: { fontSize: 16, fontWeight: "600" },
  endpointMeta: { fontSize: 13 },
  endpointActions: { alignItems: "flex-end", flexShrink: 0, gap: 6 },
  endpointButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  endpointButtonText: { fontSize: 14, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18 },
  editorCard: { borderRadius: 14, borderWidth: 1, gap: 10, padding: 14 },
  fieldLabel: { fontSize: 15, fontWeight: "600" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  editorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  editorButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  addButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  removeText: { fontSize: 16, fontWeight: "600" },
});
