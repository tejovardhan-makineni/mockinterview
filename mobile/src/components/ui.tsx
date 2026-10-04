import { ComponentProps, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, s } from "../theme";

export type IconName = ComponentProps<typeof Feather>["name"];
export const Icon = ({
  name,
  size = 20,
  color = colors.accent,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) => (
  <Feather
    accessible={false}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    aria-hidden
    name={name}
    size={size}
    color={color}
  />
);
export function Button({
  children,
  onPress,
  icon,
  ghost,
  disabled,
  label,
}: {
  children: string;
  onPress: () => void;
  icon?: IconName;
  ghost?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? children}
      aria-disabled={!!disabled}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        ghost && s.ghost,
        { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={[s.buttonText, ghost && s.ghostText]}>{children}</Text>
      {icon && (
        <Icon name={icon} size={18} color={ghost ? colors.accent : "#fff"} />
      )}
    </Pressable>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  disabled,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.iconButton,
        {
          backgroundColor: pressed ? colors.soft : "transparent",
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Icon name={name} />
    </Pressable>
  );
}
export function Label({ children }: { children: string }) {
  return <Text style={s.eyebrow}>{children.toUpperCase()}</Text>;
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
