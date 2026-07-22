import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { BackLink, Badge, Button, Card, Chip, Column, DataTable, EmptyState, Field, InlineMessage, SearchInput, SectionTitle, Select, StatTile, TextField } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { getAttendanceForMonth } from "@/lib/attendance";
import { AttendanceRequest, subscribeAllRequests } from "@/lib/attendance-requests";
import { DtrSummary, buildDtr, formatHours } from "@/lib/dtr";
import { EmployeeMaster, WORKER_TYPES, isPayrollExcluded, subscribeEmployeeMasters } from "@/lib/hr";
import { tenureYears } from "@/lib/leave-benefits";
import { LeaveRequest, subscribeAllLeaves } from "@/lib/leaves";
import { loanBalanceAfter, loanDeductionForMonth } from "@/lib/loans";
import { inScope } from "@/lib/org";
import { subscribePayrollFormula } from "@/lib/payroll-settings";
import { DEFAULT_FORMULA, PayBasis, PayFormula, PayInputs, Payslip, computePeriodPayslip, payPeriods, peso } from "@/lib/ph-payroll";
import { getSchedule } from "@/lib/schedules";

// One computed employee row for the reporting period.
type Row = {
  id: string;
  name: string;
  lastName: string;
  firstName: string;
  branch: string;
  tin: string;
  sss: string;
  philhealth: string;
  pagibig: string;
  slip: Payslip;
  summary: DtrSummary;
};

// A report column: how to render it on screen and how to emit it to CSV.
type ReportField = { header: string; align?: "right"; cell: (r: Row) => string; csv: (r: Row) => string | number };

type ReportKey = "status" | "timekeeping" | "1601c" | "contrib" | "sssr3" | "philrf1" | "hdmfmcrf" | "13month" | "register";
const REPORTS: { value: ReportKey; label: string }[] = [
  { value: "status", label: "HRIS · Employee Status & Headcount" },
  { value: "timekeeping", label: "Timekeeping · Attendance Summary" },
  { value: "1601c", label: "BIR 1601-C · Withholding Tax on Compensation" },
  { value: "contrib", label: "Statutory Contributions · SSS / PhilHealth / Pag-IBIG" },
  { value: "sssr3", label: "SSS R-3 · Contribution Collection List (My.SSS)" },
  { value: "philrf1", label: "PhilHealth RF-1 · Premium Remittance (EPRS)" },
  { value: "hdmfmcrf", label: "Pag-IBIG MCRF · Contribution Remittance" },
  { value: "13month", label: "DOLE 13th Month Pay (PD 851)" },
  { value: "register", label: "DOLE Payroll Register" },
];

// Agency remittance files (SSS / PhilHealth / Pag-IBIG) — same shape, different
// ID field, contribution amounts, and headers. Validate each against the current
// agency e-submission spec before uploading.
type RemitKey = "sssr3" | "philrf1" | "hdmfmcrf";
const REMIT: Record<RemitKey, {
  short: string;
  title: string;
  file: string;
  empLabel: string;
  idHeader: string;
  idOf: (r: Row) => string;
  ee: (s: Payslip) => number;
  er: (s: Payslip) => number;
  eeH: string;
  erH: string;
}> = {
  sssr3: { short: "SSS R-3", title: "SSS R-3 · CONTRIBUTION COLLECTION LIST", file: "SSS_R3", empLabel: "Employer SSS No.", idHeader: "SS Number", idOf: (r) => r.sss, ee: (s) => s.sssEE, er: (s) => s.sssER, eeH: "SS-EE", erH: "SS-ER" },
  philrf1: { short: "PhilHealth RF-1", title: "PhilHealth RF-1 · EMPLOYER PREMIUM REMITTANCE REPORT", file: "PhilHealth_RF1", empLabel: "Employer PhilHealth No.", idHeader: "PhilHealth No.", idOf: (r) => r.philhealth, ee: (s) => s.philhealthEE, er: (s) => s.philhealthER, eeH: "PHIC-EE", erH: "PHIC-ER" },
  hdmfmcrf: { short: "Pag-IBIG MCRF", title: "Pag-IBIG MCRF · MEMBERSHIP CONTRIBUTION REMITTANCE", file: "PagIBIG_MCRF", empLabel: "Employer Pag-IBIG No.", idHeader: "Pag-IBIG MID", idOf: (r) => r.pagibig, ee: (s) => s.pagibigEE, er: (s) => s.pagibigER, eeH: "HDMF-EE", erH: "HDMF-ER" },
};

