import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApprovalsTab } from "@/components/manager/ApprovalsTab";
import { AttendanceTab } from "@/components/manager/AttendanceTab";
import { DevicesTab } from "@/components/manager/DevicesTab";
import { DtrTab } from "@/components/manager/DtrTab";
import { LeavesTab } from "@/components/manager/LeavesTab";
import { SchedulesTab } from "@/components/manager/SchedulesTab";
import { Colors } from "@/constants/theme";
import { useSession } from "@/contexts/session-context";
import { signOutUser } from "@/lib/auth";
import { subscribeAlarms } from "@/lib/devices";
import { subscribePendingLeaves } from "@/lib/leaves";

type TabKey = "approvals" | "attendance" | "schedules" | "dtr" | "devices" | "leaves";

const TABS: { key: TabKey; label: string }[] = [
  { key: "approvals", label: "Approvals" },
  { key: "attendance", label: "Attendance" },
  { key: "schedules", label: "Schedules" },
  { key: "dtr", label: "DTR" },
  { key: "devices", label: "Devices" },
  { key: "leaves", label: "Leaves" },
];

export default function ManagerPortal() {
  const router = useRouter();
  const { employee, setEmployee } = useSession();
  const [tab, setTab] = useState<TabKey>("approvals");
  const [pendingCount, setPendingCount] = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);

  useEffect(() => subscribePendingLeaves((l) => setPendingCount(l.length), () => setPendingCount(0)), []);
  useEffect(
    () => subscribeAlarms((a) => setAlarmCount(a.filter((x) => !x.acknowledged).length), () => setAlarmCount(0)),
    [],
  );

  if (!employee) return <Redirect href="/login" />;
  if (employee.accessRole === "staff") return <Redirect href="/employee/dashboard" />;

  const initials = employee.fullName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const logout = async () => {
    try {
      await signOutUser();
    } catch {
      // ignore
    }
    setEmployee(null);
    router.replace("/login");
  };

  const badgeFor = (key: TabKey) =>
    key === "approvals" ? pendingCount : key === "devices" ? alarmCount : 0;

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.who}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View>
            <Text style={styles.name}>{employee.fullName}</Text>
            <Text style={styles.role}>
              {employee.role} · {employee.accessRole}
            </Text>
          </View>
        </View>
        <Pressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.key === tab;
            const count = badgeFor(t.key);
            return (
              <Pressable key={t.key} style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                {count > 0 && (
                  <View style={styles.count}>
                    <Text style={styles.countText}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.content}>
          {tab === "approvals" && <ApprovalsTab reviewerName={employee.fullName} />}
          {tab === "attendance" && <AttendanceTab />}
          {tab === "schedules" && <SchedulesTab managerName={employee.fullName} />}
          {tab === "dtr" && <DtrTab />}
          {tab === "devices" && <DevicesTab />}
          {tab === "leaves" && <LeavesTab />}
        </View>

        <Text style={styles.footer}>Qui · Manager Portal · real-time via Firestore</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  bar: {
    backgroundColor: Colors.darkSurface,
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  name: { color: Colors.textOnDark, fontWeight: "700", fontSize: 15 },
  role: { color: "#D8D2C6", fontSize: 12, textTransform: "capitalize" },
  logout: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  logoutText: { color: Colors.textOnDark, fontWeight: "600", fontSize: 13 },

  container: { maxWidth: 940, width: "100%", alignSelf: "center", paddingHorizontal: 24, paddingTop: 22, paddingBottom: 60 },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    backgroundColor: Colors.warmSurface,
    padding: 5,
    borderRadius: 14,
    marginBottom: 22,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  tabBtnActive: { backgroundColor: Colors.cardSurface },
  tabText: { fontSize: 14, fontWeight: "600", color: Colors.textSubtle },
  tabTextActive: { color: Colors.textPrimary },
  count: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  content: { minHeight: 200 },
  footer: { textAlign: "center", color: Colors.textFaint, fontSize: 12, marginTop: 30 },
});
