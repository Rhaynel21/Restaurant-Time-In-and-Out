import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Column, DataTable, EmptyState } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRecord, subscribeAllTodayAttendance } from "@/lib/attendance";
import { inScope } from "@/lib/org";

function fmt(value: Date | null) {
  return value ? value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
}

// Live status of one punch record: on break (out for break, not back) → on shift
// (still clocked in) → done (timed out).
function statusOf(r: AttendanceRecord): { label: string; tone: "in" | "warning" | "out" } {
  const onBreak = !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
  if (onBreak) return { label: "On break", tone: "warning" };
  if (!r.checkOutAt) return { label: "On shift", tone: "in" };
  return { label: "Done", tone: "out" };
}

type BranchGroup = {
  branchId: string;
  branchName: string;
  rows: AttendanceRecord[];
  onShift: number;
  onBreak: number;
  done: number;
};

// Step 4 — the one exception queue. Anomalies HR should resolve before the DTR is
// locked: a shift auto-closed at midnight (someone forgot to time out), a shift
// still open many hours in, or a meal break that never ended.
type Exception = { record: AttendanceRecord; reason: string };

function detectException(r: AttendanceRecord, nowMs: number): Exception | null {
  const hoursSinceIn = (nowMs - r.checkInAt.getTime()) / 3_600_000;
  if (r.autoClosed) return { record: r, reason: "Missing time-out — auto-closed at midnight" };
  if (!r.checkOutAt && r.breakOutAt && !r.breakInAt && (nowMs - r.breakOutAt.getTime()) / 3_600_000 > 2) {
    return { record: r, reason: "On break over 2 h — no break-in punch" };
  }
  if (!r.checkOutAt && hoursSinceIn > 14) return { record: r, reason: `Shift open ${Math.floor(hoursSinceIn)} h — likely forgot to time out` };
  return null;
}

const columns: Column<AttendanceRecord>[] = [
  { key: "name", header: "Employee", flex: 2, render: (r) => r.employeeName },
  { key: "in", header: "Time in", flex: 1, render: (r) => fmt(r.checkInAt) },
  { key: "out", header: "Time out", flex: 1, render: (r) => fmt(r.checkOutAt) },
  {
    key: "status",
    header: "Status",
    width: 110,
    render: (r) => {
      const s = statusOf(r);
      return <Badge label={s.label} tone={s.tone} />;
    },
  },
];

