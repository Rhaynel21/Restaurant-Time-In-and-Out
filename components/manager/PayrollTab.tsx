import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr, formatHours } from "@/lib/dtr";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { inScope } from "@/lib/org";
import { getSchedule } from "@/lib/schedules";

type PayRow = {
  id: string;
  name: string;
  department: string;
  present: number;
  hours: number;
  rate: number;
  gross: number;
};

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function peso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PayrollTab({ allowed }: { allowed: Set<string> | null }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState<PayRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);

  const compute = async () => {
    setError("");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Enter the month as YYYY-MM.");
      return;
    }
    const active = employees.filter((e) => e.status === "active" && inScope(e.branchId, allowed));
    if (active.length === 0) {
      setError("No active employees to compute.");
      return;
    }
    const [y, mo] = month.split("-").map(Number);
    setLoading(true);
    try {
      const result = await Promise.all(
        active.map(async (e) => {
          const [schedule, records] = await Promise.all([
            getSchedule(e.employeeId),
            getAttendanceForMonth(e.employeeId, y, mo - 1),
          ]);
          const dtr = buildDtr(y, mo - 1, schedule, records);
          const rate = e.dailyRate ?? 0;
          const present = dtr.summary.present;
          return {
            id: e.employeeId,
            name: e.fullName,
            department: e.department,
            present,
            hours: dtr.summary.totalMinutes / 60,
            rate,
            gross: rate * present,
          } as PayRow;
        }),
      );
      result.sort((a, b) => a.name.localeCompare(b.name));
      setRows(result);
      setLabel(new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }));
    } catch (e) {
      setError("Failed to compute: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    if (!rows) return { present: 0, hours: 0, gross: 0 };
    return rows.reduce(
      (a, r) => ({ present: a.present + r.present, hours: a.hours + r.hours, gross: a.gross + r.gross }),
      { present: 0, hours: 0, gross: 0 },
    );
  }, [rows]);

  const exportCsv = () => {
    if (!rows || Platform.OS !== "web") return;
    const head = ["Employee ID", "Name", "Department", "Days Present", "Hours", "Daily Rate", "Gross Pay"];
    const lines = [head.join(",")];
    for (const r of rows) {
      lines.push(
        [r.id, r.name, r.department, r.present, r.hours.toFixed(2), r.rate.toFixed(2), r.gross.toFixed(2)]
          .map((v) => {
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Payroll_${label.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <View>
      <SectionTitle>Payroll Run</SectionTitle>
      <Card>
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
          <Pressable style={styles.genBtn} disabled={loading} onPress={compute}>
            <Text style={styles.genText}>{loading ? "Computing…" : "Compute Payroll"}</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, !rows && styles.ghostDisabled]} disabled={!rows} onPress={exportCsv}>
            <Text style={styles.ghostText}>CSV</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          Gross = daily rate × days present, from each active employee&apos;s DTR (hours are net of meal breaks). Set rates in
          the Employees tab.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {rows && (
        <Card>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Payroll · {label}</Text>
            <View style={styles.summary}>
              <Sum value={peso(totals.gross)} label="Total Gross" />
              <Sum value={String(totals.present)} label="Man-days" />
              <Sum value={formatHours(totals.hours * 60)} label="Total Hours" />
            </View>
          </View>

          <View style={[styles.tr, styles.thead]}>
            <Text style={[styles.th, styles.cName]}>Employee</Text>
            <Text style={[styles.th, styles.cNum]}>Days</Text>
            <Text style={[styles.th, styles.cNum]}>Hours</Text>
            <Text style={[styles.th, styles.cMoney]}>Rate</Text>
            <Text style={[styles.th, styles.cMoney]}>Gross</Text>
          </View>
          {rows.map((r) => (
            <View key={r.id} style={styles.tr}>
              <View style={styles.cName}>
                <Text style={styles.rName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.rSub} numberOfLines={1}>{r.id}{r.department ? ` · ${r.department}` : ""}</Text>
              </View>
              <Text style={[styles.td, styles.cNum]}>{r.present}</Text>
              <Text style={[styles.td, styles.cNum]}>{r.hours.toFixed(1)}</Text>
              <Text style={[styles.td, styles.cMoney]}>{r.rate ? peso(r.rate) : "—"}</Text>
              <Text style={[styles.td, styles.cMoney, styles.grossVal]}>{peso(r.gross)}</Text>
            </View>
          ))}
        </Card>
      )}

      {!rows && !loading && (
        <EmptyState icon="cash-multiple" text="Pick a month, then Compute Payroll" />
      )}
    </View>
  );
}

function Sum({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.sumItem}>
      <Text style={styles.sumValue}>{value}</Text>
      <Text style={styles.sumLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 8 },
  controls: { flexDirection: "row", alignItems: "flex-end", gap: 12, flexWrap: "wrap" },
  monthInput: { width: 160, height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary },
  genBtn: { height: 46, paddingHorizontal: 22, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  genText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ghostBtn: { height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  ghostDisabled: { opacity: 0.5 },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 14 },
  hint: { marginTop: 14, fontSize: 12, color: Colors.textFaint, lineHeight: 17 },
  error: { marginTop: 12, color: Colors.danger, fontWeight: "600", fontSize: 13 },

  sheetHead: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16, alignItems: "flex-start" },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  summary: { flexDirection: "row", gap: 20 },
  sumItem: { alignItems: "flex-end" },
  sumValue: { fontSize: 18, fontWeight: "800", color: Colors.textPrimary },
  sumLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: Colors.textFaint },

  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, gap: 6, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  thead: { backgroundColor: Colors.warmSurface, borderRadius: 8, borderBottomWidth: 0, paddingVertical: 9 },
  th: { fontSize: 11, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { fontSize: 13, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  cName: { flex: 1, minWidth: 0 },
  rName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  rSub: { fontSize: 12, color: Colors.textFaint, marginTop: 1 },
  cNum: { width: 56, textAlign: "right" },
  cMoney: { width: 96, textAlign: "right" },
  grossVal: { fontWeight: "800" },
});