// ── Report catalog metadata (the "choose a report" cards) ──
type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
type Tone = "hris" | "time" | "bir" | "dole" | "agency";
const REPORT_META: { key: ReportKey; label: string; desc: string; category: string; icon: MdIcon; tone: Tone; cadence: string }[] = [
  { key: "status", label: "Employee Status & Headcount", desc: "Active/inactive roster, new hires, and tenure across your scope.", category: "HRIS", icon: "account-group", tone: "hris", cadence: "Live" },
  { key: "timekeeping", label: "Attendance Summary", desc: "Per-employee present, absent, late, hours, OT, and undertime for the month.", category: "Timekeeping", icon: "clock-check-outline", tone: "time", cadence: "Monthly" },
  { key: "1601c", label: "BIR 1601-C", desc: "Monthly withholding tax on compensation — gross, taxable, and tax withheld.", category: "BIR", icon: "bank-outline", tone: "bir", cadence: "Monthly" },
  { key: "contrib", label: "Statutory Contributions", desc: "SSS, PhilHealth, and Pag-IBIG employee + employer shares.", category: "BIR", icon: "shield-account-outline", tone: "bir", cadence: "Monthly" },
  { key: "sssr3", label: "SSS R-3", desc: "Contribution collection list formatted for My.SSS submission.", category: "Agency Remittance", icon: "file-certificate-outline", tone: "agency", cadence: "Monthly" },
  { key: "philrf1", label: "PhilHealth RF-1", desc: "Employer premium remittance report (EPRS).", category: "Agency Remittance", icon: "hospital-box-outline", tone: "agency", cadence: "Monthly" },
  { key: "hdmfmcrf", label: "Pag-IBIG MCRF", desc: "Membership contribution remittance form.", category: "Agency Remittance", icon: "home-city-outline", tone: "agency", cadence: "Monthly" },
  { key: "13month", label: "DOLE 13th Month Pay", desc: "PD 851 — basic pay earned and 13th-month accrual per employee.", category: "DOLE", icon: "gift-outline", tone: "dole", cadence: "Annual" },
  { key: "register", label: "DOLE Payroll Register", desc: "Gross, deductions, and net pay per employee.", category: "DOLE", icon: "cash-multiple", tone: "dole", cadence: "Per period" },
];
const toneBg: Record<Tone, string> = {
  hris: Colors.primaryTint,
  time: Colors.successTint,
  bir: Colors.warningSurface,
  dole: Colors.primaryTintStrong,
  agency: Colors.warmSurfaceAlt,
};
const toneFg: Record<Tone, string> = {
  hris: Colors.primary,
  time: Colors.success,
  bir: Colors.warningDeep,
  dole: Colors.primaryDeep,
  agency: Colors.primaryDark,
};

function tenureText(e: EmployeeMaster) {
  if (!e.hireDate) return "—";
  const t = tenureYears(e.hireDate);
  return t < 1 ? "<1 yr" : `${t.toFixed(1)} yr`;
}

