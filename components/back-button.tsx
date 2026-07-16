import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { BrandTitle } from "@/components/brand-title";

// Circular "‹" back control, matching the one on the Schedule page.
export function BackButton({ fallback = "/employee/dashboard" }: { fallback?: string }) {
  const router = useRouter();
  const onPress = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  };
  return (
    <Pressable style={styles.iconBtn} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
      <Ionicons name="chevron-back" size={20} color="#141414" />
    </Pressable>
  );
}

// Standard header for deep employee pages: circular back button on the left,
// the centered wordmark, and a spacer on the right to keep it balanced —
// identical to the Schedule screen's header.
export function PageHeader({ brandSize = 26, fallback = "/employee/dashboard" }: { brandSize?: number; fallback?: string }) {
  return (
    <View style={styles.header}>
      <BackButton fallback={fallback} />
      <BrandTitle size={brandSize} />
      <View style={styles.iconBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
});
