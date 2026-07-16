import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from "react-native";

import { ManagerColors as Colors } from "@/constants/theme";

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

// Reusable dropdown select (opens as an absolute overlay, so it never pushes
// the layout). Use for month / year / any short option list.
export function Select({
  value,
  options,
  onChange,
  width,
  placeholder = "Select",
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  width?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={[styles.selectWrap, width ? { width } : { alignSelf: "flex-start", minWidth: 150 }, open && styles.selectWrapOpen]}>
      <Pressable style={styles.selectBtn} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.selectValue} numberOfLines={1}>{current?.label ?? placeholder}</Text>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={18} color={Colors.textMuted} />
      </Pressable>
      {open && (
        <>
          <Pressable style={fixedFill} onPress={() => setOpen(false)} />
          <View style={styles.selectMenu}>
            <ScrollView style={styles.selectScroll} showsVerticalScrollIndicator={false}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  style={styles.selectItem}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.selectItemText, o.value === value && styles.selectItemTextOn]} numberOfLines={1}>
                    {o.label}
                  </Text>
                  {o.value === value && <MaterialCommunityIcons name="check" size={16} color={Colors.primary} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

const fixedFill = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 } as unknown as ViewStyle;

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
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: "#1F2937",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.045,
    shadowRadius: 10,
    elevation: 1,
  },
  section: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
    color: Colors.textPrimary,
    marginTop: 6,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "transparent",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
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
  selectWrap: { position: "relative" },
  selectWrapOpen: { zIndex: 50 },
  selectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, height: 46, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface },
  selectValue: { fontSize: 15, color: Colors.textPrimary, fontWeight: "600", flex: 1 },
  selectMenu: { position: "absolute", top: 50, left: 0, right: 0, backgroundColor: Colors.cardSurface, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline, paddingVertical: 4, zIndex: 50, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 8 },
  selectScroll: { maxHeight: 240 },
  selectItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  selectItemText: { fontSize: 14, color: Colors.textBody, fontWeight: "600", flex: 1 },
  selectItemTextOn: { color: Colors.primary, fontWeight: "800" },
});