const money = (n: number) => peso(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

function fieldsFor(key: ReportKey): ReportField[] {
  const emp: ReportField = { header: "Employee", cell: (r) => r.name, csv: (r) => r.name };
  switch (key) {
    case "timekeeping":
      return [
        emp,
        { header: "Branch", cell: (r) => r.branch || "—", csv: (r) => r.branch },
        { header: "Present", align: "right", cell: (r) => String(r.summary.present), csv: (r) => r.summary.present },
        { header: "Absent", align: "right", cell: (r) => String(r.summary.absent), csv: (r) => r.summary.absent },
        { header: "Late", align: "right", cell: (r) => String(r.summary.late), csv: (r) => r.summary.late },
        { header: "Hours", align: "right", cell: (r) => formatHours(r.summary.totalMinutes), csv: (r) => round2(r.summary.totalMinutes / 60) },
        { header: "OT", align: "right", cell: (r) => formatHours(r.summary.otMinutes), csv: (r) => round2(r.summary.otMinutes / 60) },
        { header: "Undertime", align: "right", cell: (r) => formatHours(r.summary.underMinutes), csv: (r) => round2(r.summary.underMinutes / 60) },
      ];
    case "1601c":
      return [
        { header: "TIN", cell: (r) => r.tin || "—", csv: (r) => r.tin },
        emp,
        { header: "Gross Comp.", align: "right", cell: (r) => money(r.slip.grossPay), csv: (r) => round2(r.slip.grossPay) },
        { header: "Non-Taxable", align: "right", cell: (r) => money(r.slip.totalContributions + r.slip.deMinimis), csv: (r) => round2(r.slip.totalContributions + r.slip.deMinimis) },
        { header: "Taxable", align: "right", cell: (r) => money(r.slip.taxableIncome), csv: (r) => round2(r.slip.taxableIncome) },
        { header: "Tax Withheld", align: "right", cell: (r) => money(r.slip.withholdingTax), csv: (r) => round2(r.slip.withholdingTax) },
      ];
    case "contrib":
      return [
        emp,
        { header: "SSS EE", align: "right", cell: (r) => money(r.slip.sssEE), csv: (r) => round2(r.slip.sssEE) },
        { header: "SSS ER", align: "right", cell: (r) => money(r.slip.sssER), csv: (r) => round2(r.slip.sssER) },
        { header: "PHIC EE", align: "right", cell: (r) => money(r.slip.philhealthEE), csv: (r) => round2(r.slip.philhealthEE) },
        { header: "PHIC ER", align: "right", cell: (r) => money(r.slip.philhealthER), csv: (r) => round2(r.slip.philhealthER) },
        { header: "HDMF EE", align: "right", cell: (r) => money(r.slip.pagibigEE), csv: (r) => round2(r.slip.pagibigEE) },
        { header: "HDMF ER", align: "right", cell: (r) => money(r.slip.pagibigER), csv: (r) => round2(r.slip.pagibigER) },
      ];
    case "sssr3":
    case "philrf1":
    case "hdmfmcrf": {
      const cfg = REMIT[key];
      return [
        { header: cfg.idHeader, cell: (r) => cfg.idOf(r) || "—", csv: (r) => cfg.idOf(r) },
        emp,
        { header: cfg.eeH, align: "right", cell: (r) => money(cfg.ee(r.slip)), csv: (r) => round2(cfg.ee(r.slip)) },
        { header: cfg.erH, align: "right", cell: (r) => money(cfg.er(r.slip)), csv: (r) => round2(cfg.er(r.slip)) },
        { header: "Total", align: "right", cell: (r) => money(cfg.ee(r.slip) + cfg.er(r.slip)), csv: (r) => round2(cfg.ee(r.slip) + cfg.er(r.slip)) },
      ];
    }
    case "13month":
      return [
        emp,
        { header: "Branch", cell: (r) => r.branch || "—", csv: (r) => r.branch },
        { header: "Basic (period)", align: "right", cell: (r) => money(r.slip.basicPay), csv: (r) => round2(r.slip.basicPay) },
        { header: "13th-Mo. Accrual", align: "right", cell: (r) => money(r.slip.thirteenthMonthAccrual), csv: (r) => round2(r.slip.thirteenthMonthAccrual) },
      ];
    case "register":
      return [
        emp,
        { header: "Branch", cell: (r) => r.branch || "—", csv: (r) => r.branch },
        { header: "Gross", align: "right", cell: (r) => money(r.slip.grossPay), csv: (r) => round2(r.slip.grossPay) },
        { header: "Deductions", align: "right", cell: (r) => money(r.slip.totalDeductions), csv: (r) => round2(r.slip.totalDeductions) },
        { header: "Net Pay", align: "right", cell: (r) => money(r.slip.netPay), csv: (r) => round2(r.slip.netPay) },
      ];
    default:
      return []; // "status" renders from the roster, not payslip fields.
  }
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ReportsTab({ allowed, companyId }: { allowed: Set<string> | null; companyId: string | null }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [allRequests, setAllRequests] = useState<AttendanceRequest[]>([]);
  const [formula, setFormula] = useState<PayFormula>(DEFAULT_FORMULA);
  const [month, setMonth] = useState(currentMonthValue());
  const [report, setReport] = useState<ReportKey | null>(null);
  const [catSearch, setCatSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [employerNo, setEmployerNo] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeAllLeaves(setAllLeaves, () => setAllLeaves([])), []);
  useEffect(() => subscribeAllRequests(setAllRequests, () => setAllRequests([])), []);
  useEffect(() => subscribePayrollFormula(companyId, setFormula, () => {}), [companyId]);

  const compute = async () => {
    setError("");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Enter the month as YYYY-MM.");
      return;
    }
    // Agency Personnel are excluded from payroll runs & government reports (PM-05).
    const active = employees.filter((e) => e.status === "active" && inScope(e.branchId, allowed) && !isPayrollExcluded(e));
    if (active.length === 0) {
      setError("No active employees in scope to report on.");
      return;
    }
    const [y, mo] = month.split("-").map(Number);
    const periods = payPeriods(formula, y, mo - 1);
    const period = periods.find((p) => p.key === "full") ?? periods[periods.length - 1];
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
              ...e.loans.map((l) => ({ label: `${l.label} · bal ${peso(loanBalanceAfter(l, month))}`, amount: loanDeductionForMonth(l, month) })),
            ],
          };
          const slip = computePeriodPayslip(dtr, pay, inputs, formula, period);
          return { id: e.employeeId, name: e.fullName, lastName: e.lastName, firstName: e.firstName, branch: e.branchName ?? "", tin: e.tin, sss: e.sss, philhealth: e.philhealth, pagibig: e.pagibig, slip, summary: dtr.summary } as Row;
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

  // Payroll compliance totals (remittance figures) for that stat band.
  const payrollTotals = useMemo(() => {
    const base = { tax: 0, contrib: 0, thirteenth: 0, gross: 0 };
    if (!rows) return base;
    return rows.reduce((a, r) => {
      const s = r.slip;
      return {
        tax: a.tax + s.withholdingTax,
        contrib: a.contrib + s.sssEE + s.sssER + s.philhealthEE + s.philhealthER + s.pagibigEE + s.pagibigER,
        thirteenth: a.thirteenth + s.thirteenthMonthAccrual,
        gross: a.gross + s.grossPay,
      };
    }, base);
  }, [rows]);

  // Timekeeping totals (attendance) for its stat band.
  const timekeepingTotals = useMemo(() => {
    const base = { present: 0, absent: 0, late: 0, ot: 0 };
    if (!rows) return base;
    return rows.reduce(
      (a, r) => ({
        present: a.present + r.summary.present,
        absent: a.absent + r.summary.absent,
        late: a.late + r.summary.late,
        ot: a.ot + r.summary.otMinutes,
      }),
      base,
    );
  }, [rows]);

  const isStatus = report === "status";
  const isTimekeeping = report === "timekeeping";
  const isRemit = report === "sssr3" || report === "philrf1" || report === "hdmfmcrf";
  const remitCfg = isRemit ? REMIT[report as RemitKey] : null;

  // HRIS roster (live, in-scope) for the Employee Status report.
  const monthLabel = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return month;
    const [y, mo] = month.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [month]);
  const roster = useMemo(
    () =>
      employees
        .filter((e) => inScope(e.branchId, allowed))
        .sort((a, b) => a.status.localeCompare(b.status) || (a.branchName ?? "").localeCompare(b.branchName ?? "") || a.fullName.localeCompare(b.fullName)),
    [employees, allowed],
  );
  const statusStats = useMemo(() => {
    const active = roster.filter((e) => e.status === "active").length;
    const newHires = roster.filter((e) => e.hireDate?.startsWith(month)).length;
    return { total: roster.length, active, inactive: roster.length - active, newHires };
  }, [roster, month]);
  const statusColumns: Column<EmployeeMaster>[] = [
    { key: "name", header: "Employee", flex: 1.6, render: (e) => e.fullName },
    { key: "pos", header: "Position", flex: 1, render: (e) => e.position || "—" },
    { key: "branch", header: "Branch", flex: 1, render: (e) => e.branchName ?? "—" },
    { key: "dept", header: "Department", flex: 1, render: (e) => e.department || "—" },
    { key: "type", header: "Type", width: 132, render: (e) => (e.workerType === "agency" ? <Badge label="Agency" tone="warning" /> : (WORKER_TYPES.find((w) => w.value === e.workerType)?.label ?? e.workerType)) },
    { key: "status", header: "Status", width: 96, render: (e) => <Badge label={e.status === "active" ? "Active" : "Inactive"} tone={e.status === "active" ? "in" : "out"} /> },
    { key: "hire", header: "Hire Date", width: 108, render: (e) => e.hireDate ?? "—" },
    { key: "tenure", header: "Tenure", width: 78, align: "right", render: (e) => tenureText(e) },
  ];

  const fields = report !== null && !isStatus ? fieldsFor(report) : [];
  const columns: Column<Row>[] = fields.map((f, i) => ({
    key: String(i),
    header: f.header,
    flex: i === (fields[0]?.header === "TIN" ? 1 : 0) ? 1.8 : 1,
    align: f.align,
    render: (r) => f.cell(r),
  }));

  const csvDownload = (filename: string, matrix: (string | number)[][]) => {
    if (Platform.OS !== "web") return;
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const blob = new Blob([matrix.map((row) => row.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    if (isStatus) {
      const head = ["Employee", "Employee ID", "Position", "Branch", "Department", "Status", "Hire Date", "Tenure (yrs)"];
      csvDownload(`employee_status_${monthLabel.replace(/\s+/g, "_")}.csv`, [
        head,
        ...roster.map((e) => [e.fullName, e.employeeId, e.position, e.branchName ?? "", e.department, e.status, e.hireDate ?? "", e.hireDate ? tenureYears(e.hireDate).toFixed(1) : ""]),
      ]);
      return;
    }
    if (!rows) return;
    csvDownload(`${report}_${label.replace(/\s+/g, "_")}.csv`, [fields.map((f) => f.header), ...rows.map((r) => fields.map((f) => f.csv(r)))]);
  };

  // Agency remittance file (SSS R-3 / PhilHealth RF-1 / Pag-IBIG MCRF) — the file
  // an employer submits for the month's contributions. Standard collection-list
  // layout with an employer/period header; validate against the current agency
  // e-submission format before uploading.
  const exportRemittance = () => {
    if (!rows || !remitCfg) return;
    const cfg = remitCfg;
    const period = /^\d{4}-\d{2}$/.test(month) ? `${month.slice(5, 7)}${month.slice(0, 4)}` : month; // MMYYYY
    const totEE = rows.reduce((s, r) => s + cfg.ee(r.slip), 0);
    const totER = rows.reduce((s, r) => s + cfg.er(r.slip), 0);
    const matrix: (string | number)[][] = [
      [cfg.title],
      [cfg.empLabel, employerNo || "________________"],
      ["Applicable Period", monthLabel, `(${period})`],
      [],
      [cfg.idHeader, "Last Name", "First Name", cfg.eeH, cfg.erH, "Total"],
      ...rows.map((r) => [cfg.idOf(r), r.lastName, r.firstName, round2(cfg.ee(r.slip)), round2(cfg.er(r.slip)), round2(cfg.ee(r.slip) + cfg.er(r.slip))]),
      ["TOTAL", "", "", round2(totEE), round2(totER), round2(totEE + totER)],
    ];
    csvDownload(`${cfg.file}_${period}.csv`, matrix);
  };

  // ── Catalog view: pick a report (restaurant-app style card grid) ──
  if (!report) {
    const cats = ["All", ...Array.from(new Set(REPORT_META.map((m) => m.category)))];
    const q = catSearch.trim().toLowerCase();
    const shown = REPORT_META.filter(
      (m) =>
        (catFilter === "All" || m.category === catFilter) &&
        (!q || `${m.label} ${m.desc} ${m.category}`.toLowerCase().includes(q)),
    );
    const groups = cats
      .filter((c) => c !== "All")
      .map((c) => ({ c, items: shown.filter((m) => m.category === c) }))
      .filter((g) => g.items.length > 0);
    return (
      <View>
        <View style={styles.pageHead}>
          <Text style={styles.eyebrow}>HRIS &amp; Compliance</Text>
          <Text style={styles.pageTitle}>Choose a report</Text>
          <Text style={styles.pageSub}>Employee status, timekeeping, and DOLE / BIR compliance reports, scoped to your role and selected branches.</Text>
        </View>
        <View style={styles.catToolbar}>
          <SearchInput value={catSearch} onChangeText={setCatSearch} placeholder="Search reports…" />
          <View style={styles.catChips}>
            {cats.map((c) => (
              <Chip key={c} label={c} active={catFilter === c} onPress={() => setCatFilter(c)} />
            ))}
          </View>
        </View>
        {groups.length === 0 ? (
          <EmptyState icon="file-chart-outline" text="No reports match your filter" />
        ) : (
          groups.map((g) => (
            <View key={g.c} style={styles.catSection}>
              <Text style={styles.catSectionTitle}>{g.c}</Text>
              <View style={styles.catGrid}>
                {g.items.map((m) => (
                  <Pressable key={m.key} style={styles.catCard} onPress={() => setReport(m.key)}>
                    <View style={[styles.catIcon, { backgroundColor: toneBg[m.tone] }]}>
                      <MaterialCommunityIcons name={m.icon} size={20} color={toneFg[m.tone]} />
                    </View>
                    <Text style={styles.catTitle}>{m.label}</Text>
                    <Text style={styles.catDesc}>{m.desc}</Text>
                    <View style={styles.catMeta}>
                      <Text style={styles.catMetaChip}>{m.cadence}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
      </View>
    );
  }

  const activeMeta = REPORT_META.find((m) => m.key === report);

  return (
    <View>
      <BackLink label="All reports" onPress={() => setReport(null)} />
      <SectionTitle>{activeMeta?.label ?? "Report"}</SectionTitle>
      <Card>
        <View style={styles.controls}>
          <View style={styles.reportCol}>
            <Field label="Report">
              <Select value={report} options={REPORTS} onChange={(v) => setReport(v as ReportKey)} />
            </Field>
          </View>
          <View style={styles.monthCol}>
            <TextField label="Month" value={month} onChangeText={setMonth} placeholder="YYYY-MM" />
          </View>
          {remitCfg && (
            <View style={styles.employerCol}>
              <TextField label={remitCfg.empLabel} value={employerNo} onChangeText={setEmployerNo} placeholder="Employer number" />
            </View>
          )}
        </View>
        <View style={styles.actions}>
          {!isStatus && <Button label="Generate" icon="cog-outline" loading={loading} onPress={compute} />}
          {remitCfg ? (
            <Button label={`Export ${remitCfg.short} File`} variant="ghost" icon="file-download-outline" disabled={!rows} onPress={exportRemittance} />
          ) : (
            <Button label="Export CSV" variant="ghost" icon="file-delimited-outline" disabled={isStatus ? roster.length === 0 : !rows} onPress={exportCsv} />
          )}
        </View>
        {error ? <InlineMessage text={error} tone="error" /> : null}
        <Text style={styles.note}>
          {isStatus
            ? "Live roster within your org scope. “New hires” counts employees whose hire date falls in the selected month."
            : "Computed for the full month from each employee’s DTR, rates, and the company payroll formula. Statutory rates as of 2025 — verify against the latest BIR / SSS / PhilHealth / HDMF issuances before filing."}
        </Text>
      </Card>

      {isStatus ? (
        <>
          <View style={styles.tiles}>
            <StatTile label="Total Employees" value={statusStats.total} icon="account-group" tone="neutral" />
            <StatTile label="Active" value={statusStats.active} sub="currently employed" icon="account-check" tone="in" />
            <StatTile label="Inactive" value={statusStats.inactive} sub="separated / on hold" icon="account-off-outline" tone="out" />
            <StatTile label="New Hires" value={statusStats.newHires} sub={monthLabel} icon="account-plus-outline" tone="primary" />
          </View>
          {roster.length === 0 ? (
            <EmptyState icon="account-group-outline" text="No employees in scope" />
          ) : (
            <DataTable columns={statusColumns} rows={roster} keyExtractor={(e) => e.employeeId} />
          )}
        </>
      ) : rows ? (
        <>
          <View style={styles.tiles}>
            {isTimekeeping ? (
              <>
                <StatTile label="Present (days)" value={timekeepingTotals.present} sub={label} icon="account-clock" tone="in" />
                <StatTile label="Absences" value={timekeepingTotals.absent} sub="scheduled, no punch" icon="account-alert-outline" tone="critical" />
                <StatTile label="Late Incidents" value={timekeepingTotals.late} icon="clock-alert-outline" tone="pending" />
                <StatTile label="Overtime" value={formatHours(timekeepingTotals.ot)} sub="total OT hours" icon="timer-outline" tone="neutral" />
              </>
            ) : (
              <>
                <StatTile label="Tax Withheld" value={peso(payrollTotals.tax)} sub="BIR 1601-C" icon="bank-outline" tone="primary" />
                <StatTile label="Contributions" value={peso(payrollTotals.contrib)} sub="SSS + PHIC + HDMF (EE+ER)" icon="shield-account-outline" tone="neutral" />
                <StatTile label="13th-Month Accrual" value={peso(payrollTotals.thirteenth)} sub="DOLE PD 851" icon="gift-outline" tone="neutral" />
                <StatTile label="Gross Compensation" value={peso(payrollTotals.gross)} sub={label} icon="cash-multiple" tone="neutral" />
              </>
            )}
          </View>
          {rows.length === 0 ? (
            <EmptyState icon="file-chart-outline" text="No employees in scope" />
          ) : (
            <DataTable columns={columns} rows={rows} keyExtractor={(r) => r.id} />
          )}
        </>
      ) : !loading ? (
        <EmptyState icon="file-chart-outline" text="Pick a report and month, then Generate" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "flex-start", gap: 14, flexWrap: "wrap", position: "relative", zIndex: 30 },
  reportCol: { flexGrow: 1, flexBasis: 300, minWidth: 260 },
  monthCol: { width: 160 },
  employerCol: { width: 210 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", position: "relative", zIndex: 1 },
  note: { marginTop: 12, fontSize: 11.5, color: Colors.textFaint, lineHeight: 16 },
  tiles: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginTop: 18, marginBottom: 8 },

  // ── Report catalog (choose-a-report card grid) ──
  pageHead: { marginBottom: 18 },
  eyebrow: { color: Colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  pageTitle: { color: Colors.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  pageSub: { color: Colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 6, maxWidth: 720 },
  catToolbar: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap", backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.hairline, borderRadius: 12, padding: 12, marginBottom: 22 },
  catChips: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  catSection: { marginBottom: 26 },
  catSectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: "800", letterSpacing: -0.2, marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  catCard: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 240,
    backgroundColor: Colors.cardSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    shadowColor: "#1F2937",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 1,
  },
  catIcon: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  catTitle: { color: Colors.textPrimary, fontSize: 15.5, fontWeight: "800", letterSpacing: -0.2, marginBottom: 6 },
  catDesc: { color: Colors.textMuted, fontSize: 12.5, lineHeight: 18, marginBottom: 14 },
  catMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  catMetaChip: { fontSize: 11, fontWeight: "700", color: Colors.textMuted, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
});