export function AttendanceTab({ allowed }: { allowed: Set<string> | null }) {
  const [allRows, setAllRows] = useState<AttendanceRecord[]>([]);
  useEffect(() => subscribeAllTodayAttendance(setAllRows, () => setAllRows([])), []);

  // Group the live stream into one section per branch, each with its own tallies.
  const groups = useMemo<BranchGroup[]>(() => {
    const rows = allRows.filter((r) => inScope(r.branchId, allowed));
    const byBranch = new Map<string, BranchGroup>();
    for (const r of rows) {
      const key = r.branchId || "unknown-branch";
      let g = byBranch.get(key);
      if (!g) {
        g = { branchId: key, branchName: r.branchName || "Unassigned", rows: [], onShift: 0, onBreak: 0, done: 0 };
        byBranch.set(key, g);
      }
      g.rows.push(r);
      const tone = statusOf(r).tone;
      if (tone === "warning") g.onBreak += 1;
      else if (tone === "in") g.onShift += 1;
      else g.done += 1;
    }
    return [...byBranch.values()].sort((a, b) => a.branchName.localeCompare(b.branchName));
  }, [allRows, allowed]);

  const totals = useMemo(
    () =>
      groups.reduce(
        (t, g) => ({ rows: t.rows + g.rows.length, onShift: t.onShift + g.onShift, onBreak: t.onBreak + g.onBreak, done: t.done + g.done }),
        { rows: 0, onShift: 0, onBreak: 0, done: 0 },
      ),
    [groups],
  );

  const exceptions = useMemo<Exception[]>(() => {
    const nowMs = Date.now();
    return allRows
      .filter((r) => inScope(r.branchId, allowed))
      .map((r) => detectException(r, nowMs))
      .filter((e): e is Exception => e !== null);
  }, [allRows, allowed]);

  if (totals.rows === 0) {
    return <EmptyState icon="clock-outline" text="No clock-ins yet today" />;
  }

  return (
    <View>
      {/* Portal-wide tallies across every in-scope branch. */}
      <View style={styles.summaryRow}>
        <Badge label={`${totals.onShift} on shift`} tone="in" />
        <Badge label={`${totals.onBreak} on break`} tone="warning" />
        <Badge label={`${totals.done} timed out`} tone="out" />
        {exceptions.length > 0 && <Badge label={`${exceptions.length} exception${exceptions.length === 1 ? "" : "s"}`} tone="critical" />}
        <Text style={styles.summaryTotal}>{totals.rows} total today</Text>
      </View>

      {exceptions.length > 0 && (
        <View style={styles.exceptionCard}>
          <View style={styles.exceptionHead}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.warningDeep} />
            <Text style={styles.exceptionTitle}>Exception queue</Text>
            <Text style={styles.exceptionCount}>{exceptions.length} to resolve</Text>
          </View>
          {exceptions.map(({ record, reason }) => (
            <View key={record.id} style={styles.exceptionRow}>
              <View style={styles.exceptionMain}>
                <Text style={styles.exceptionName} numberOfLines={1}>{record.employeeName}</Text>
                <Text style={styles.exceptionReason} numberOfLines={1}>{reason}</Text>
              </View>
              <Text style={styles.exceptionBranch} numberOfLines={1}>{record.branchName}</Text>
              <Text style={styles.exceptionTime}>in {fmt(record.checkInAt)}</Text>
            </View>
          ))}
          <Text style={styles.exceptionFoot}>Resolve each in DTR (correct the punch), then lock the cutoff to freeze attendance.</Text>
        </View>
      )}

      {groups.map((g) => (
        <View key={g.branchId} style={styles.branchSection}>
          <View style={styles.branchHead}>
            <Text style={styles.branchName} numberOfLines={1}>{g.branchName}</Text>
            <View style={styles.branchTallies}>
              {g.onShift > 0 && <Badge label={`${g.onShift} on shift`} tone="in" />}
              {g.onBreak > 0 && <Badge label={`${g.onBreak} on break`} tone="warning" />}
              {g.done > 0 && <Badge label={`${g.done} done`} tone="out" />}
            </View>
          </View>
          <DataTable columns={columns} rows={g.rows} keyExtractor={(r) => r.id} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 20 },
  summaryTotal: { fontSize: 13, fontWeight: "700", color: Colors.textMuted, marginLeft: 2 },

  exceptionCard: { backgroundColor: "#FCF3E6", borderWidth: 1, borderColor: Colors.warningDeep, borderRadius: 14, padding: 16, marginBottom: 22 },
  exceptionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  exceptionTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  exceptionCount: { fontSize: 12, fontWeight: "800", color: Colors.warningDeep, textTransform: "uppercase", letterSpacing: 0.4 },
  exceptionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)" },
  exceptionMain: { flex: 1, minWidth: 0 },
  exceptionName: { fontSize: 13.5, fontWeight: "700", color: Colors.textPrimary },
  exceptionReason: { fontSize: 12, color: Colors.warningDeep, marginTop: 1, fontWeight: "600" },
  exceptionBranch: { width: 120, fontSize: 12, color: Colors.textMuted, textAlign: "right" },
  exceptionTime: { width: 84, fontSize: 12, color: Colors.textMuted, textAlign: "right", fontVariant: ["tabular-nums"] },
  exceptionFoot: { fontSize: 11.5, color: Colors.textMuted, marginTop: 10, fontStyle: "italic" },
  branchSection: { marginBottom: 22 },
  branchHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  branchName: { fontSize: 15, fontWeight: "800", color: Colors.textPrimary, flexShrink: 1, letterSpacing: -0.2 },
  branchTallies: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
});
