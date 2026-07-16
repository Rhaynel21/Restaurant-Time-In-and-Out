import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRequest, subscribeAllRequests } from "@/lib/attendance-requests";
import { getAttendanceForMonth } from "@/lib/attendance";
import { Dtr, buildDtr, formatClock, formatHours, statusLabel } from "@/lib/dtr";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import { LeaveRequest, subscribeAllLeaves } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { getSchedule } from "@/lib/schedules";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DtrTab({ allowed }: { allowed: Set<string> | null }) {
  const [allEmployees, setAllEmployees] = useState<EmployeeSummary[]>([]);
  const employees = allEmployees.filter((e) => inScope(e.branchId, allowed));
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonthValue());
  const [dtr, setDtr] = useState<Dtr | null>(null);
  const [meta, setMeta] = useState<{ emp: EmployeeSummary; label: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [allRequests, setAllRequests] = useState<AttendanceRequest[]>([]);
  useEffect(() => subscribeEmployees(setAllEmployees, () => setAllEmployees([])), []);
  useEffect(() => subscribeAllLeaves(setAllLeaves, () => setAllLeaves([])), []);
  useEffect(() => subscribeAllRequests(setAllRequests, () => setAllRequests([])), []);

  const generate = async () => {
    setError("");
    const emp = employees.find((e) => e.employeeId === employeeId);
    if (!emp) {
      setError("Pick an employee.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Enter the month as YYYY-MM.");
      return;
    }
    const [y, mo] = month.split("-").map(Number);
    setLoading(true);
    try {
      const [schedule, records] = await Promise.all([
        getSchedule(emp.employeeId),
        getAttendanceForMonth(emp.employeeId, y, mo - 1),
      ]);
      setDtr(buildDtr(y, mo - 1, schedule, records, {
        leaves: allLeaves.filter((l) => l.employeeId === emp.employeeId && l.status === "approved"),
        requests: allRequests.filter((r) => r.employeeId === emp.employeeId && r.status === "approved"),
      }));
      const label = new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      setMeta({ emp, label });
    } catch (e) {
      setError("Failed to generate: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!dtr || !meta || Platform.OS !== "web") return;
    const head = ["Date", "Day", "Schedule", "Time In", "Time Out", "Break", "Hours", "OT", "Undertime", "Night Diff", "Late (min)", "Status"];
    const lines = [head.join(",")];
    for (const r of dtr.rows) {
      const cells = [
        String(r.day).padStart(2, "0"),
        r.weekdayShort,
        r.scheduleLabel,
        formatClock(r.timeIn),
        formatClock(r.timeOut),
        r.breakMinutes ? formatHours(r.breakMinutes) : "",
        r.workedMinutes ? formatHours(r.workedMinutes) : "",
        r.otMinutes ? formatHours(r.otMinutes) : "",
        r.underMinutes ? formatHours(r.underMinutes) : "",
        r.nightMinutes ? formatHours(r.nightMinutes) : "",
        r.lateMinutes ? String(r.lateMinutes) : "",
        statusLabel(r),
      ];
      lines.push(cells.map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DTR_${meta.emp.employeeId}_${meta.label.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    if (Platform.OS === "web") window.print();
  };

  return (
    <View>
      <SectionTitle>Daily Time Record</SectionTitle>
      <Card>
        <Text style={styles.label}>Employee</Text>
        <View style={styles.chips}>
          {employees.map((e) => {
            const active = e.employeeId === employeeId;
            return (
              <Pressable
                key={e.employeeId}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setEmployeeId(e.employeeId)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{e.fullName}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.controls}>
          <View>
            <Text style={styles.label}>Month</Text>
            <TextInput
              style={styles.monthInput}
              value={month}
              onChangeText={setMonth}
              placeholder="YYYY-MM"
              placeholderTextColor={Colors.textPlaceholder}
            />
          </View>
          <Pressable style={styles.genBtn} disabled={loading} onPress={generate}>
            <Text style={styles.genText}>{loading ? "Generating…" : "Generate"}</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, !dtr && styles.ghostDisabled]} disabled={!dtr} onPress={print}>
            <Text style={styles.ghostText}>Print / PDF</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, !dtr && styles.ghostDisabled]} disabled={!dtr} onPress={exportCsv}>
            <Text style={styles.ghostText}>CSV</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {dtr && meta && (
        <Card>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Daily Time Record</Text>
              <Text style={styles.sheetMeta}>
                {meta.emp.fullName} · {meta.emp.employeeId}
                {meta.emp.branchName ? ` · ${meta.emp.branchName}` : ""}
              </Text>
              <Text style={styles.sheetMeta}>{meta.label}</Text>
            </View>
            <View style={styles.summary}>
              <Summary value={formatHours(dtr.summary.totalMinutes)} label="Hours" />
              <Summary value={formatHours(dtr.summary.otMinutes)} label="OT" />
              <Summary value={formatHours(dtr.summary.underMinutes)} label="Undertime" />
              <Summary value={formatHours(dtr.summary.nightMinutes)} label="Night Diff" />
              <Summary value={formatHours(dtr.summary.breakMinutes)} label="Break" />
              <Summary value={String(dtr.summary.present)} label="Present" />
              <Summary value={String(dtr.summary.late)} label="Late" />
              <Summary value={String(dtr.summary.absent)} label="Absent" />
            </View>
          </View>

          <View style={[styles.tr, styles.thead]}>
            <Text style={[styles.th, styles.cDate]}>Date</Text>
            <Text style={[styles.th, styles.cSched]}>Schedule</Text>
            <Text style={[styles.th, styles.cTime]}>In</Text>
            <Text style={[styles.th, styles.cTime]}>Out</Text>
            <Text style={[styles.th, styles.cBrk]}>Brk</Text>
            <Text style={[styles.th, styles.cHrs]}>Hrs</Text>
            <Text style={[styles.th, styles.cNum]}>OT</Text>
            <Text style={[styles.th, styles.cNum]}>UT</Text>
            <Text style={[styles.th, styles.cNum]}>ND</Text>
            <Text style={[styles.th, styles.cStatus]}>Status</Text>
          </View>
          {dtr.rows.map((r) => (
            <View key={r.ymd} style={[styles.tr, rowTint(r.status)]}>
              <Text style={[styles.td, styles.cDate]}>{String(r.day).padStart(2, "0")} {r.weekdayShort}</Text>
              <Text style={[styles.td, styles.cSched]}>{r.scheduleLabel}</Text>
              <Text style={[styles.td, styles.cTime]}>{formatClock(r.timeIn)}</Text>
              <Text style={[styles.td, styles.cTime]}>{formatClock(r.timeOut)}</Text>
              <Text style={[styles.td, styles.cBrk]}>{r.breakMinutes ? formatHours(r.breakMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cHrs]}>{r.workedMinutes ? formatHours(r.workedMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cNum, r.otMinutes ? styles.otText : undefined]}>{r.otMinutes ? formatHours(r.otMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cNum, r.underMinutes ? styles.utText : undefined]}>{r.underMinutes ? formatHours(r.underMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cNum, r.nightMinutes ? styles.ndText : undefined]}>{r.nightMinutes ? formatHours(r.nightMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cStatus, statusColor(r.status, r.late)]}>{statusLabel(r)}</Text>
            </View>
          ))}
        </Card>
      )}

      {!dtr && !loading && (
        <EmptyState icon="file-document-outline" text="Pick an employee and month, then Generate" />
      )}
    </View>
  );
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function rowTint(status: string) {
  if (status === "rest") return { backgroundColor: "#FAFDFB" };
  if (status === "holiday") return { backgroundColor: "#FAF7FF" };
  if (status === "leave") return { backgroundColor: "#F5FBF7" };
  return undefined;
}
function statusColor(status: string, late: boolean) {
  if (status === "absent") return { color: Colors.danger };
  if (status === "holiday") return { color: "#7C3AED" };
  if (status === "leave") return { color: Colors.success };
  if (late) return { color: Colors.warningDeep };
  return undefined;
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  chipTextActive: { color: "#fff" },
  controls: { flexDirection: "row", alignItems: "flex-end", gap: 12, flexWrap: "wrap" },
  monthInput: { width: 160, height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary },
  genBtn: { height: 46, paddingHorizontal: 22, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  genText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ghostBtn: { height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  ghostDisabled: { opacity: 0.5 },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 14 },
  error: { marginTop: 12, color: Colors.danger, fontWeight: "600", fontSize: 13 },

  sheetHead: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: Colors.textPrimary },
  sheetMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 3 },
  summary: { flexDirection: "row", gap: 20 },
  summaryItem: { alignItems: "flex-end" },
  summaryValue: { fontSize: 20, fontWeight: "700", color: Colors.textPrimary },
  summaryLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: Colors.textFaint },

  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, gap: 6 },
  thead: { backgroundColor: Colors.warmSurface, borderRadius: 8 },
  th: { fontSize: 11, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { fontSize: 13, color: Colors.textPrimary },
  cDate: { width: 76, fontVariant: ["tabular-nums"] },
  cSched: { flex: 1, minWidth: 0 },
  cTime: { width: 78, fontVariant: ["tabular-nums"] },
  cBrk: { width: 42, fontVariant: ["tabular-nums"], textAlign: "right", color: Colors.textMuted },
  cHrs: { width: 48, fontVariant: ["tabular-nums"], textAlign: "right" },
  cNum: { width: 44, fontVariant: ["tabular-nums"], textAlign: "right", color: Colors.textMuted },
  otText: { color: Colors.primaryDark, fontWeight: "700" },
  utText: { color: Colors.danger, fontWeight: "700" },
  ndText: { color: "#3B5BDB", fontWeight: "700" },
  cStatus: { flex: 1.2, minWidth: 0 },
});
