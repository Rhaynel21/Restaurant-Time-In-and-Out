import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, Select } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr } from "@/lib/dtr";
import { EmployeeMaster, isPayrollExcluded, subscribeEmployeeMasters } from "@/lib/hr";
import { SilBalance, silBalance } from "@/lib/leave-benefits";
import { AttendanceRequest, subscribeAllRequests } from "@/lib/attendance-requests";
import { subscribeAllLeaves, LeaveRequest } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { subscribePayrollFormula } from "@/lib/payroll-settings";
import { DEFAULT_FORMULA, PayBasis, PayFormula, PayInputs, PH_RATES_VERSION, annualWithholdingTax, computePayslip, peso } from "@/lib/ph-payroll";
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
  annualizedTax: number;
  taxAdjustment: number; // + = collect more in December; − = refund to employee
};

export function FinalPayTab({ allowed, companyId }: { allowed: Set<string> | null; companyId: string | null }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [yearText, setYearText] = useState(String(new Date().getFullYear()));
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [alphaBusy, setAlphaBusy] = useState(false);
  const [error, setError] = useState("");

  const [formula, setFormula] = useState<PayFormula>(DEFAULT_FORMULA);
  const [requests, setRequests] = useState<AttendanceRequest[]>([]);

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeAllLeaves(setLeaves, () => setLeaves([])), []);
  useEffect(() => subscribeAllRequests(setRequests, () => setRequests([])), []);
  useEffect(() => subscribePayrollFormula(companyId, setFormula, () => {}), [companyId]);

  const scoped = useMemo(
    () => employees.filter((e) => inScope(e.branchId, allowed) && !isPayrollExcluded(e)).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees, allowed],
  );
  const selected = scoped.find((e) => e.employeeId === selId) ?? null;
  const thisYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => String(thisYear - 3 + i)).map((y) => ({ value: y, label: y }));

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
        const dtr = buildDtr(year, m, schedule, records, {
          leaves: leaves.filter((l) => l.employeeId === selected.employeeId && l.status === "approved"),
          requests: requests.filter((r) => r.employeeId === selected.employeeId && r.status === "approved"),
        });
        const slip = computePayslip(dtr, pay, inputs, formula);
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
      const annualizedTax = annualWithholdingTax(a.taxable);
      const taxAdjustment = round2(annualizedTax - a.tax);
      setResult({ employee: selected, year, annual: a, sil, dailyRate, silCash, prorated13, finalPay, annualizedTax, taxAdjustment });
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

  const printCOE = () => {
    if (!selected || Platform.OS !== "web" || typeof window === "undefined") return;
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) return;
    w.document.write(htmlCOE(selected));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const csvDownload = (filename: string, head: string[], records: (string | number)[][]) => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.map(esc).join(","), ...records.map((r) => r.map(esc).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Annual BIR-schedule alphalist (1604-C style) for ALL scoped employees.
  const exportAnnualAlphalist = async () => {
    if (Platform.OS !== "web") return;
    const year = Number(yearText);
    if (!/^\d{4}$/.test(yearText)) {
      setError("Enter a valid year (YYYY).");
      return;
    }
    if (scoped.length === 0) {
      setError("No employees in scope.");
      return;
    }
    setAlphaBusy(true);
    setError("");
    try {
      const rows: (string | number)[][] = [];
      let seq = 0;
      for (const e of scoped) {
        const pay = payBasisOf(e);
        const inputs = payInputsOf(e);
        const empLeaves = leaves.filter((l) => l.employeeId === e.employeeId && l.status === "approved");
        const empReqs = requests.filter((r) => r.employeeId === e.employeeId && r.status === "approved");
        let gross = 0, basic = 0, deMinimis = 0, sssEE = 0, philEE = 0, pagEE = 0, taxable = 0, tax = 0, months = 0;
        for (let m = 0; m < 12; m += 1) {
          const [schedule, records] = await Promise.all([
            getSchedule(e.employeeId),
            getAttendanceForMonth(e.employeeId, year, m),
          ]);
          if (records.length === 0) continue;
          const slip = computePayslip(buildDtr(year, m, schedule, records, { leaves: empLeaves, requests: empReqs }), pay, inputs, formula);
          if (slip.grossPay <= 0) continue;
          months += 1;
          gross += slip.grossPay;
          basic += slip.basicPay;
          deMinimis += slip.deMinimis;
          sssEE += slip.sssEE;
          philEE += slip.philhealthEE;
          pagEE += slip.pagibigEE;
          taxable += slip.taxableIncome;
          tax += slip.withholdingTax;
        }
        if (months === 0) continue;
        const thirteenth = round2(basic / 12);
        const nonTax13 = Math.min(thirteenth, 90000); // 13th month & other benefits — non-taxable up to ₱90k
        const taxable13 = Math.max(0, round2(thirteenth - 90000));
        const contribs = round2(sssEE + philEE + pagEE);
        const grossComp = round2(gross + thirteenth);
        const totalNonTax = round2(contribs + deMinimis + nonTax13);
        const taxableComp = round2(taxable + taxable13);
        const taxDue = annualWithholdingTax(taxableComp);
        const withheld = round2(tax);
        seq += 1;
        rows.push([
          seq, e.tin, e.lastName, e.firstName, "", e.status === "inactive" ? "T (terminated)" : "R (regular)",
          grossComp,
          nonTax13, deMinimis, sssEE, philEE, pagEE, 0, 0, totalNonTax,
          taxableComp, 0, taxableComp,
          taxDue, withheld, round2(withheld - taxDue),
        ]);
      }
      if (rows.length === 0) {
        setError(`No payroll data found for ${year}.`);
        setAlphaBusy(false);
        return;
      }
      const head = [
        "Seq No.", "TIN", "Last Name", "First Name", "Middle Name", "Employee Status",
        "Gross Compensation Income",
        "13th Month & Other Benefits (max 90k)", "De Minimis", "SSS", "PhilHealth", "Pag-IBIG",
        "Union Dues", "SMW / Holiday / OT / Night-Diff (MWE)", "Total Non-Taxable",
        "Taxable - Present Employer", "Taxable - Previous Employer", "Total Taxable Compensation",
        "Tax Due", "Tax Withheld", "Over / (Under) Withheld",
      ];
      csvDownload(`BIR_Alphalist_1604C_${year}.csv`, head, rows);
    } catch (e) {
      setError("Failed to build alphalist: " + (e instanceof Error ? e.message : "error"));
    } finally {
      setAlphaBusy(false);
    }
  };

  return (
    <View>
      <SectionTitle>Employee</SectionTitle>
      <Card>
        {scoped.length === 0 ? (
          <Text style={styles.muted}>Loading employees…</Text>
        ) : (
          <View style={styles.empBlock}>
            <Text style={styles.label}>Employee</Text>
            <Select
              value={selId}
              searchable
              placeholder="Search & select employee…"
              width={300}
              options={scoped.map((e) => ({
                value: e.employeeId,
                label: e.status === "inactive" ? `${e.fullName} · separated` : e.fullName,
              }))}
              onChange={(v) => {
                setSelId(v);
                setResult(null);
              }}
            />
          </View>
        )}
        <View style={styles.controls}>
          <View>
            <Text style={styles.label}>Year</Text>
            <Select
              value={yearText}
              width={130}
              options={yearOptions}
              onChange={(v) => {
                setYearText(v);
                setResult(null);
              }}
            />
          </View>
          <Pressable style={styles.genBtn} disabled={loading} onPress={compute}>
            <Text style={styles.genText}>{loading ? "Computing…" : "Compute Final Pay"}</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, !result && styles.ghostDisabled]} disabled={!result} onPress={print2316}>
            <MaterialCommunityIcons name="printer-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.ghostText}>Print BIR 2316</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, !selected && styles.ghostDisabled]} disabled={!selected} onPress={printCOE}>
            <MaterialCommunityIcons name="file-document-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.ghostText}>Print COE</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, (scoped.length === 0 || alphaBusy) && styles.ghostDisabled]} disabled={scoped.length === 0 || alphaBusy} onPress={exportAnnualAlphalist}>
            <MaterialCommunityIcons name="table-large" size={16} color={Colors.primaryDark} />
            <Text style={styles.ghostText}>{alphaBusy ? "Building…" : "Annual Alphalist"}</Text>
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
            <Line label="Tax withheld (Jan–Dec)" value={peso(result.annual.tax)} />
            <Line label="Annualized tax due" value={peso(result.annualizedTax)} />
            <Line
              label={result.taxAdjustment >= 0 ? "Year-end tax payable (collect in Dec)" : "Year-end tax refund to employee"}
              value={peso(Math.abs(result.taxAdjustment))}
              strong
            />
            <Text style={styles.note}>Statutory rates as of {PH_RATES_VERSION}. Year-end tax = annualized tax on total taxable income less tax already withheld; verify with your accountant before the December run / 2316 filing.</Text>
          </Card>
        </>
      )}

      {!result && !loading && <EmptyState icon="account-cash-outline" text="Pick an employee and year, then Compute Final Pay" />}
    </View>
  );
}

