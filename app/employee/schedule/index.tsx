import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { getHoliday } from "@/lib/holidays";
import {
  Schedule,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  effectiveShift,
  emptySchedule,
  formatShift,
  subscribeSchedule,
} from "@/lib/schedules";

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const inset = useResponsiveInset(18);
  const { employee } = useSession();

  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    if (!employee) return;
    const unsub = subscribeSchedule(
      employee.employeeId,
      setSchedule,
      () => setSchedule(emptySchedule(employee.employeeId, employee.fullName)),
    );
    return unsub;
  }, [employee]);

  const sched = schedule ?? (employee ? emptySchedule(employee.employeeId, employee.fullName) : null);

  const today = new Date();
  const todayYMD = ymd(today);
  const todayShift = sched ? effectiveShift(sched, todayYMD) : null;
  const todayHoliday = getHoliday(todayYMD);

  // Next 7 days, resolved to their effective shift (override or weekly).
  const upcoming = useMemo(() => {
    if (!sched) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const key = ymd(d);
      return {
        date: d,
        key,
        shift: effectiveShift(sched, key),
        isOverride: !!sched.overrides[key],
        holiday: getHoliday(key),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sched]);

  if (!employee) return <Redirect href="/login" />;
  if (!sched || !todayShift) return null;

  return (
    <View style={styles.screen}>
      <AmbientTop height={240} />

      <View style={[styles.header, { paddingHorizontal: inset }]}>
        <Pressable style={styles.iconBtn} onPress={() => router.replace("/employee/dashboard")}>
          <Ionicons name="chevron-back" size={20} color="#141414" />
        </Pressable>
        <BrandTitle size={26} />
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: inset }]}
      >
        <Text style={styles.pageTitle}>My Schedule</Text>
        <Text style={styles.pageSub}>Set by your manager · updates live</Text>

        {/* ── Today ── */}
        <View style={[styles.todayCard, todayShift.off && styles.todayCardOff]}>
          <View style={styles.todayHeaderRow}>
            <View style={styles.todayBadge}>
              <MaterialCommunityIcons
                name={todayShift.off ? "sleep" : "clock-time-four-outline"}
                size={16}
                color="#ffffff"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.todayEyebrow}>TODAY · {WEEKDAY_LABELS[today.getDay()]}</Text>
              <Text style={styles.todayShift}>{formatShift(todayShift)}</Text>
            </View>
          </View>
          {todayHoliday && (
            <View style={styles.holidayPill}>
              <MaterialCommunityIcons name="calendar-star" size={13} color="#1A1A1A" />
              <Text style={styles.holidayPillText}>{todayHoliday.name}</Text>
            </View>
          )}
        </View>

        {/* ── Weekly default ── */}
        <Text style={styles.sectionLabel}>Weekly Schedule</Text>
        <View style={styles.card}>
          {WEEKDAY_LABELS.map((label, day) => {
            const shift = sched.weekly[day];
            const isToday = day === today.getDay();
            return (
              <View key={label} style={[styles.weekRow, day < 6 && styles.weekRowBorder]}>
                <View style={[styles.dayChip, isToday && styles.dayChipToday]}>
                  <Text style={[styles.dayChipText, isToday && styles.dayChipTextToday]}>
                    {WEEKDAY_SHORT[day]}
                  </Text>
                </View>
                <Text style={[styles.weekDayLabel, isToday && styles.weekDayLabelToday]}>{label}</Text>
                <Text style={[styles.weekShift, shift.off && styles.weekShiftOff]}>
                  {formatShift(shift)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Next 7 days (with overrides) ── */}
        <Text style={styles.sectionLabel}>Next 7 Days</Text>
        <View style={styles.card}>
          {upcoming.map((item, idx) => (
            <View key={item.key} style={[styles.upRow, idx < upcoming.length - 1 && styles.weekRowBorder]}>
              <View style={styles.upDateBadge}>
                <Text style={styles.upDateNum}>{item.date.getDate()}</Text>
                <Text style={styles.upDateDow}>{WEEKDAY_SHORT[item.date.getDay()]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.upShift, item.shift.off && styles.weekShiftOff]}>
                  {formatShift(item.shift)}
                </Text>
                <View style={styles.upTags}>
                  {item.isOverride && (
                    <View style={styles.tagOverride}>
                      <Text style={styles.tagOverrideText}>Adjusted</Text>
                    </View>
                  )}
                  {item.holiday && (
                    <View style={styles.tagHoliday}>
                      <Text style={styles.tagHolidayText}>{item.holiday.name}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.note}>
          <MaterialCommunityIcons name="information-outline" size={14} color="#8A8A8A" />
          <Text style={styles.noteText}>
            Need a change? Message your manager — they update schedules from the manager portal.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F5F0" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 14,
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
  scroll: { paddingTop: 8, paddingBottom: 60 },
  pageTitle: { fontSize: 26, fontWeight: "700", color: "#141414", letterSpacing: -0.6 },
  pageSub: { fontSize: 13, color: "#8A8A8A", fontWeight: "500", marginTop: 3, marginBottom: 20 },

  todayCard: {
    backgroundColor: "#141414",
    borderRadius: 20,
    padding: 18,
    marginBottom: 24,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 5,
  },
  todayCardOff: { backgroundColor: "#6B6B6B" },
  todayHeaderRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  todayBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  todayEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#D8D2C6",
    letterSpacing: 1,
  },
  todayShift: { fontSize: 22, fontWeight: "700", color: "#ffffff", marginTop: 3, letterSpacing: -0.4 },
  holidayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  holidayPillText: { fontSize: 12, fontWeight: "700", color: "#1A1A1A" },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A8A8A",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    paddingHorizontal: 16,
    marginBottom: 24,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
  weekRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  weekRowBorder: { borderBottomWidth: 1, borderBottomColor: "#F2EFE9" },
  dayChip: {
    width: 40,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#F2EFE9",
    alignItems: "center",
    justifyContent: "center",
  },
  dayChipToday: { backgroundColor: "#2F6B4F" },
  dayChipText: { fontSize: 11, fontWeight: "700", color: "#0A0A0A" },
  dayChipTextToday: { color: "#ffffff" },
  weekDayLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: "#141414" },
  weekDayLabelToday: { color: "#2F6B4F" },
  weekShift: { fontSize: 13, fontWeight: "600", color: "#6B6B6B", fontVariant: ["tabular-nums"] },
  weekShiftOff: { color: "#A8A8A8", fontStyle: "italic" },

  upRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  upDateBadge: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: "rgba(10, 10, 10, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  upDateNum: { fontSize: 18, fontWeight: "700", color: "#0A0A0A", lineHeight: 20 },
  upDateDow: { fontSize: 9, fontWeight: "700", color: "#0A0A0A", textTransform: "uppercase" },
  upShift: { fontSize: 14, fontWeight: "600", color: "#141414" },
  upTags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
  tagOverride: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: "rgba(154, 123, 63, 0.12)",
  },
  tagOverrideText: { fontSize: 10, fontWeight: "700", color: "#6E5526", letterSpacing: 0.3 },
  tagHoliday: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: "rgba(26, 26, 26, 0.08)",
  },
  tagHolidayText: { fontSize: 10, fontWeight: "700", color: "#1A1A1A" },

  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(10, 10, 10, 0.04)",
  },
  noteText: { flex: 1, fontSize: 12, color: "#6B6B6B", fontWeight: "500", lineHeight: 17 },
});
