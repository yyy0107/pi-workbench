import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

export type MobileIconName = ComponentProps<typeof Ionicons>["name"];

export function MobileIcon({
  color,
  name,
  size = 22,
}: Readonly<{ color: string; name: MobileIconName; size?: number }>) {
  return (
    <Ionicons
      accessibilityElementsHidden
      color={color}
      importantForAccessibility="no-hide-descendants"
      name={name}
      size={size}
    />
  );
}

export function MobileIconButton({
  accessibilityLabel,
  color,
  disabled = false,
  name,
  onPress,
  style,
  surface,
}: Readonly<{
  accessibilityLabel: string;
  color: string;
  disabled?: boolean;
  name: MobileIconName;
  onPress(): void;
  style?: StyleProp<ViewStyle>;
  surface: string;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: surface, opacity: disabled ? 0.4 : pressed ? 0.62 : 1 },
        style,
      ]}
    >
      <MobileIcon color={color} name={name} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 28,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
});
