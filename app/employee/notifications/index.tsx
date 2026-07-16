import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AppNotification, markAllRead, subscribeMyNotifications } from "@/lib/notifications";

const INK = "#141414";
const MUTED = "#6B6B6B";
const FAINT = "#A8A8A8";

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
function iconFor(k: string): { name: MdIcon; color: string } {
  if (k === "success") return { name: "check-circle-outline", color: "#2F6B4F" };
  if (k === "warning") return { name: "alert-circle-outline", color: "#B23A3A" };
  return { name: "information-outline", color: "#3A5A7A" };
}

export default function EmployeeNotifications() {
  const inset = useResponsiveInset(22);
  const { employee } = useSession();
  const [items, setItems] = React.useState<AppNotification[]>([]);
  const employeeId = employee?.employeeId ?? "";

  useEffect(() => {
    if (!employeeId) return;
    return subscribeMyNotifications(employeeId, setItems, () => setItems([]));
  }, [employeeId]);

  // Mark everything read shortly after opening.
  useEffect(() => {
    if (!employeeId) return;
    const t = setTimeout(() => markAllRead(employeeId).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [employeeId]);

  if (!employee) return <Redirect href="/login" />;

  return (
    <View style={styles.screen}>
      <AmbientTop height={280} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: inset }]} showsVerticalScrollIndicator={false}>
        <View style={styles.brandBar}>
          <BrandTitle size={28} />
        </View>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.sub}>Updates on your requests and leaves</Text>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="bell-sleep-outline" size={40} color={FAINT} />
            <Text style={styles.emptyText}>No notifications yet.</Text>
          </View>
        ) : (
          items.map((n) => {
            const ic = iconFor(n.kind);
            return (
              <View key={n.id} style={[styles.card, !n.read && styles.unread]}>
                <View style={[styles.icon, { backgroundColor: ic.color + "1A" }]}>
                  <MaterialCommunityIcons name={ic.name} size={22} color={ic.color} />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.cardTitle}>{n.title}</Text>
                  <Text style={styles.cardBody}>{n.body}</Text>
                  {n.createdAt ? (
                    <Text style={styles.time}>{n.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                  ) : null}
                </View>
                {!n.read && <View style={styles.dot} />}
              </View>
            );
          })
        )}
      </ScrollView>
      <BottomNav active="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F5F0" },
  scroll: { flex: 1 },
  content: { paddingTop: 56, paddingBottom: 130 },
  brandBar: { marginBottom: 18 },
  title: { fontSize: 28, fontWeight: "800", color: INK, letterSpacing: -0.6 },
  sub: { fontSize: 14, color: MUTED, marginTop: 2, fontWeight: "500", marginBottom: 18 },
  empty: { marginTop: 20, alignItems: "center", gap: 10 },
  emptyText: { color: MUTED, fontSize: 14 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "rgba(10,10,10,0.04)" },
  unread: { borderColor: "rgba(47,107,79,0.28)", backgroundColor: "#FBFDFC" },
  icon: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: INK },
  cardBody: { fontSize: 13, color: "#2A2A2A", marginTop: 2, lineHeight: 18 },
  time: { fontSize: 11, color: FAINT, marginTop: 4 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#2F6B4F", marginTop: 4 },
});
