import { useI18n } from "@workbench/i18n";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mobileTranslationBundle } from "../i18n/index.ts";
import { useMobileApp } from "../state/mobile-app.tsx";
import { useMobilePalette } from "../ui/theme.ts";

export default function PairComputerScreen() {
  const { t } = useI18n(mobileTranslationBundle);
  const app = useMobileApp();
  const router = useRouter();
  const palette = useMobilePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("8787");
  const [manualCode, setManualCode] = useState("");
  const [manualInvalid, setManualInvalid] = useState(false);
  const scanLocked = useRef(false);
  const busy = app.pairing.status === "claiming" || app.pairing.status === "waiting";

  useEffect(() => {
    if (app.pairing.status !== "complete" || !app.pairing.machineId) return;
    router.replace({
      pathname: "/machines/[machineId]/sessions",
      params: { machineId: app.pairing.machineId },
    });
  }, [app.pairing.machineId, app.pairing.status, router]);

  useEffect(() => () => app.cancelPairing(), [app.cancelPairing]);

  const submitQr = async (rawCode: string) => {
    if (busy || !rawCode.trim()) return;
    scanLocked.current = true;
    try {
      await app.pairQr(rawCode);
    } catch {
      scanLocked.current = false;
    }
  };

  const submitManual = async () => {
    const parsedPort = Number(port);
    const invalid =
      !host.trim() ||
      !manualCode.trim() ||
      !Number.isSafeInteger(parsedPort) ||
      parsedPort < 1 ||
      parsedPort > 65_535;
    setManualInvalid(invalid);
    if (invalid || busy) return;
    try {
      await app.pairManual({ host: host.trim(), port: parsedPort, manualCode: manualCode.trim() });
    } catch {
      // The shared pairing state exposes a stable, localized failure below.
    }
  };

  const scanned = (result: BarcodeScanningResult) => {
    if (scanLocked.current || busy) return;
    void submitQr(result.data);
  };

  const pairingError =
    app.pairing.errorCode === "pairing_code_invalid" || app.pairing.errorCode === "pairing_expired"
      ? t("mobile.pairing.invalidCode")
      : app.pairing.errorCode === "endpoint_not_allowed"
        ? t("mobile.errors.endpointNotAllowed")
        : app.pairing.errorCode === "identity_mismatch"
          ? t("mobile.errors.identityMismatch")
          : t("mobile.pairing.failed");

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.safeArea}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                app.cancelPairing();
                router.back();
              }}
              style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={[styles.backText, { color: palette.foreground }]}>
                {t("mobile.common.back")}
              </Text>
            </Pressable>
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
            {t("mobile.pairing.title")}
          </Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            {t("mobile.pairing.description")}
          </Text>

          {app.status === "error" ? (
            <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>
              {t("mobile.common.configurationError")}
            </Text>
          ) : null}

          {app.pairing.status === "idle" || app.pairing.status === "error" ? (
            <>
              <View style={[styles.segment, { backgroundColor: palette.surface }]}>
                {(["scan", "manual"] as const).map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mode === item }}
                    onPress={() => {
                      app.resetPairing();
                      scanLocked.current = false;
                      setManualInvalid(false);
                      setMode(item);
                    }}
                    style={[
                      styles.segmentItem,
                      mode === item ? { backgroundColor: palette.accent } : undefined,
                    ]}
                  >
                    <Text
                      style={{
                        color: mode === item ? palette.accentText : palette.foreground,
                        fontSize: 15,
                        fontWeight: "600",
                      }}
                    >
                      {item === "scan"
                        ? t("mobile.pairing.scanQr")
                        : t("mobile.pairing.manualCode")}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {mode === "scan" ? (
                permission?.granted ? (
                  <View
                    accessibilityLabel={t("mobile.pairing.scanQrLabel")}
                    style={[styles.cameraFrame, { borderColor: palette.border }]}
                  >
                    <CameraView
                      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                      onBarcodeScanned={scanned}
                      style={StyleSheet.absoluteFill}
                    />
                  </View>
                ) : (
                  <View
                    style={[
                      styles.permissionCard,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.body, { color: palette.muted }]}>
                      {t("mobile.pairing.cameraPermission")}
                    </Text>
                    {permission?.canAskAgain !== false ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void requestPermission()}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          { backgroundColor: palette.accent, opacity: pressed ? 0.78 : 1 },
                        ]}
                      >
                        <Text style={[styles.buttonText, { color: palette.accentText }]}>
                          {t("mobile.pairing.allowCamera")}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setMode("manual")}
                      style={styles.textButton}
                    >
                      <Text style={[styles.textButtonLabel, { color: palette.foreground }]}>
                        {t("mobile.pairing.manualCode")}
                      </Text>
                    </Pressable>
                  </View>
                )
              ) : (
                <View style={styles.manualForm}>
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>
                    {t("mobile.pairing.manualHost")}
                  </Text>
                  <TextInput
                    accessibilityLabel={t("mobile.pairing.manualHost")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    onChangeText={setHost}
                    placeholder={t("mobile.pairing.manualHostPlaceholder")}
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                        color: palette.foreground,
                      },
                    ]}
                    value={host}
                  />
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>
                    {t("mobile.pairing.manualPort")}
                  </Text>
                  <TextInput
                    accessibilityLabel={t("mobile.pairing.manualPort")}
                    editable={!busy}
                    keyboardType="number-pad"
                    maxLength={5}
                    onChangeText={setPort}
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
                    value={port}
                  />
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>
                    {t("mobile.pairing.oneTimeCode")}
                  </Text>
                  <TextInput
                    accessibilityLabel={t("mobile.pairing.oneTimeCode")}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!busy}
                    maxLength={32}
                    onChangeText={setManualCode}
                    placeholder={t("mobile.pairing.oneTimeCodePlaceholder")}
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                        color: palette.foreground,
                      },
                    ]}
                    value={manualCode}
                  />
                  {manualInvalid ? (
                    <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>
                      {t("mobile.pairing.manualInvalid")}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void submitManual()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: palette.accent, opacity: busy ? 0.4 : pressed ? 0.78 : 1 },
                    ]}
                  >
                    <Text style={[styles.buttonText, { color: palette.accentText }]}>
                      {t("mobile.pairing.submitCode")}
                    </Text>
                  </Pressable>
                </View>
              )}
              {app.pairing.status === "error" ? (
                <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>
                  {pairingError}
                </Text>
              ) : null}
            </>
          ) : (
            <View
              style={[
                styles.waitingCard,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <ActivityIndicator color={palette.accent} />
              {app.pairing.status === "waiting" && app.pairing.safetyCode ? (
                <>
                  <Text style={[styles.safetyLabel, { color: palette.muted }]}>
                    {t("mobile.pairing.safetyCode")}
                  </Text>
                  <Text
                    accessibilityLiveRegion="polite"
                    selectable
                    style={[styles.safetyCode, { color: palette.foreground }]}
                  >
                    {app.pairing.safetyCode}
                  </Text>
                  <Text style={[styles.centeredBody, { color: palette.muted }]}>
                    {t("mobile.pairing.safetyDescription")}
                  </Text>
                  <Text style={[styles.centeredBody, { color: palette.foreground }]}>
                    {t("mobile.pairing.waiting")}
                  </Text>
                </>
              ) : (
                <Text style={[styles.body, { color: palette.foreground }]}>
                  {t("mobile.pairing.claiming")}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={app.cancelPairing}
                style={[styles.secondaryButton, { borderColor: palette.border }]}
              >
                <Text style={[styles.buttonText, { color: palette.foreground }]}>
                  {t("mobile.pairing.cancel")}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { gap: 16, padding: 20, paddingBottom: 40 },
  headerRow: { alignItems: "flex-start", minHeight: 44 },
  backButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: 4 },
  backText: { fontSize: 17, fontWeight: "600" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  body: { fontSize: 16, lineHeight: 24 },
  centeredBody: { fontSize: 16, lineHeight: 24, textAlign: "center" },
  segment: { borderRadius: 12, flexDirection: "row", padding: 4 },
  segmentItem: {
    alignItems: "center",
    borderRadius: 9,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 10,
  },
  cameraFrame: { aspectRatio: 1, borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  permissionCard: { borderRadius: 16, borderWidth: 1, gap: 16, padding: 20 },
  manualForm: { gap: 10 },
  fieldLabel: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },
  textButton: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  textButtonLabel: { fontSize: 16, fontWeight: "600" },
  buttonText: { fontSize: 17, fontWeight: "600" },
  waitingCard: { alignItems: "center", borderRadius: 20, borderWidth: 1, gap: 16, padding: 24 },
  safetyLabel: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  safetyCode: { fontSize: 38, fontVariant: ["tabular-nums"], fontWeight: "700", letterSpacing: 3 },
});
