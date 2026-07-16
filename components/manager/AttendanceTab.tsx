import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { Colors } from "@/constants/theme";
import { AttendanceRecord, subscribeAllTodayAttendance } from "@/lib/attendance";
import { inScope } from "@/lib/org";

function fmt(value: Date | null) {
  return value ? value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
}

type BranchGroup = {
  branchId: string;
  branchName: string;
  rows: AttendanceRecord[];
  onShift: number;
  onBreak: number;
  done: number;
};

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
      const onBreak = !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
      const onShift = !r.checkOutAt && !onBreak;
      if (onBreak) g.onBreak += 1;
      else if (onShift) g.onShift += 1;
      else g.done += 1;
    }
    return [...byBranch.values()].sort((a, b) => a.branchName.localeCompare(b.branchName));
  }, [allRows, allowed]);

  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <View>
      <SectionTitle>Today&apos;s Attendance</SectionTitle>
      {totalRows === 0 ? (
        <EmptyState icon="clock-outline" text="No clock-ins yet today" />
      ) : (
        groups.map((g) => (
          <View key={g.branchId} style={styles.branchSection}>
            <View style={styles.branchHead}>
              <Text style={styles.branchName} numberOfLines={1}>{g.branchName}</Text>
              <View style={styles.branchTallies}>
                {g.onShift > 0 && <Badge label={`${g.onShift} on shift`} tone="in" />}
                {g.onBreak > 0 && <Badge label={`${g.onBreak} on break`} tone="warning" />}
                {g.done > 0 && <Badge label={`${g.done} done`} tone="out" />}
              </View>
            </View>
            <Card style={{ padding: 0 }}>
              <View style={[styles.tr, styles.head]}>
                <Text style={[styles.th, styles.cName]}>Employee</Text>
                <Text style={[styles.th, styles.cTime]}>In</Text>
                <Text style={[styles.th, styles.cTime]}>Out</Text>
                <Text style={[styles.th, styles.cStatus]}>Status</Text>
              </View>
              {g.rows.map((r, i) => {
                const onBreak = !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
                const onShift = !r.checkOutAt && !onBreak;
                const status = onBreak ? "On break" : onShift ? "On shift" : "Done";
                const tone = onBreak ? "warning" : onShift ? "in" : "out";
                return (
                  <View key={r.id} style={[styles.tr, i < g.rows.length - 1 && styles.trBorder]}>
                    <Text style={[styles.td, styles.cName]} numberOfLines={1}>{r.employeeName}</Text>
                    <Text style={[styles.td, styles.cTime]}>{fmt(r.checkInAt)}</Text>
                    <Text style={[styles.td, styles.cTime]}>{fmt(r.checkOutAt)}</Text>
                    <View style={styles.cStatus}>
                      <Badge label={status} tone={tone} />
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  branchSection: { marginBottom: 20 },
  branchHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  branchName: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary, flexShrink: 1 },
  branchTallies: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, gap: 8 },
  trBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  head: { backgroundColor: Colors.warmSurface, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  th: { fontSize: 12, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { fontSize: 14, color: Colors.textPrimary },
  cName: { flex: 2, minWidth: 0 },
  cTime: { flex: 1, fontVariant: ["tabular-nums"] },
  cStatus: { flex: 1.2, alignItems: "flex-start" },
});
