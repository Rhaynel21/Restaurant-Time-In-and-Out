import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr } from "@/lib/dtr";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { SilBalance, silBalance } from "@/lib/leave-benefits";
import { subscribeAllLeaves, LeaveRequest } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { PayBasis, PayInputs, PH_RATES_VERSION, computePayslip, peso } from "@/lib/ph-payroll";
import { getSchedule } from "@/lib/schedules";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function payBasisOf(e: EmployeeMaster): PayBasis {
  return {
    type: e.payType,
    dailyRate: e.dailyRate ?? (e.hourlyRate != null ? e.hourlyRate * 8 : 0),
    hourlyRate: e.hourlyRate ?? (e.dailyRate != null ? e.dailyRate / 8 : 0),
  };
}
function payInputsOf(e: EmployeeMaster): PayInputs {
  return {
    allowanceTaxable: e.allowanceTaxable,
    deMinimis: e.deMinimis,
    otherDeductions: [
      { label: "SSS Loan", amount: e.sssLoan },
      { label: "Pag-IBIG Loan", amount: e.pagibigLoan },
      { label: "Cash Advance", amount: e.cashAdvance },
    ],
  };
}

type Annual = {
  months: number;
  gross: number;
  basic: number;
  deMinimis: number;
  sssEE: number;
  philhealthEE: number;
  pagibigEE: number;
  contributions: number;
  taxable: number;
  tax: number;
  lastNet: number;
  lastMonth: string;
};
type Result = {
  employee: EmployeeMaster;
  year: number;
  annual: Annual;
  sil: SilBalance;
  dailyRate: number;
  silCash: number;
  prorated13: number;
  finalPay: number;
};

