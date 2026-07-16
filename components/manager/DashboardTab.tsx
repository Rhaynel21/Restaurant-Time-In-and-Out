import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BarChart, BarDatum } from "@/components/manager/BarChart";
import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { WorkforceTab } from "@/components/manager/WorkforceTab";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRecord, getAttendanceSince, subscribeAllTodayAttendance } from "@/lib/attendance";
import { inScope } from "@/lib/org";

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hourLabel(h: number) {
  const period = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function fmtTime(value: Date | null) {
  return value ? value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
}

// The most recent punch event on a record: a time-out if present, else the time-in.
type ActivityEvent = { id: string; name: string; branch: string; kind: "in" | "out"; at: Date };

function toEvent(r: AttendanceRecord): ActivityEvent {
  return r.checkOutAt
    ? { id: r.id + "-out", name: r.employeeName, branch: r.branchName, kind: "out", at: r.checkOutAt }
    : { id: r.id + "-in", name: r.employeeName, branch: r.branchName, kind: "in", at: r.checkInAt };
}

export function DashboardTab({
  managerName,
  pendingCount,
  alarmCount,
  allowed,
}: {
  managerName: string;
  pendingCount: number;
  alarmCount: number;
  allowed: Set<string> | null;
}) {
  const [allRows, setAllRows] = useState<AttendanceRecord[]>([]);
  useEffect(() => subscribeAllTodayAttendance(setAllRows, () => setAllRows([])), []);
  const rows = useMemo(() => allRows.filter((r) => inScope(r.branchId, allowed)), [allRows, allowed]);

  // Last 7 days of punches, fetched once for the trend chart.
  const [week, setWeek] = useState<AttendanceRecord[]>([]);
  useEffect(() => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);
    getAttendanceSince(since.getTime()).then(setWeek).catch(() => setWeek([]));
  }, []);

  const { onShift, onBreak, done, total, events } = useMemo(() => {
    const isOnBreak = (r: AttendanceRecord) => !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
    const onBreak = rows.filter(isOnBreak).length;
    const onShift = rows.filter((r) => !r.checkOutAt && !isOnBreak(r)).length;
    const done = rows.filter((r) => r.checkOutAt).length;
    const ids = new Set(rows.map((r) => r.employeeId));
    const events = rows.map(toEvent).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);
    return { onShift, onBreak, done, total: ids.size, events };
  }, [rows]);

  // Time-ins bucketed by hour (6am–9pm), from today's punches.
  const hourData: BarDatum[] = useMemo(() => {
    const START = 6;
    const END = 21;
    const counts = new Array(END - START + 1).fill(0);
    rows.forEach((r) => {
      const h = r.checkInAt.getHours();
      if (h >= START && h <= END) counts[h - START] += 1;
    });
    return counts.map((v, i) => ({ label: (START + i) % 3 === 0 ? hourLabel(START + i) : "", value: v }));
  }, [rows]);

  // Distinct headcount per day across the last 7 days.
  const weekData: BarDatum[] = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const days: BarDatum[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const key = dayKey(d);
      const ids = new Set<string>();
      week.forEach((r) => {
        if (dayKey(r.checkInAt) === key && inScope(r.branchId, allowed)) ids.add(r.employeeId);
      });
      days.push({ label: WD_SHORT[d.getDay()], value: ids.size });
    }
    // Keep today's bar live as people clock in after the initial fetch.
    days[6].value = Math.max(days[6].value, total);
    return days;
  }, [week, total, allowed]);

  const statusTotal = onShift + onBreak + done;
  const segments = [
    { key: "shift", label: "On shift", value: onShift, color: Colors.success },
    { key: "break", label: "On break", value: onBreak, color: Colors.warning },
    { key: "out", label: "Timed out", value: done, color: Colors.textFaint },
  ];

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const stats: { label: string; value: number; icon: MdIcon; tone: "in" | "out" | "neutral" | "pending" | "critical" }[] = [
    { label: "On shift now", value: onShift, icon: "account-clock", tone: "in" },
    { label: "On break", value: onBreak, icon: "silverware-fork-knife", tone: "pending" },
    { label: "Timed out", value: done, icon: "logout-variant", tone: "out" },
    { label: "Timed in today", value: total, icon: "account-check", tone: "neutral" },
    { label: "Pending approvals", value: pendingCount, icon: "clipboard-text-clock-outline", tone: "pending" },
    { label: "Open alarms", value: alarmCount, icon: "shield-alert-outline", tone: "critical" },
  ];

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.hello}>
          {greeting}, {managerName.split(" ")[0]}
        </Text>
        <Text style={styles.date}>{todayLabel}</Text>
      </View>

      <View style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={styles.tile}>
            <View style={[styles.tileIcon, tileTint[s.tone]]}>
              <MaterialCommunityIcons name={s.icon} size={20} color={tileFg[s.tone]} />
            </View>
            <Text style={styles.tileValue}>{s.value}</Text>
            <Text style={styles.tileLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.chartRow}>
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Today&apos;s status</Text>
          <View style={styles.segBar}>
            {statusTotal === 0 ? (
              <View style={[styles.seg, { flexGrow: 1, backgroundColor: Colors.warmSurfaceAlt }]} />
            ) : (
              segments
                .filter((s) => s.value > 0)
                .map((s) => <View key={s.key} style={[styles.seg, { flexGrow: s.value, backgroundColor: s.color }]} />)
            )}
          </View>
          <View style={styles.legend}>
            {segments.map((s) => (
              <View key={s.key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={styles.legendText}>
                  {s.label} <Text style={styles.legendVal}>{s.value}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Headcount · last 7 days</Text>
          <BarChart data={weekData} />
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Time-ins by hour · today</Text>
          <BarChart data={hourData} showValues={false} />
        </View>
      </View>

      <SectionTitle>Recent Time In / Out</SectionTitle>
      {events.length === 0 ? (
        <EmptyState icon="clock-outline" text="No clock-ins yet today" />
      ) : (
        <Card style={{ padding: 0 }}>
          {events.map((e, i) => (
            <View key={e.id} style={[styles.row, i < events.length - 1 && styles.rowBorder]}>
              <View style={[styles.dot, e.kind === "in" ? styles.dotIn : styles.dotOut]} />
              <View style={styles.grow}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text style={styles.rowBranch} numberOfLines={1}>
                  {e.branch}
                </Text>
              </View>
              <Text style={styles.rowTime}>{fmtTime(e.at)}</Text>
              <View style={styles.rowBadge}>
                <Badge label={e.kind === "in" ? "Timed in" : "Timed out"} tone={e.kind === "in" ? "in" : "out"} />
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* ── Workforce analytics (merged from the old Analytics tab) ── */}
      <View style={styles.analyticsHeader}>
        <Text style={styles.analyticsTitle}>Workforce Analytics</Text>
        <Text style={styles.analyticsSub}>Headcount, tenure, leave, and labor-cost overview</Text>
      </View>
      <WorkforceTab allowed={allowed} />
    </View>
  );
}

const tileTint: Record<string, { backgroundColor: string }> = {
  in: { backgroundColor: Colors.successTint },
  out: { backgroundColor: Colors.warmSurfaceAlt },
  neutral: { backgroundColor: Colors.primaryTint },
  pending: { backgroundColor: Colors.warningSurface },
  critical: { backgroundColor: Colors.dangerTint },
};
const tileFg: Record<string, string> = {
  in: Colors.success,
  out: Colors.primaryDark,
  neutral: Colors.primary,
  pending: Colors.warningDeep,
  critical: Colors.danger,
};

const styles = StyleSheet.create({
  header: { marginBottom: 18 },
  hello: { fontSize: 20, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3 },
  date: { fontSize: 13, fontWeight: "600", color: Colors.textFaint, marginTop: 3 },

  analyticsHeader: {
    marginTop: 30,
    marginBottom: 16,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  analyticsTitle: { fontSize: 17, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3 },
  analyticsSub: { fontSize: 13, fontWeight: "500", color: Colors.textFaint, marginTop: 3 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 22 },

  chartRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 26 },
  chartCard: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 240,
    backgroundColor: Colors.cardSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
  },
  chartTitle: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary, marginBottom: 14 },
  segBar: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", gap: 2, marginBottom: 14 },
  seg: { height: "100%" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 12, color: Colors.textMuted, fontWeight: "600" },
  legendVal: { color: Colors.textPrimary, fontWeight: "800" },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    backgroundColor: Colors.cardSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  tileValue: { fontSize: 28, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.5 },
  tileLabel: { fontSize: 12, color: Colors.textSubtle, marginTop: 2, fontWeight: "600" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotIn: { backgroundColor: Colors.success },
  dotOut: { backgroundColor: Colors.textFaint },
  grow: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  rowBranch: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  rowTime: { fontSize: 14, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  rowBadge: { width: 92, alignItems: "flex-end" },
});
