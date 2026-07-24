import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Card, EmptyState, SectionTitle, Select } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr } from "@/lib/dtr";
import { DtrLock, isPeriodLocked, subscribeDtrLocks } from "@/lib/dtr-lock";
import { EmployeeMaster, isPayrollExcluded, subscribeEmployeeMasters } from "@/lib/hr";
import { AttendanceRequest, subscribeAllRequests } from "@/lib/attendance-requests";
import { LeaveRequest, subscribeAllLeaves } from "@/lib/leaves";
import { loanBalanceAfter, loanDeductionForMonth } from "@/lib/loans";
import { inScope } from "@/lib/org";
import { PayrollRun, approveRun, releaseRun, reopenRun, subscribePayrollRun } from "@/lib/payroll-run";
import { savePayrollFormula, subscribePayrollFormula } from "@/lib/payroll-settings";
import { DEFAULT_FORMULA, PH_RATES_VERSION, PayBasis, PayFormula, PayInputs, Payslip as PayslipData, computePeriodPayslip, payPeriods, peso } from "@/lib/ph-payroll";
import { getSchedule } from "@/lib/schedules";

type PayRow = {
  id: string;
  name: string;
  department: string;
  branch: string;
  branchId: string;
  tin: string;
  sss: string;
  philhealth: string;
  pagibig: string;
  bankName: string;
  bankAccount: string;
  slip: PayslipData;
};

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = [
  ["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"], ["05", "May"], ["06", "June"],
  ["07", "July"], ["08", "August"], ["09", "September"], ["10", "October"], ["11", "November"], ["12", "December"],
].map(([value, label]) => ({ value, label }));