// Printable Certificate of Employment.
function htmlCOE(e: EmployeeMaster): string {
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const hire = e.hireDate ? new Date(e.hireDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
  const status = e.status === "inactive" ? "was employed" : "is employed";
  const untilClause = e.status === "inactive" ? "" : " up to the present";
  return `<!doctype html><html><head><meta charset="utf-8"><title>COE - ${e.fullName}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:56px;font-size:14px;line-height:1.9}
  .head{text-align:center;margin-bottom:32px}
  .company{font-size:20px;font-weight:700;letter-spacing:1px}
  .tag{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#555;margin-top:4px}
  h1{font-size:17px;text-align:center;letter-spacing:2px;text-transform:uppercase;margin:28px 0 24px}
  p{margin:0 0 16px;text-align:justify}
  .name{font-weight:700}
  .sign{margin-top:64px}
  .sign .line{border-top:1px solid #111;width:260px;padding-top:6px;font-size:12px}
  .foot{margin-top:40px;font-size:11px;color:#666}
</style></head><body>
  <div class="head">
    <div class="company">Qui &middot; Pan-Asian Brasserie</div>
    <div class="tag">Human Resources Department</div>
  </div>
  <h1>Certificate of Employment</h1>
  <p>To whom it may concern:</p>
  <p>This is to certify that <span class="name">${e.fullName}</span> ${status} at Qui &middot; Pan-Asian Brasserie as
  <span class="name">${e.position || "Staff"}</span>${e.branchName ? ` at ${e.branchName}` : ""}, from
  <span class="name">${hire}</span>${untilClause}.</p>
  <p>This certification is issued upon the request of the above-named employee for whatever legal purpose it may serve.</p>
  <p>Issued this ${today}.</p>
  <div class="sign"><div class="line">Authorized Representative<br/>Human Resources</div></div>
  <div class="foot">This is a system-generated certificate.</div>
</body></html>`;
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
    ${row("Tax due (annualized)", peso(r.annualizedTax))}
    ${row("Tax withheld (Jan–Dec)", peso(r.annual.tax))}
    <tr class="total"><td>${r.taxAdjustment >= 0 ? "Tax still due (collect)" : "Tax refund to employee"}</td><td class="num">${peso(Math.abs(r.taxAdjustment))}</td></tr>
  </table></div>

  <div class="foot">This certificate is a system-generated estimate based on ${r.annual.months} month(s) of recorded payroll and
  statutory rates as of ${PH_RATES_VERSION}. It is not a substitute for the official BIR-issued Form 2316 and must be
  reconciled (annualized withholding, non-taxable ceilings, 13th-month exemption up to ₱90,000) before filing.</div>

  <div class="sign"><div>Employee signature over printed name / date</div><div>Authorized employer representative / date</div></div>
</body></html>`;
}

const styles = StyleSheet.create({
  muted: { color: Colors.textFaint, fontSize: 13 },
  empBlock: { marginBottom: 14 },

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