export function FinalPayTab({ allowed }: { allowed: Set<string> | null }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [yearText, setYearText] = useState(String(new Date().getFullYear()));
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeAllLeaves(setLeaves, () => setLeaves([])), []);

  const scoped = useMemo(
    () => employees.filter((e) => inScope(e.branchId, allowed)).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees, allowed],
  );
  const selected = scoped.find((e) => e.employeeId === selId) ?? null;

  const compute = async () => {
    setError("");
    setResult(null);
    if (!selected) {
      setError("Pick an employee first.");
      return;
    }
    const year = Number(yearText);
    if (!/^\d{4}$/.test(yearText) || year < 2000) {
      setError("Enter a valid year (YYYY).");
      return;
    }
    setLoading(true);
    try {
      const pay = payBasisOf(selected);
      const inputs = payInputsOf(selected);
      const a: Annual = {
        months: 0, gross: 0, basic: 0, deMinimis: 0, sssEE: 0, philhealthEE: 0, pagibigEE: 0,
        contributions: 0, taxable: 0, tax: 0, lastNet: 0, lastMonth: "—",
      };
      for (let m = 0; m < 12; m += 1) {
        const [schedule, records] = await Promise.all([
          getSchedule(selected.employeeId),
          getAttendanceForMonth(selected.employeeId, year, m),
        ]);
        if (records.length === 0) continue;
        const slip = computePayslip(buildDtr(year, m, schedule, records), pay, inputs);
        if (slip.grossPay <= 0) continue;
        a.months += 1;
        a.gross += slip.grossPay;
        a.basic += slip.basicPay;
        a.deMinimis += slip.deMinimis;
        a.sssEE += slip.sssEE;
        a.philhealthEE += slip.philhealthEE;
        a.pagibigEE += slip.pagibigEE;
        a.contributions += slip.totalContributions;
        a.taxable += slip.taxableIncome;
        a.tax += slip.withholdingTax;
        a.lastNet = slip.netPay;
        a.lastMonth = new Date(year, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }
      for (const k of ["gross", "basic", "deMinimis", "sssEE", "philhealthEE", "pagibigEE", "contributions", "taxable", "tax"] as const) {
        a[k] = round2(a[k]);
      }
      if (a.months === 0) {
        setError(`No payroll data found for ${selected.fullName} in ${year}.`);
        setLoading(false);
        return;
      }
      const sil = silBalance(selected.hireDate, leaves, selected.employeeId, year);
      const dailyRate = pay.type === "daily" ? pay.dailyRate : round2(pay.hourlyRate * 8);
      const silCash = round2(sil.remaining * dailyRate);
      const prorated13 = round2(a.basic / 12);
      const finalPay = round2(a.lastNet + prorated13 + silCash);
      setResult({ employee: selected, year, annual: a, sil, dailyRate, silCash, prorated13, finalPay });
    } catch (e) {
      setError("Failed to compute: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const print2316 = () => {
    if (!result || Platform.OS !== "web" || typeof window === "undefined") return;
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) return;
    w.document.write(html2316(result));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <View>
      <SectionTitle>Employee</SectionTitle>
      <Card>
        {scoped.length === 0 ? (
          <Text style={styles.muted}>Loading employees…</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {scoped.map((e) => {
              const active = e.employeeId === selId;
              return (
                <Pressable key={e.employeeId} style={[styles.chip, active && styles.chipOn]} onPress={() => { setSelId(e.employeeId); setResult(null); }}>
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>{e.fullName}</Text>
                  <Text style={[styles.chipSub, active && styles.chipTextOn]}>{e.status === "inactive" ? "separated" : e.branchName ?? ""}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <View style={styles.controls}>
          <View>
            <Text style={styles.label}>Year</Text>
            <TextInput style={styles.yearInput} value={yearText} onChangeText={setYearText} placeholder="2026" keyboardType="numeric" placeholderTextColor={Colors.textPlaceholder} />
          </View>
          <Pressable style={styles.genBtn} disabled={loading} onPress={compute}>
            <Text style={styles.genText}>{loading ? "Computing…" : "Compute Final Pay"}</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, !result && styles.ghostDisabled]} disabled={!result} onPress={print2316}>
            <MaterialCommunityIcons name="printer-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.ghostText}>Print BIR 2316</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          Runs the whole year&apos;s payroll for one employee: the annual compensation totals drive BIR Form 2316, and the
          final-pay estimate combines the last period&apos;s net pay, pro-rated 13th-month pay, and SIL cash conversion.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {result && (
        <>
          <SectionTitle>Final Pay · {result.employee.fullName} · {result.year}</SectionTitle>
          <Card>
            <Line label={`Last period net pay (${result.annual.lastMonth})`} value={peso(result.annual.lastNet)} />
            <Line label="Pro-rated 13th-month pay (annual basic ÷ 12)" value={peso(result.prorated13)} />
            <Line label={`SIL cash conversion (${result.sil.remaining} day${result.sil.remaining === 1 ? "" : "s"} × ${peso(result.dailyRate)})`} value={peso(result.silCash)} />
            <View style={styles.finalBar}>
              <Text style={styles.finalLabel}>ESTIMATED FINAL PAY</Text>
              <Text style={styles.finalValue}>{peso(result.finalPay)}</Text>
            </View>
            <Text style={styles.note}>
              Estimate only. Outstanding loan balances, tax adjustment (annualized withholding), and company-specific
              separation benefits are not included — settle those before release.
            </Text>
          </Card>

          <SectionTitle>Annual Compensation ({result.annual.months} mo with payroll)</SectionTitle>
          <Card>
            <Line label="Gross compensation" value={peso(result.annual.gross)} />
            <Line label="SSS (employee)" value={peso(result.annual.sssEE)} />
            <Line label="PhilHealth (employee)" value={peso(result.annual.philhealthEE)} />
            <Line label="Pag-IBIG (employee)" value={peso(result.annual.pagibigEE)} />
            <Line label="De-minimis / non-taxable" value={peso(result.annual.deMinimis)} />
            <Line label="Taxable compensation" value={peso(result.annual.taxable)} />
            <Line label="Tax withheld" value={peso(result.annual.tax)} strong />
            <Text style={styles.note}>Statutory rates as of {PH_RATES_VERSION}. Verify the annualized tax and 2316 figures with your accountant before filing.</Text>
          </Card>
        </>
      )}

      {!result && !loading && <EmptyState icon="account-cash-outline" text="Pick an employee and year, then Compute Final Pay" />}
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.line, strong && styles.lineStrong]}>
      <Text style={[styles.lineLabel, strong && styles.lineLabelStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineValueStrong]}>{value}</Text>
    </View>
  );
}

// Printable BIR Form 2316-style certificate (self-contained HTML).
function html2316(r: Result): string {
  const e = r.employee;
  const row = (a: string, b: string) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>BIR 2316 - ${e.fullName} - ${r.year}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:12px}
  h1{font-size:16px;margin:0}
  .sub{color:#555;font-size:11px;margin:2px 0 16px}
  .box{border:1px solid #999;border-radius:6px;padding:12px 14px;margin-bottom:12px}
  .box h2{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#374151;margin:0 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  table{width:100%;border-collapse:collapse}
  td{padding:4px 2px;vertical-align:top}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .g{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}
  .k{color:#555}.v{font-weight:600}
  .total td{border-top:2px solid #111;font-weight:700}
  .foot{margin-top:20px;color:#555;font-size:10px;line-height:1.5}
  .sign{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
  .sign div{border-top:1px solid #111;padding-top:4px;font-size:10px;color:#555}
</style></head><body>
  <h1>Certificate of Compensation Payment / Tax Withheld</h1>
  <div class="sub">BIR Form No. 2316 — For the Year ${r.year} (computed estimate — verify before filing)</div>

  <div class="box"><h2>Employee</h2><div class="g">
    <div><span class="k">Name:</span> <span class="v">${e.fullName}</span></div>
    <div><span class="k">TIN:</span> <span class="v">${e.tin || "—"}</span></div>
    <div><span class="k">Employee ID:</span> <span class="v">${e.employeeId}</span></div>
    <div><span class="k">Position:</span> <span class="v">${e.position || "—"}</span></div>
    <div style="grid-column:1/3"><span class="k">Address:</span> <span class="v">${e.address || "—"}</span></div>
    <div><span class="k">SSS:</span> <span class="v">${e.sss || "—"}</span></div>
    <div><span class="k">PhilHealth:</span> <span class="v">${e.philhealth || "—"}</span></div>
    <div><span class="k">Pag-IBIG:</span> <span class="v">${e.pagibig || "—"}</span></div>
    <div><span class="k">Branch:</span> <span class="v">${e.branchName || "—"}</span></div>
  </div></div>

  <div class="box"><h2>Employer</h2><div class="g">
    <div><span class="k">Registered Name:</span> <span class="v">Qui · Pan-Asian Brasserie</span></div>
    <div><span class="k">TIN:</span> <span class="v">___-___-___-___</span></div>
  </div></div>

  <div class="box"><h2>Summary of Compensation & Tax Withheld</h2>
  <table>
    ${row("Gross compensation income", peso(r.annual.gross))}
    ${row("Less: SSS contributions (employee)", peso(r.annual.sssEE))}
    ${row("Less: PhilHealth contributions (employee)", peso(r.annual.philhealthEE))}
    ${row("Less: Pag-IBIG contributions (employee)", peso(r.annual.pagibigEE))}
    ${row("Less: De-minimis / non-taxable benefits", peso(r.annual.deMinimis))}
    <tr class="total"><td>Taxable compensation income</td><td class="num">${peso(r.annual.taxable)}</td></tr>
    <tr class="total"><td>Total tax withheld</td><td class="num">${peso(r.annual.tax)}</td></tr>
  </table></div>

  <div class="foot">This certificate is a system-generated estimate based on ${r.annual.months} month(s) of recorded payroll and
  statutory rates as of ${PH_RATES_VERSION}. It is not a substitute for the official BIR-issued Form 2316 and must be
  reconciled (annualized withholding, non-taxable ceilings, 13th-month exemption up to ₱90,000) before filing.</div>

  <div class="sign"><div>Employee signature over printed name / date</div><div>Authorized employer representative / date</div></div>
</body></html>`;
}

const styles = StyleSheet.create({
  muted: { color: Colors.textFaint, fontSize: 13 },
  chips: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder, minWidth: 120 },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  chipSub: { fontSize: 11, color: Colors.textFaint, marginTop: 1 },
  chipTextOn: { color: "#fff" },

  controls: { flexDirection: "row", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginTop: 14 },
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 8 },
  yearInput: { width: 110, height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary } as object,
  genBtn: { height: 46, paddingHorizontal: 22, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  genText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, justifyContent: "center" },
  ghostDisabled: { opacity: 0.5 },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 14 },
  hint: { marginTop: 14, fontSize: 12, color: Colors.textFaint, lineHeight: 17 },
  error: { marginTop: 12, color: Colors.danger, fontWeight: "600", fontSize: 13 },

  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  lineStrong: { borderBottomWidth: 0 },
  lineLabel: { fontSize: 13, color: Colors.textBody, flex: 1, paddingRight: 12 },
  lineLabelStrong: { fontWeight: "800", color: Colors.textPrimary },
  lineValue: { fontSize: 13, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  lineValueStrong: { fontWeight: "800" },

  finalBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, marginTop: 12 },
  finalLabel: { color: Colors.textOnDark, fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  finalValue: { color: Colors.textOnDark, fontWeight: "800", fontSize: 18, fontVariant: ["tabular-nums"] },
  note: { marginTop: 12, fontSize: 11, color: Colors.textMuted, lineHeight: 15, fontStyle: "italic" },
});