export function PayrollTab({ allowed, companyId, managerName }: { allowed: Set<string> | null; companyId: string | null; managerName: string }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState<PayRow[] | null>(null);
  // Manually-entered service charge per employee (RA 11360 distribution the POS
  // bridge/PM rule doesn't auto-compute) — a pass-through earning added to net.
  const [scByEmp, setScByEmp] = useState<Record<string, number>>({});
  const scOf = (id: string) => scByEmp[id] || 0;
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<string>("");
  const [showFormulas, setShowFormulas] = useState(false);
  const [formula, setFormula] = useState<PayFormula>(DEFAULT_FORMULA);
  const [draft, setDraft] = useState<PayFormula>(DEFAULT_FORMULA);
  const [savingFormula, setSavingFormula] = useState(false);
  const [formulaMsg, setFormulaMsg] = useState("");

  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [allRequests, setAllRequests] = useState<AttendanceRequest[]>([]);
  const [locks, setLocks] = useState<DtrLock[]>([]);
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeAllLeaves(setAllLeaves, () => setAllLeaves([])), []);
  useEffect(() => subscribeAllRequests(setAllRequests, () => setAllRequests([])), []);
  useEffect(() => subscribeDtrLocks(setLocks, () => setLocks([])), []);
  useEffect(
    () => subscribePayrollFormula(companyId, (f) => { setFormula(f); setDraft(f); }, () => {}),
    [companyId],
  );

  const [yy, mm] = month.split("-");
  const thisYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => String(thisYear - 3 + i)).map((y) => ({ value: y, label: y }));
  const periods = useMemo(() => payPeriods(formula, Number(yy), Number(mm) - 1), [formula, yy, mm]);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const periodOptions = periods.map((p) => ({ value: p.key, label: p.label }));

  // Track the approve→release status for the selected company · month · cutoff.
  useEffect(
    () => subscribePayrollRun(companyId, month, period.key, setRun, () => setRun(null)),
    [companyId, month, period.key],
  );
  const status = run?.status ?? "draft";
  const released = status === "released";

  // Step 5 tie-in: which branches in the computed run haven't had their DTR locked
  // for this month. Payroll should be released only on locked (frozen) attendance.
  const unlockedBranches = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, string>();
    rows.forEach((r) => {
      if (!isPeriodLocked(locks, r.branchId, month)) seen.set(r.branchId || r.branch, r.branch || "—");
    });
    return [...seen.values()];
  }, [rows, locks, month]);
  const allLocked = rows != null && unlockedBranches.length === 0;

  const advanceRun = async (action: "approve" | "release" | "reopen") => {
    setRunBusy(true);
    setError("");
    try {
      if (action === "approve") await approveRun(companyId, month, period.key, managerName);
      else if (action === "release") {
        await releaseRun(companyId, month, period.key, managerName, {
          grossPayroll: totals.gross,
          employerContributions: totals.employer,
        });
      } else await reopenRun(companyId, month, period.key);
    } catch (e) {
      setError("Run update failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setRunBusy(false);
    }
  };

  const compute = async () => {
    setError("");
    setOpenId(null);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Enter the month as YYYY-MM.");
      return;
    }
    // Multi-tenant: only employees within the signed-in user's org scope.
    // Agency Personnel are the agency's payroll responsibility (PM-05) — excluded.
    const active = employees.filter((e) => e.status === "active" && inScope(e.branchId, allowed) && !isPayrollExcluded(e));
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
          const dtr = buildDtr(y, mo - 1, schedule, records, {
            leaves: allLeaves.filter((l) => l.employeeId === e.employeeId && l.status === "approved"),
            requests: allRequests.filter((r) => r.employeeId === e.employeeId && r.status === "approved"),
          });
          const pay: PayBasis = {
            type: e.payType,
            dailyRate: e.dailyRate ?? (e.hourlyRate != null ? e.hourlyRate * 8 : 0),
            hourlyRate: e.hourlyRate ?? (e.dailyRate != null ? e.dailyRate / 8 : 0),
          };
          const inputs: PayInputs = {
            allowanceTaxable: e.allowanceTaxable,
            deMinimis: e.deMinimis,
            otherDeductions: [
              { label: "SSS Loan", amount: e.sssLoan },
              { label: "Pag-IBIG Loan", amount: e.pagibigLoan },
              { label: "Cash Advance", amount: e.cashAdvance },
              ...e.loans.map((l) => ({
                label: `${l.label} · bal ${peso(loanBalanceAfter(l, month))}`,
                amount: loanDeductionForMonth(l, month),
              })),
            ],
          };
          const slip = computePeriodPayslip(dtr, pay, inputs, formula, period);
          return {
            id: e.employeeId,
            name: e.fullName,
            department: e.department,
            branch: e.branchName ?? "",
            branchId: e.branchId ?? "",
            tin: e.tin,
            sss: e.sss,
            philhealth: e.philhealth,
            pagibig: e.pagibig,
            bankName: e.bankName,
            bankAccount: e.bankAccount,
            slip,
          } as PayRow;
        }),
      );
      result.sort((a, b) => a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name));
      setRows(result);
      const monthLabel = new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      setLabel(period.key === "full" ? monthLabel : `${monthLabel} · ${period.label}`);
    } catch (e) {
      setError("Failed to compute: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const saveFormula = async () => {
    if (!companyId) return;
    setSavingFormula(true);
    setFormulaMsg("");
    try {
      await savePayrollFormula(companyId, draft, managerName);
      setFormulaMsg("✓ Formula saved");
    } catch (e) {
      setFormulaMsg("Save failed: " + (e instanceof Error ? e.message : "error"));
    } finally {
      setSavingFormula(false);
    }
  };

  const totals = useMemo(() => {
    const base = { gross: 0, deductions: 0, net: 0, employer: 0, sc: 0 };
    if (!rows) return base;
    return rows.reduce(
      (a, r) => ({
        gross: a.gross + r.slip.grossPay + scOf(r.id),
        deductions: a.deductions + r.slip.totalDeductions,
        net: a.net + r.slip.netPay + scOf(r.id),
        employer: a.employer + r.slip.employerContributions,
        sc: a.sc + scOf(r.id),
      }),
      base,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, scByEmp]);

  const csvDownload = (filename: string, head: string[], records: (string | number)[][]) => {
    if (Platform.OS !== "web") return;
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
  const monthTag = () => label.replace(/\s+/g, "_");

  // Full payroll register — every earning, deduction, and employer share.
  const exportRegister = () => {
    if (!rows) return;
    const head = [
      "Employee ID", "Name", "Branch", "Department", "Pay Days", "Basic Pay",
      "OT Pay", "Night Diff", "Reg Holiday", "Special Holiday", "Allowance", "De-Minimis", "Gross Pay",
      "SSS (EE)", "PhilHealth (EE)", "Pag-IBIG (EE)", "Withholding Tax", "Loans/Advances", "Total Deductions", "Service Charge", "Net Pay",
      "SSS (ER)", "PhilHealth (ER)", "Pag-IBIG (ER)", "Employer Total", "13th Month Accrual",
    ];
    csvDownload(
      `Payroll_Register_${monthTag()}.csv`,
      head,
      rows.map((r) => {
        const s = r.slip;
        return [
          r.id, r.name, r.branch, r.department, s.daysPresent, s.basicPay,
          s.otPay, s.nightPay, s.regHolidayPay, s.specialHolidayPay, s.allowanceTaxable, s.deMinimis, s.grossPay,
          s.sssEE, s.philhealthEE, s.pagibigEE, s.withholdingTax, s.totalOtherDeductions, s.totalDeductions, scOf(r.id), s.netPay + scOf(r.id),
          s.sssER, s.philhealthER, s.pagibigER, s.employerContributions, s.thirteenthMonthAccrual,
        ];
      }),
    );
  };

  // Monthly tax summary (per employee). The official ANNUAL BIR alphalist lives
  // in the Final Pay & 2316 tab (all employees, Jan–Dec, full 1604-C schedule).
  const exportAlphalist = () => {
    if (!rows) return;
    const head = ["TIN", "Employee ID", "Name", "Gross Compensation", "Non-Taxable (contrib + de-minimis)", "Taxable Income", "Tax Withheld"];
    csvDownload(
      `Tax_Summary_${monthTag()}.csv`,
      head,
      rows.map((r) => {
        const s = r.slip;
        return [r.tin, r.id, r.name, s.grossPay, Math.round((s.totalContributions + s.deMinimis) * 100) / 100, s.taxableIncome, s.withholdingTax];
      }),
    );
  };

  // Bank / e-wallet disbursement file — for uploading net pay to the bank.
  const exportBankFile = () => {
    if (!rows) return;
    const head = ["Employee ID", "Name", "Bank / e-wallet", "Account Number", "Net Pay"];
    csvDownload(
      `Bank_File_${monthTag()}.csv`,
      head,
      rows.map((r) => [r.id, r.name, r.bankName, r.bankAccount, r.slip.netPay + scOf(r.id)]),
    );
  };

  // Statutory contribution schedule — feeds SSS R3 / PhilHealth RF1 / Pag-IBIG MCRF.
  const exportContributions = () => {
    if (!rows) return;
    const head = ["Employee ID", "Name", "SSS No.", "SSS (EE)", "SSS (ER)", "PhilHealth No.", "PhilHealth (EE)", "PhilHealth (ER)", "Pag-IBIG No.", "Pag-IBIG (EE)", "Pag-IBIG (ER)"];
    csvDownload(
      `Contributions_${monthTag()}.csv`,
      head,
      rows.map((r) => {
        const s = r.slip;
        return [r.id, r.name, r.sss, s.sssEE, s.sssER, r.philhealth, s.philhealthEE, s.philhealthER, r.pagibig, s.pagibigEE, s.pagibigER];
      }),
    );
  };

  return (
    <View>
      <SectionTitle>Payroll Run</SectionTitle>
      <Card>
        <View style={styles.controls}>
          <View>
            <Text style={styles.label}>Month</Text>
            <Select value={mm} width={150} options={MONTHS} onChange={(v) => setMonth(`${yy}-${v}`)} />
          </View>
          <View>
            <Text style={styles.label}>Year</Text>
            <Select value={yy} width={110} options={yearOptions} onChange={(v) => setMonth(`${v}-${mm}`)} />
          </View>
          {periods.length > 1 && (
            <View>
              <Text style={styles.label}>Period</Text>
              <Select value={period.key} width={200} options={periodOptions} onChange={setPeriodKey} />
            </View>
          )}
          <Button label="Compute Payroll" icon="cog-outline" loading={loading} onPress={compute} />
          {Platform.OS === "web" && (
            <>
              <Button label="Register" variant="ghost" icon="table-arrow-down" disabled={!rows} onPress={exportRegister} />
              <Button label="Tax Summary" variant="ghost" icon="file-certificate-outline" disabled={!rows} onPress={exportAlphalist} />
              <Button label="Contributions" variant="ghost" icon="shield-account-outline" disabled={!rows} onPress={exportContributions} />
              <Button label="Bank File" variant="ghost" icon="bank-outline" disabled={!rows || !released} onPress={exportBankFile} />
            </>
          )}
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

      <Pressable style={[styles.formulaToggle, showFormulas && styles.formulaToggleActive]} onPress={() => setShowFormulas((f) => !f)}>
        <MaterialCommunityIcons name="function-variant" size={16} color={Colors.primary} />
        <Text style={styles.formulaToggleText}>Pay computation formula — view &amp; edit</Text>
        <MaterialCommunityIcons name={showFormulas ? "chevron-up" : "chevron-down"} size={18} color={Colors.primary} />
      </Pressable>
      {showFormulas && (
        <Card>
          <Text style={styles.formulaHead}>Editable DOLE pay premiums</Text>
          <View style={styles.formulaGrid}>
            <FormulaField label="Hours / day" value={draft.hoursPerDay} suffix="hrs" hint="standard workday" onChange={(n) => setDraft({ ...draft, hoursPerDay: n })} />
            <FormulaField label="Overtime premium" value={pct(draft.otPremium)} suffix="%" hint={`= pay ${100 + pct(draft.otPremium)}%`} onChange={(n) => setDraft({ ...draft, otPremium: n / 100 })} />
            <FormulaField label="Night differential" value={pct(draft.nightDiff)} suffix="%" hint={`= +${pct(draft.nightDiff)}% · 10 PM–6 AM`} onChange={(n) => setDraft({ ...draft, nightDiff: n / 100 })} />
            <FormulaField label="Regular holiday premium" value={pct(draft.regHolidayPremium)} suffix="%" hint={`= pay ${100 + pct(draft.regHolidayPremium)}% worked`} onChange={(n) => setDraft({ ...draft, regHolidayPremium: n / 100 })} />
            <FormulaField label="Special holiday premium" value={pct(draft.specialHolidayPremium)} suffix="%" hint={`= pay ${100 + pct(draft.specialHolidayPremium)}% worked`} onChange={(n) => setDraft({ ...draft, specialHolidayPremium: n / 100 })} />
            <FormulaField label="De-minimis cap (₱/mo)" value={draft.deMinimisCap} suffix="₱" hint="0 = no cap · excess is taxable" onChange={(n) => setDraft({ ...draft, deMinimisCap: Math.max(0, n) })} />
          </View>

          <Text style={[styles.formulaHead, { marginTop: 18 }]}>Pay schedule</Text>
          <View style={styles.segRow}>
            {(["monthly", "semimonthly", "weekly"] as const).map((f) => (
              <Pressable key={f} style={[styles.seg, draft.payFrequency === f && styles.segOn]} onPress={() => setDraft({ ...draft, payFrequency: f })}>
                <Text style={[styles.segText, draft.payFrequency === f && styles.segTextOn]}>
                  {f === "semimonthly" ? "Semi-monthly" : f === "weekly" ? "Weekly" : "Monthly"}
                </Text>
              </Pressable>
            ))}
          </View>
          {draft.payFrequency === "semimonthly" && (
            <View style={[styles.formulaGrid, { marginTop: 12 }]}>
              <FormulaField label="Cutoff day (1st period ends)" value={draft.cutoffDay} suffix="day" onChange={(n) => setDraft({ ...draft, cutoffDay: Math.min(28, Math.max(1, Math.round(n))) })} />
              <View style={styles.ff}>
                <Text style={styles.ffLabel}>Deduct SSS / PhilHealth / etc. on</Text>
                <View style={styles.segRow}>
                  {(["second", "split"] as const).map((c) => (
                    <Pressable key={c} style={[styles.seg, draft.contributionOn === c && styles.segOn]} onPress={() => setDraft({ ...draft, contributionOn: c })}>
                      <Text style={[styles.segText, draft.contributionOn === c && styles.segTextOn]}>{c === "second" ? "2nd cutoff" : "Split 50/50"}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          )}
          <Text style={styles.formulaNote}>
            {draft.payFrequency === "weekly"
              ? "Weekly — each week pays that week's worked days; monthly contributions are spread evenly across the month's weeks."
              : draft.payFrequency === "semimonthly"
                ? "Semi-monthly — two cutoffs per month. Earnings follow days worked; deductions apply per the setting above."
                : "Monthly — one payroll run per month."}
          </Text>

          <View style={styles.formulaActions}>
            {formulaMsg ? <Text style={styles.formulaMsg}>{formulaMsg}</Text> : <View style={{ flex: 1 }} />}
            <Button label="Reset to Labor Code" variant="ghost" size="sm" onPress={() => setDraft(DEFAULT_FORMULA)} />
            <Button label={savingFormula ? "Saving…" : "Save formula"} size="sm" disabled={!companyId} loading={savingFormula} onPress={saveFormula} />
          </View>
          {!companyId && <Text style={styles.formulaNote}>Pick a specific company (org scope) to save custom rates.</Text>}

          <Text style={[styles.formulaHead, { marginTop: 18 }]}>Formulas used</Text>
          <FormulaRef label="Basic pay" f="daily rate × days present  ·  or  hourly rate × regular hours" />
          <FormulaRef label="Overtime" f={`OT hours × hourly rate × ${100 + pct(draft.otPremium)}%`} />
          <FormulaRef label="Night differential" f={`night hours × hourly rate × ${pct(draft.nightDiff)}%  (10 PM – 6 AM)`} />
          <FormulaRef label="Regular / special holiday" f={`+${pct(draft.regHolidayPremium)}% / +${pct(draft.specialHolidayPremium)}% of daily rate`} />
          <FormulaRef label="SSS (EE)" f="5% of Monthly Salary Credit — fixed by law" />
          <FormulaRef label="PhilHealth (EE)" f="2.5% of basic salary (₱10k–₱100k) — fixed by law" />
          <FormulaRef label="Pag-IBIG (EE)" f="2% of pay, max ₱200 — fixed by law" />
          <FormulaRef label="Withholding tax" f="BIR TRAIN monthly table on taxable income — fixed by law" />
          <FormulaRef label="Net pay" f="gross − SSS/PhilHealth/Pag-IBIG − tax − loans/advances" />
        </Card>
      )}

      {rows && (
        <>
          <View style={styles.summaryRow}>
            <SummaryTile label="Total Gross" value={peso(totals.gross)} tone="ink" />
            <SummaryTile label="Deductions" value={peso(totals.deductions)} tone="danger" />
            <SummaryTile label="Total Net Pay" value={peso(totals.net)} tone="primary" />
            <SummaryTile label="Employer Share" value={peso(totals.employer)} tone="muted" />
          </View>

          <View style={styles.runBar}>
            <View style={[styles.runStatusChip, status === "released" ? styles.chipReleased : status === "approved" ? styles.chipApproved : styles.chipDraft]}>
              <MaterialCommunityIcons
                name={status === "released" ? "check-decagram" : status === "approved" ? "clipboard-check-outline" : "file-document-edit-outline"}
                size={15}
                color={status === "released" ? Colors.success : status === "approved" ? Colors.primaryDark : Colors.textMuted}
              />
              <Text style={styles.runStatusText}>
                {status === "released" ? "Released" : status === "approved" ? "Approved" : "Draft"}
              </Text>
            </View>
            <View style={styles.runMetaCol}>
              {status === "draft" && !allLocked ? (
                <Text style={styles.runWarn}>
                  <Text style={{ fontWeight: "800" }}>Lock DTR first — </Text>
                  {unlockedBranches.join(", ")} not locked for {month}. Approve is disabled until every branch&apos;s cutoff is locked.
                </Text>
              ) : status === "draft" ? (
                <Text style={styles.runMeta}>All branches locked for {month}. Ready to approve.</Text>
              ) : status === "approved" ? (
                <Text style={styles.runMeta}>Approved by {run?.approvedBy || "—"}. Release to generate the bank file &amp; unlock payslips.</Text>
              ) : (
                <Text style={styles.runMeta}>Released by {run?.releasedBy || "—"}. Bank file &amp; payslips are unlocked.</Text>
              )}
            </View>
            {status === "draft" && (
              <Button label="Approve draft" icon="clipboard-check-outline" size="sm" disabled={!allLocked} loading={runBusy} onPress={() => advanceRun("approve")} />
            )}
            {status === "approved" && (
              <>
                <Button label="Reopen" variant="ghost" size="sm" disabled={runBusy} onPress={() => advanceRun("reopen")} />
                <Button label="Release payroll" icon="bank-transfer-out" size="sm" loading={runBusy} onPress={() => advanceRun("release")} />
              </>
            )}
            {status === "released" && (
              <Button label="Reopen" variant="ghost" size="sm" disabled={runBusy} onPress={() => advanceRun("reopen")} />
            )}
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
                    <Text style={[styles.td, styles.cMoney]}>{peso(r.slip.grossPay + scOf(r.id))}</Text>
                    <Text style={[styles.td, styles.cMoney, styles.dedVal]}>−{peso(r.slip.totalDeductions)}</Text>
                    <Text style={[styles.td, styles.cMoney, styles.netVal]}>{peso(r.slip.netPay + scOf(r.id))}</Text>
                  </Pressable>
                  {open && (
                    <Payslip
                      slip={r.slip}
                      serviceCharge={scOf(r.id)}
                      onServiceCharge={(v) => setScByEmp((m) => ({ ...m, [r.id]: v }))}
                    />
                  )}
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
function Payslip({ slip, serviceCharge, onServiceCharge }: { slip: PayslipData; serviceCharge: number; onServiceCharge: (v: number) => void }) {
  return (
    <View style={styles.payslip}>
      <View style={styles.payslipCols}>
        <View style={styles.payslipCol}>
          <Text style={styles.payslipHead}>Earnings</Text>
          <LineItem
            label="Basic pay"
            detail={slip.payType === "hourly" ? `${slip.regularHours} h × ${peso(slip.hourlyRate)}/hr` : `${slip.daysPresent} days × ${peso(slip.dailyRate)}/day`}
            value={peso(slip.basicPay)}
          />
          {slip.otPay > 0 && <LineItem label="Overtime" detail={`${slip.otHours} h × ${peso(slip.hourlyRate)} × 125%`} value={peso(slip.otPay)} />}
          {slip.nightPay > 0 && <LineItem label="Night differential" detail={`${slip.nightHours} h × ${peso(slip.hourlyRate)} × 10%`} value={peso(slip.nightPay)} />}
          {slip.regHolidayPay > 0 && <LineItem label="Regular holiday" detail="+100% of daily rate" value={peso(slip.regHolidayPay)} />}
          {slip.specialHolidayPay > 0 && <LineItem label="Special holiday" detail="+30% of daily rate" value={peso(slip.specialHolidayPay)} />}
          {slip.leavePay > 0 && <LineItem label="Leave pay" detail={`${slip.paidLeaveDays} paid leave day${slip.paidLeaveDays === 1 ? "" : "s"}`} value={peso(slip.leavePay)} />}
          {slip.allowanceTaxable > 0 && <LineItem label="Taxable allowance" detail="monthly, taxable" value={peso(slip.allowanceTaxable)} />}
          {slip.deMinimis > 0 && <LineItem label="De-minimis" detail="monthly, non-taxable" value={peso(slip.deMinimis)} />}
          {/* Manual service charge — entered by HR (RA 11360 distribution). */}
          <View style={styles.scRow}>
            <View style={styles.lineLabelWrap}>
              <Text style={styles.lineLabel}>Service charge</Text>
              <Text style={styles.lineDetail}>manual entry · added to net</Text>
            </View>
            <View style={styles.scInputWrap}>
              <Text style={styles.scPeso}>₱</Text>
              <TextInput
                style={styles.scInput}
                keyboardType="numeric"
                value={serviceCharge ? String(serviceCharge) : ""}
                placeholder="0"
                placeholderTextColor={Colors.textPlaceholder}
                onChangeText={(t) => {
                  const n = parseFloat(t.replace(/[^0-9.]/g, ""));
                  onServiceCharge(Number.isFinite(n) ? Math.max(0, n) : 0);
                }}
              />
            </View>
          </View>
          <LineItem label="Gross Pay" value={peso(slip.grossPay + serviceCharge)} strong />
        </View>

        <View style={styles.payslipCol}>
          <Text style={styles.payslipHead}>Deductions</Text>
          <LineItem label="SSS" detail="5% employee share of MSC" value={peso(slip.sssEE)} />
          <LineItem label="PhilHealth" detail="2.5% of basic (₱10k–₱100k)" value={peso(slip.philhealthEE)} />
          <LineItem label="Pag-IBIG" detail="2% (max ₱200)" value={peso(slip.pagibigEE)} />
          <LineItem label="Withholding tax" detail={`TRAIN table on ${peso(slip.taxableIncome)}`} value={peso(slip.withholdingTax)} />
          {slip.otherDeductions.map((d) => (
            <LineItem key={d.label} label={d.label} detail="recurring deduction" value={peso(d.amount)} />
          ))}
          <LineItem label="Total Deductions" value={peso(slip.totalDeductions)} strong />
        </View>
      </View>

      <View style={styles.netBar}>
        <Text style={styles.netBarLabel}>NET PAY</Text>
        <Text style={styles.netBarValue}>{peso(slip.netPay + serviceCharge)}</Text>
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

function LineItem({ label, value, detail, strong }: { label: string; value: string; detail?: string; strong?: boolean }) {
  return (
    <View style={[styles.lineItem, strong && styles.lineItemStrong]}>
      <View style={styles.lineLabelWrap}>
        <Text style={[styles.lineLabel, strong && styles.lineLabelStrong]}>{label}</Text>
        {detail ? <Text style={styles.lineDetail}>{detail}</Text> : null}
      </View>
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

const pct = (f: number) => Math.round(f * 100);

function FormulaField({ label, value, suffix, hint, onChange }: { label: string; value: number; suffix?: string; hint?: string; onChange: (n: number) => void }) {
  return (
    <View style={styles.ff}>
      <Text style={styles.ffLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.ffInputRow}>
        <TextInput
          style={styles.ffInput}
          value={String(value)}
          keyboardType="numeric"
          onChangeText={(t) => {
            const n = parseFloat(t.replace(/[^0-9.]/g, ""));
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        {suffix ? <Text style={styles.ffSuffix}>{suffix}</Text> : null}
      </View>
      {/* Always render the hint slot so every field lines up to the same height. */}
      <Text style={styles.ffHint} numberOfLines={1}>{hint || " "}</Text>
    </View>
  );
}

function FormulaRef({ label, f }: { label: string; f: string }) {
  return (
    <View style={styles.formulaRefRow}>
      <Text style={styles.formulaRefLabel}>{label}</Text>
      <Text style={styles.formulaRefText}>{f}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  formulaToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginVertical: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.cardSurface,
  },
  formulaToggleActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryTint },
  formulaToggleText: { fontSize: 13, fontWeight: "700", color: Colors.textBody },
  formulaHead: { fontSize: 12, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  formulaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  ff: { flexGrow: 1, flexBasis: 158 },
  // Fixed label height (fits up to 2 lines) so every input row lines up.
  ffLabel: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 6, minHeight: 32, lineHeight: 15 },
  ffInputRow: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface },
  ffInput: { flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: "700", outlineStyle: "none" } as object,
  ffSuffix: { fontSize: 13, color: Colors.textFaint, fontWeight: "700" },
  ffHint: { fontSize: 11, color: Colors.textFaint, marginTop: 5, minHeight: 15 },
  formulaActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" },
  formulaMsg: { flex: 1, fontSize: 13, fontWeight: "700", color: Colors.success },
  resetBtn: { height: 42, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.cardSurface, alignItems: "center", justifyContent: "center" },
  resetText: { fontSize: 13, fontWeight: "700", color: Colors.textMuted },
  saveFormulaBtn: { height: 42, paddingHorizontal: 20, borderRadius: 10, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  saveFormulaText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  formulaNote: { fontSize: 11, color: Colors.textMuted, marginTop: 10, fontStyle: "italic" },
  formulaRefRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  formulaRefLabel: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  formulaRefText: { fontSize: 12.5, color: Colors.textMuted, marginTop: 2 },
  segRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  seg: { paddingHorizontal: 14, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  segOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segText: { fontSize: 13, fontWeight: "700", color: Colors.textMuted },
  segTextOn: { color: "#fff" },
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

  // Approve → release status bar (Step 7)
  runBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 12,
    marginBottom: 4,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.cardSurface,
  },
  runStatusChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  chipDraft: { backgroundColor: Colors.warmSurface },
  chipApproved: { backgroundColor: Colors.primaryTint },
  chipReleased: { backgroundColor: "#E9F6EE" },
  runStatusText: { fontSize: 12.5, fontWeight: "800", color: Colors.textPrimary, textTransform: "uppercase", letterSpacing: 0.4 },
  runMetaCol: { flex: 1, minWidth: 200 },
  runMeta: { fontSize: 12.5, color: Colors.textMuted, lineHeight: 17 },
  runWarn: { fontSize: 12.5, color: Colors.warningDeep, lineHeight: 17 },

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
  lineItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 5 },
  scRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  scInputWrap: { flexDirection: "row", alignItems: "center", gap: 4, height: 34, minWidth: 96, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.primary, backgroundColor: Colors.cardSurface },
  scPeso: { fontSize: 13, color: Colors.textMuted, fontWeight: "700" },
  scInput: { flex: 1, fontSize: 14, fontWeight: "800", color: Colors.primary, textAlign: "right", fontVariant: ["tabular-nums"], outlineStyle: "none" } as object,
  lineItemStrong: { borderTopWidth: 1, borderTopColor: Colors.warmBorder, marginTop: 4, paddingTop: 7 },
  lineLabelWrap: { flex: 1, paddingRight: 10 },
  lineDetail: { fontSize: 11, color: Colors.textFaint, marginTop: 1 },
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
