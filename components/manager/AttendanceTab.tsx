import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { Colors } from "@/constants/theme";
import { AttendanceRecord, subscribeAllTodayAttendance } from "@/lib/attendance";
import { inScope } from "@/lib/org";

function fmt(value: Date | null) {
  return value ? value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
}

export function AttendanceTab({ allowed }: { allowed: Set<string> | null }) {
  const [allRows, setAllRows] = useState<AttendanceRecord[]>([]);
  useEffect(() => subscribeAllTodayAttendance(setAllRows, () => setAllRows([])), []);
  const rows = allRows.filter((r) => inScope(r.branchId, allowed));

  return (
    <View>
      <SectionTitle>Today&apos;s Attendance</SectionTitle>
      {rows.length === 0 ? (
        <EmptyState icon="clock-outline" text="No clock-ins yet today" />
      ) : (
        <Card style={{ padding: 0 }}>
          <View style={[styles.tr, styles.head]}>
            <Text style={[styles.th, styles.cName]}>Employee</Text>
            <Text style={[styles.th, styles.cBranch]}>Branch</Text>
            <Text style={[styles.th, styles.cTime]}>In</Text>
            <Text style={[styles.th, styles.cTime]}>Out</Text>
            <Text style={[styles.th, styles.cStatus]}>Status</Text>
          </View>
          {rows.map((r, i) => {
            const onBreak = !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
            const onShift = !r.checkOutAt && !onBreak;
            const status = onBreak ? "On break" : onShift ? "On shift" : "Done";
            const tone = onBreak ? "warning" : onShift ? "in" : "out";
            return (
              <View key={r.id} style={[styles.tr, i < rows.length - 1 && styles.trBorder]}>
                <Text style={[styles.td, styles.cName]} numberOfLines={1}>{r.employeeName}</Text>
                <Text style={[styles.td, styles.cBranch]} numberOfLines={1}>{r.branchName}</Text>
                <Text style={[styles.td, styles.cTime]}>{fmt(r.checkInAt)}</Text>
                <Text style={[styles.td, styles.cTime]}>{fmt(r.checkOutAt)}</Text>
                <View style={styles.cStatus}>
                  <Badge label={status} tone={tone} />
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, gap: 8 },
  trBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  head: { backgroundColor: Colors.warmSurface, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  th: { fontSize: 12, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { fontSize: 14, color: Colors.textPrimary },
  cName: { flex: 2, minWidth: 0 },
  cBranch: { flex: 2, minWidth: 0, color: Colors.textMuted },
  cTime: { flex: 1, fontVariant: ["tabular-nums"] },
  cStatus: { flex: 1.2, alignItems: "flex-start" },
});
