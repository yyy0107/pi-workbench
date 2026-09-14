import { useI18n } from "@workbench/i18n";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { RemoteOrdinaryQuestionV1 } from "@workbench/remote-control-contracts/protocol";
import { mobileTranslationBundle } from "../i18n/index.ts";

type RemoteQuestionAnswers = Extract<
  import("@workbench/remote-control-contracts/protocol").RemoteOperationRequestV1["command"],
  { type: "interaction.answerQuestion" }
>["answers"];

export function MobileOrdinaryQuestion(props: {
  readonly interaction: RemoteOrdinaryQuestionV1;
  readonly ready: boolean;
  readonly colors: {
    readonly foreground: string;
    readonly muted: string;
    readonly border: string;
    readonly surface: string;
    readonly accent: string;
    readonly accentText: string;
  };
  onAnswer(answers: RemoteQuestionAnswers): void | Promise<void>;
}) {
  const { t } = useI18n(mobileTranslationBundle);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const complete = props.interaction.questions.every((question) =>
    question.options?.length
      ? Boolean(selected[question.questionId])
      : Boolean(custom[question.questionId]?.trim()),
  );
  const submit = async () => {
    if (!props.ready || !complete || busy) return;
    setBusy(true);
    try {
      await props.onAnswer(
        props.interaction.questions.map((question) => ({
          questionId: question.questionId,
          ...(selected[question.questionId] ? { optionIds: [selected[question.questionId]!] } : {}),
          ...(custom[question.questionId]?.trim()
            ? { text: custom[question.questionId]!.trim() }
            : {}),
        })),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: props.colors.surface, borderColor: props.colors.border },
      ]}
    >
      <Text style={[styles.title, { color: props.colors.foreground }]}>
        {t("mobile.question.title")}
      </Text>
      {props.interaction.questions.map((question) => (
        <View key={question.questionId} style={styles.question}>
          <Text style={[styles.prompt, { color: props.colors.foreground }]}>{question.prompt}</Text>
          {question.options?.length ? (
            <View accessibilityLabel={t("mobile.question.selectOption")} style={styles.options}>
              {question.options.map((option) => {
                const active = selected[question.questionId] === option.optionId;
                return (
                  <Pressable
                    key={option.optionId}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: !props.ready }}
                    disabled={!props.ready}
                    onPress={() =>
                      setSelected((current) => ({
                        ...current,
                        [question.questionId]: option.optionId,
                      }))
                    }
                    style={({ pressed }) => [
                      styles.option,
                      {
                        borderColor: active ? props.colors.accent : props.colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: props.colors.foreground }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              accessibilityLabel={question.prompt}
              editable={props.ready}
              onChangeText={(value) =>
                setCustom((current) => ({ ...current, [question.questionId]: value }))
              }
              placeholder={t("mobile.question.customPlaceholder")}
              placeholderTextColor={props.colors.muted}
              style={[
                styles.input,
                { borderColor: props.colors.border, color: props.colors.foreground },
              ]}
              value={custom[question.questionId] ?? ""}
            />
          )}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={!props.ready || !complete || busy}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.submit,
          {
            backgroundColor: props.colors.accent,
            opacity: !props.ready || !complete || busy ? 0.4 : pressed ? 0.72 : 1,
          },
        ]}
      >
        <Text style={[styles.submitText, { color: props.colors.accentText }]}>
          {t("mobile.question.submit")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, gap: 14, padding: 14 },
  title: { fontSize: 16, fontWeight: "700" },
  question: { gap: 8 },
  prompt: { fontSize: 15, lineHeight: 21 },
  options: { gap: 7 },
  option: { borderRadius: 10, borderWidth: 1, minHeight: 44, padding: 12 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, minHeight: 46, padding: 12 },
  submit: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 46 },
  submitText: { fontSize: 15, fontWeight: "600" },
});
