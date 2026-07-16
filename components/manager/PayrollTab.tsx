import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr } from "@/lib/dtr";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { inScope } from "@/lib/org";
import { PH_RATES_VERSION, Payslip as PayslipData, computePayslip, peso } from "@/lib/ph-payroll";
import { getSchedule } from "@/lib/schedules";

type PayRow = {
  id: string;
  name: string;
  department: string;
  branch: string;
  slip: PayslipData;
};

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function PayrollTab({ allowed }: { allowed: Set<string> | null }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState<PayRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);

  const compute = async () => {
    setError("");
    setOpenId(null);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Enter the month as YYYY-MM.");
      return;
    }
    // Multi-tenant: only employees within the signed-in user's org scope.
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
          const slip = computePayslip(dtr, e.dailyRate ?? 0);
          return {
            id: e.employeeId,
            name: e.fullName,
            department: e.department,
            branch: e.branchName ?? "",
            slip,
          } as PayRow;
        }),
      );
      result.sort((a, b) => a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name));
      setRows(result);
      setLabel(new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }));
    } catch (e) {
      setError("Failed to compute: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    const base = { gross: 0, deductions: 0, net: 0, employer: 0 };
    if (!rows) return base;
    return rows.reduce(
      (a, r) => ({
        gross: a.gross + r.slip.grossPay,
        deductions: a.deductions + r.slip.totalDeductions,
        net: a.net + r.slip.netPay,
        employer: a.employer + r.slip.employerContributions,
      }),
      base,
    );
  }, [rows]);

  const exportCsv = () => {
    if (!rows || Platform.OS !== "web") return;
    const head = [
      "Employee ID", "Name", "Branch", "Department", "Days", "Hourly Rate", "Basic Pay",
      "OT Hrs", "OT Pay", "Night Hrs", "Night Diff", "Reg Holiday", "Special Holiday", "Gross Pay",
      "SSS (EE)", "PhilHealth (EE)", "Pag-IBIG (EE)", "Total Contributions", "Taxable Income",
      "Withholding Tax", "Total Deductions", "Net Pay",
      "SSS (ER)", "PhilHealth (ER)", "Pag-IBIG (ER)", "Employer Total", "13th Month Accrual",
    ];
    const lines = [head.join(",")];
    for (const r of rows) {
      const s = r.slip;
      lines.push(
        [
          r.id, r.name, r.branch, r.department, s.daysPresent, s.hourlyRate, s.basicPay,
          s.otHours, s.otPay, s.nightHours, s.nightPay, s.regHolidayPay, s.specialHolidayPay, s.grossPay,
          s.sssEE, s.philhealthEE, s.pagibigEE, s.totalContributions, s.taxableIncome,
          s.withholdingTax, s.totalDeductions, s.netPay,
          s.sssER, s.philhealthER, s.pagibigER, s.employerContributions, s.thirteenthMonthAccrual,
        ]
          .map((v) => {
            const str = String(v);
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Payroll_Register_${label.replace(/\s+/g, "_")}.csv`;
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
            <MaterialCommunityIcons name="file-delimited-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.ghostText}>CSV</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          DOLE-based pay (basic + overtime, night differential, and holiday premiums from each employee&apos;s DTR) less
          BIR withholding tax and SSS / PhilHealth / Pag-IBIG contributions → net pay. Set daily rates in the Employees tab.
        </Text>
        <View style={styles.disclaimer}>
          <MaterialCommunityIcons name="information-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.disclaimerText}>
            Statutory rates as of {PH_RATES_VERSION}. For computation only — verify against the latest SSS / PhilHealth /
            HDMF and BIR issuances before filing or paying.
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {rows && (
        <>
          <View style={styles.summaryRow}>
            <SummaryTile label="Total Gross" value={peso(totals.gross)} tone="ink" />
            <SummaryTile label="Deductions" value={peso(totals.deductions)} tone="danger" />
            <SummaryTile label="Total Net Pay" value={peso(totals.net)} tone="primary" />
            <SummaryTile label="Employer Share" value={peso(totals.employer)} tone="muted" />
          </View>

          <Card>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Payroll Register · {label}</Text>
              <Text style={styles.sheetSub}>{rows.length} employee{rows.length === 1 ? "" : "s"} · tap a row for the payslip</Text>
            </View>

            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, styles.cName]}>Employee</Text>
              <Text style={[styles.th, styles.cNum]}>Days</Text>
              <Text style={[styles.th, styles.cMoney]}>Gross</Text>
              <Text style={[styles.th, styles.cMoney]}>Deductions</Text>
              <Text style={[styles.th, styles.cMoney]}>Net Pay</Text>
            </View>

            {rows.map((r) => {
              const open = openId === r.id;
              return (
                <View key={r.id}>
                  <Pressable style={styles.tr} onPress={() => setOpenId(open ? null : r.id)}>
                    <View style={styles.cName}>
                      <Text style={styles.rName} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.rSub} numberOfLines={1}>
                        {r.id}{r.branch ? ` · ${r.branch}` : ""}{r.department ? ` · ${r.department}` : ""}
                      </Text>
                    </View>
                    <Text style={[styles.td, styles.cNum]}>{r.slip.daysPresent}</Text>
                    <Text style={[styles.td, styles.cMoney]}>{peso(r.slip.grossPay)}</Text>
                    <Text style={[styles.td, styles.cMoney, styles.dedVal]}>−{peso(r.slip.totalDeductions)}</Text>
                    <Text style={[styles.td, styles.cMoney, styles.netVal]}>{peso(r.slip.netPay)}</Text>
                  </Pressable>
                  {open && <Payslip slip={r.slip} />}
                </View>
              );
            })}
          </Card>
        </>
      )}

      {!rows && !loading && <EmptyState icon="cash-multiple" text="Pick a month, then Compute Payroll" />}
    </View>
  );
}

// ── Expanded per-employee payslip ────────────────────────────────────────────
function Payslip({ slip }: { slip: PayslipData }) {
  return (
    <View style={styles.payslip}>
      <View style={styles.payslipCols}>
        <View style={styles.payslipCol}>
          <Text style={styles.payslipHead}>Earnings</Text>
          <LineItem label={`Basic (${slip.daysPresent} days)`} value={peso(slip.basicPay)} />
          {slip.otPay > 0 && <LineItem label={`Overtime (${slip.otHours} h)`} value={peso(slip.otPay)} />}
          {slip.nightPay > 0 && <LineItem label={`Night differential (${slip.nightHours} h)`} value={peso(slip.nightPay)} />}
          {slip.regHolidayPay > 0 && <LineItem label="Regular holiday" value={peso(slip.regHolidayPay)} />}
          {slip.specialHolidayPay > 0 && <LineItem label="Special holiday" value={peso(slip.specialHolidayPay)} />}
          <LineItem label="Gross Pay" value={peso(slip.grossPay)} strong />
        </View>

        <View style={styles.payslipCol}>
          <Text style={styles.payslipHead}>Deductions</Text>
          <LineItem label="SSS" value={peso(slip.sssEE)} />
          <LineItem label="PhilHealth" value={peso(slip.philhealthEE)} />
          <LineItem label="Pag-IBIG" value={peso(slip.pagibigEE)} />
          <LineItem label="Withholding tax" value={peso(slip.withholdingTax)} />
          <LineItem label="Total Deductions" value={peso(slip.totalDeductions)} strong />
        </View>
      </View>

      <View style={styles.netBar}>
        <Text style={styles.netBarLabel}>NET PAY</Text>
        <Text style={styles.netBarValue}>{peso(slip.netPay)}</Text>
      </View>

      <View style={styles.employerNote}>
        <Text style={styles.employerHead}>Employer share (not deducted from employee)</Text>
        <View style={styles.employerGrid}>
          <MiniStat label="SSS (ER)" value={peso(slip.sssER)} />
          <MiniStat label="PhilHealth (ER)" value={peso(slip.philhealthER)} />
          <MiniStat label="Pag-IBIG (ER)" value={peso(slip.pagibigER)} />
          <MiniStat label="13th-month accrual" value={peso(slip.thirteenthMonthAccrual)} />
        </View>
      </View>
    </View>
  );
}

function LineItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.lineItem, strong && styles.lineItemStrong]}>
      <Text style={[styles.lineLabel, strong && styles.lineLabelStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineValueStrong]}>{value}</Text>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: "ink" | "primary" | "danger" | "muted" }) {
  const color =
    tone === "primary" ? Colors.primary : tone === "danger" ? Colors.danger : tone === "muted" ? Colors.textMuted : Colors.textPrimary;
  return (
    <View style={styles.summaryTile}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 8 },
  controls: { flexDirection: "row", alignItems: "flex-end", gap: 12, flexWrap: "wrap" },
  monthInput: { width: 160, height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary } as object,
  genBtn: { height: 46, paddingHorizontal: 22, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  genText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, justifyContent: "center" },
  ghostDisabled: { opacity: 0.5 },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 14 },
  hint: { marginTop: 14, fontSize: 12, color: Colors.textFaint, lineHeight: 17 },
  disclaimer: { flexDirection: "row", gap: 6, marginTop: 10, alignItems: "flex-start" },
  disclaimerText: { flex: 1, fontSize: 11, color: Colors.textMuted, lineHeight: 15, fontStyle: "italic" },
  error: { marginTop: 12, color: Colors.danger, fontWeight: "600", fontSize: 13 },

  // Summary tiles
  summaryRow: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 16, marginBottom: 4 },
  summaryTile: { flexGrow: 1, flexBasis: 150, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.hairline, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  summaryValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  summaryLabel: { marginTop: 3, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: Colors.textFaint, fontWeight: "600" },

  sheetHead: { marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  sheetSub: { fontSize: 12, color: Colors.textFaint, marginTop: 2 },

  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 11, gap: 6, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  thead: { backgroundColor: Colors.warmSurface, borderRadius: 8, borderBottomWidth: 0, paddingVertical: 9 },
  th: { fontSize: 11, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { fontSize: 13, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  cName: { flex: 1, minWidth: 0 },
  rName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  rSub: { fontSize: 12, color: Colors.textFaint, marginTop: 1 },
  cNum: { width: 48, textAlign: "right" },
  cMoney: { width: 108, textAlign: "right" },
  dedVal: { color: Colors.danger },
  netVal: { fontWeight: "800", color: Colors.primary },

  // Payslip
  payslip: { backgroundColor: Colors.warmSurface, borderRadius: 12, padding: 14, marginTop: 2, marginBottom: 8 },
  payslipCols: { flexDirection: "row", gap: 20, flexWrap: "wrap" },
  payslipCol: { flexGrow: 1, flexBasis: 220 },
  payslipHead: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, color: Colors.textSubtle, marginBottom: 8 },
  lineItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  lineItemStrong: { borderTopWidth: 1, borderTopColor: Colors.warmBorder, marginTop: 4, paddingTop: 7 },
  lineLabel: { fontSize: 13, color: Colors.textBody },
  lineLabelStrong: { fontWeight: "800", color: Colors.textPrimary },
  lineValue: { fontSize: 13, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  lineValueStrong: { fontWeight: "800" },

  netBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, marginTop: 14 },
  netBarLabel: { color: Colors.textOnDark, fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  netBarValue: { color: Colors.textOnDark, fontWeight: "800", fontSize: 18, fontVariant: ["tabular-nums"] },

  employerNote: { marginTop: 14 },
  employerHead: { fontSize: 11, fontWeight: "700", color: Colors.textFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  employerGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  miniStat: { flexGrow: 1, flexBasis: 120, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.hairline, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  miniValue: { fontSize: 14, fontWeight: "800", color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  miniLabel: { fontSize: 10, color: Colors.textFaint, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 },
});
