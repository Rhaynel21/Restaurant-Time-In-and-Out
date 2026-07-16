import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, SectionTitle, Select } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr } from "@/lib/dtr";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { inScope } from "@/lib/org";
import { savePayrollFormula, subscribePayrollFormula } from "@/lib/payroll-settings";
import { DEFAULT_FORMULA, PH_RATES_VERSION, PayBasis, PayFormula, PayInputs, Payslip as PayslipData, computePeriodPayslip, payPeriods, peso } from "@/lib/ph-payroll";
import { getSchedule } from "@/lib/schedules";

type PayRow = {
  id: string;
  name: string;
  department: string;
  branch: string;
  tin: string;
  sss: string;
  philhealth: string;
  pagibig: string;
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

export function PayrollTab({ allowed, companyId }: { allowed: Set<string> | null; companyId: string | null }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState<PayRow[] | null>(null);
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

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
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
            ],
          };
          const slip = computePeriodPayslip(dtr, pay, inputs, formula, period);
          return {
            id: e.employeeId,
            name: e.fullName,
            department: e.department,
            branch: e.branchName ?? "",
            tin: e.tin,
            sss: e.sss,
            philhealth: e.philhealth,
            pagibig: e.pagibig,
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
      await savePayrollFormula(companyId, draft);
      setFormulaMsg("✓ Formula saved");
    } catch (e) {
      setFormulaMsg("Save failed: " + (e instanceof Error ? e.message : "error"));
    } finally {
      setSavingFormula(false);
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
      "SSS (EE)", "PhilHealth (EE)", "Pag-IBIG (EE)", "Withholding Tax", "Loans/Advances", "Total Deductions", "Net Pay",
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
          s.sssEE, s.philhealthEE, s.pagibigEE, s.withholdingTax, s.totalOtherDeductions, s.totalDeductions, s.netPay,
          s.sssER, s.philhealthER, s.pagibigER, s.employerContributions, s.thirteenthMonthAccrual,
        ];
      }),
    );
  };

  // BIR alphalist (1604-C style) — taxable vs non-taxable compensation + tax.
  const exportAlphalist = () => {
    if (!rows) return;
    const head = ["TIN", "Employee ID", "Name", "Gross Compensation", "Non-Taxable (contrib + de-minimis)", "Taxable Income", "Tax Withheld"];
    csvDownload(
      `BIR_Alphalist_${monthTag()}.csv`,
      head,
      rows.map((r) => {
        const s = r.slip;
        return [r.tin, r.id, r.name, s.grossPay, Math.round((s.totalContributions + s.deMinimis) * 100) / 100, s.taxableIncome, s.withholdingTax];
      }),
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
          <Pressable style={styles.genBtn} disabled={loading} onPress={compute}>
            <Text style={styles.genText}>{loading ? "Computing…" : "Compute Payroll"}</Text>
          </Pressable>
          {Platform.OS === "web" && (
            <>
              <Pressable style={[styles.ghostBtn, !rows && styles.ghostDisabled]} disabled={!rows} onPress={exportRegister}>
                <MaterialCommunityIcons name="table-arrow-down" size={16} color={Colors.primaryDark} />
                <Text style={styles.ghostText}>Register</Text>
              </Pressable>
              <Pressable style={[styles.ghostBtn, !rows && styles.ghostDisabled]} disabled={!rows} onPress={exportAlphalist}>
                <MaterialCommunityIcons name="file-certificate-outline" size={16} color={Colors.primaryDark} />
                <Text style={styles.ghostText}>BIR Alphalist</Text>
              </Pressable>
              <Pressable style={[styles.ghostBtn, !rows && styles.ghostDisabled]} disabled={!rows} onPress={exportContributions}>
                <MaterialCommunityIcons name="shield-account-outline" size={16} color={Colors.primaryDark} />
                <Text style={styles.ghostText}>Contributions</Text>
              </Pressable>
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

      <Pressable style={styles.formulaToggle} onPress={() => setShowFormulas((f) => !f)}>
        <MaterialCommunityIcons name="function-variant" size={16} color={Colors.primary} />
        <Text style={styles.formulaToggleText}>Pay computation formula — view &amp; edit</Text>
        <MaterialCommunityIcons name={showFormulas ? "chevron-up" : "chevron-down"} size={18} color={Colors.textMuted} />
      </Pressable>
      {showFormulas && (
        <Card>
          <Text style={styles.formulaHead}>Editable DOLE pay premiums</Text>
          <View style={styles.formulaGrid}>
            <FormulaField label="Hours / day" value={draft.hoursPerDay} suffix="hrs" onChange={(n) => setDraft({ ...draft, hoursPerDay: n })} />
            <FormulaField label="Overtime premium" value={pct(draft.otPremium)} suffix="%" hint={`= pay ${100 + pct(draft.otPremium)}%`} onChange={(n) => setDraft({ ...draft, otPremium: n / 100 })} />
            <FormulaField label="Night differential" value={pct(draft.nightDiff)} suffix="%" onChange={(n) => setDraft({ ...draft, nightDiff: n / 100 })} />
            <FormulaField label="Regular holiday premium" value={pct(draft.regHolidayPremium)} suffix="%" hint={`= pay ${100 + pct(draft.regHolidayPremium)}% worked`} onChange={(n) => setDraft({ ...draft, regHolidayPremium: n / 100 })} />
            <FormulaField label="Special holiday premium" value={pct(draft.specialHolidayPremium)} suffix="%" hint={`= pay ${100 + pct(draft.specialHolidayPremium)}% worked`} onChange={(n) => setDraft({ ...draft, specialHolidayPremium: n / 100 })} />
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
            <Pressable style={styles.resetBtn} onPress={() => setDraft(DEFAULT_FORMULA)}>
              <Text style={styles.resetText}>Reset to Labor Code</Text>
            </Pressable>
            <Pressable style={[styles.saveFormulaBtn, (!companyId || savingFormula) && styles.ghostDisabled]} disabled={!companyId || savingFormula} onPress={saveFormula}>
              <Text style={styles.saveFormulaText}>{savingFormula ? "Saving…" : "Save formula"}</Text>
            </Pressable>
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
          <LineItem
            label="Basic pay"
            detail={slip.payType === "hourly" ? `${slip.regularHours} h × ${peso(slip.hourlyRate)}/hr` : `${slip.daysPresent} days × ${peso(slip.dailyRate)}/day`}
            value={peso(slip.basicPay)}
          />
          {slip.otPay > 0 && <LineItem label="Overtime" detail={`${slip.otHours} h × ${peso(slip.hourlyRate)} × 125%`} value={peso(slip.otPay)} />}
          {slip.nightPay > 0 && <LineItem label="Night differential" detail={`${slip.nightHours} h × ${peso(slip.hourlyRate)} × 10%`} value={peso(slip.nightPay)} />}
          {slip.regHolidayPay > 0 && <LineItem label="Regular holiday" detail="+100% of daily rate" value={peso(slip.regHolidayPay)} />}
          {slip.specialHolidayPay > 0 && <LineItem label="Special holiday" detail="+30% of daily rate" value={peso(slip.specialHolidayPay)} />}
          {slip.allowanceTaxable > 0 && <LineItem label="Taxable allowance" detail="monthly, taxable" value={peso(slip.allowanceTaxable)} />}
          {slip.deMinimis > 0 && <LineItem label="De-minimis" detail="monthly, non-taxable" value={peso(slip.deMinimis)} />}
          <LineItem label="Gross Pay" value={peso(slip.grossPay)} strong />
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
      <Text style={styles.ffLabel}>{label}</Text>
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
      {hint ? <Text style={styles.ffHint}>{hint}</Text> : null}
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
  formulaToggle: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 4 },
  formulaToggleText: { flex: 1, fontSize: 13, fontWeight: "800", color: Colors.textBody },
  formulaHead: { fontSize: 12, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  formulaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  ff: { flexGrow: 1, flexBasis: 150 },
  ffLabel: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 6 },
  ffInputRow: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface },
  ffInput: { flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: "700", outlineStyle: "none" } as object,
  ffSuffix: { fontSize: 13, color: Colors.textFaint, fontWeight: "700" },
  ffHint: { fontSize: 11, color: Colors.textFaint, marginTop: 4 },
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
