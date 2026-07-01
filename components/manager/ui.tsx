import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

import { Colors } from "@/constants/theme";

// Small set of shared building blocks so every manager tab looks consistent.

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "pending" | "approved" | "rejected" | "in" | "out" | "warning" | "critical";
}) {
  return (
    <View style={[styles.badge, toneBg[tone]]}>
      <Text style={[styles.badgeText, toneFg[tone]]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, text }: { icon: MdIcon; text: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={42} color={Colors.textPlaceholder} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const toneBg: Record<string, ViewStyle> = {
  neutral: { backgroundColor: Colors.warmSurfaceAlt },
  pending: { backgroundColor: Colors.warningSurface },
  approved: { backgroundColor: Colors.successTint },
  rejected: { backgroundColor: Colors.dangerTint },
  in: { backgroundColor: Colors.successTint },
  out: { backgroundColor: Colors.warmSurfaceAlt },
  warning: { backgroundColor: Colors.warningSurface },
  critical: { backgroundColor: Colors.dangerTint },
};

const toneFg: Record<string, { color: string }> = {
  neutral: { color: Colors.primaryDark },
  pending: { color: Colors.warningDeep },
  approved: { color: Colors.success },
  rejected: { color: Colors.danger },
  in: { color: Colors.success },
  out: { color: Colors.primaryDark },
  warning: { color: Colors.warningDeep },
  critical: { color: Colors.danger },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardSurface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  section: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    color: Colors.textSubtle,
    marginBottom: 14,
  },
  badge: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 50,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textFaint,
    fontWeight: "500",
  },
});
