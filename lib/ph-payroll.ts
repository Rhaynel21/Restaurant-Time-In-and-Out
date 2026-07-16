import { Dtr, sliceDtr } from "@/lib/dtr";

// Philippine statutory payroll engine — DOLE pay rules + BIR/SSS/PhilHealth/
// Pag-IBIG deductions — turning a month's DTR into a full payslip (gross → net).
//
// ⚠️  RATES ARE AS OF 2025 and are provided for computation, NOT as tax/legal
// advice. Contribution tables and tax rules change (often yearly) — verify
// against the latest SSS / PhilHealth / HDMF circulars and BIR RR before filing
// or paying. All rate constants live at the top so they're easy to update.

export const PH_RATES_VERSION = "2025";

// DOLE pay formula — the configurable premium knobs. Defaults follow the Labor
// Code minimums; a company may pay more, editable via Payroll Settings.
export type PayFrequency = "monthly" | "semimonthly" | "weekly";

export type PayFormula = {
  hoursPerDay: number; // hours in a paid day (derives the hourly rate)
  otPremium: number; // overtime premium fraction (0.25 → 125%)
  nightDiff: number; // night differential fraction (0.10 → +10%)
  regHolidayPremium: number; // regular holiday premium fraction (1.0 → 200% worked)
  specialHolidayPremium: number; // special day premium fraction (0.30 → 130% worked)
  // ── Pay period (all customizable per company) ──
  payFrequency: PayFrequency; // monthly · semi-monthly · weekly
  cutoffDay: number; // semi-monthly split day (1–28); 1st period = 1..cutoff
  contributionOn: "second" | "split"; // semi-monthly: deduct SSS/PhilHealth/etc on 2nd cutoff only, or split 50/50
  // Monthly de-minimis cap (BIR): non-taxable up to this amount, excess is
  // taxable. 0 = no cap (treat all de-minimis as non-taxable).
  deMinimisCap: number;
};

export const DEFAULT_FORMULA: PayFormula = {
  hoursPerDay: 8,
  otPremium: 0.25,
  nightDiff: 0.1,
  regHolidayPremium: 1.0,
  specialHolidayPremium: 0.3,
  payFrequency: "monthly",
  cutoffDay: 15,
  contributionOn: "second",
  deMinimisCap: 0,
};

// One pay period within a month, and how much of the monthly statutory
// deductions / allowances it carries.
export type PayPeriod = {
  key: string;
  label: string;
  fromDay: number;
  toDay: number;
  deductionFactor: number; // share of monthly SSS/PhilHealth/Pag-IBIG/tax/loans
  allowanceFactor: number; // share of monthly allowances
};

// Build the pay periods for a month from the configured frequency. Earnings are
// always the actual days worked in each period; the factors spread the monthly
// deductions/allowances across periods.
export function payPeriods(formula: PayFormula, year: number, month: number): PayPeriod[] {
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (formula.payFrequency === "semimonthly") {
    const c = Math.min(28, Math.max(1, Math.round(formula.cutoffDay)));
    const second = formula.contributionOn === "split" ? 0.5 : 1;
    const first = formula.contributionOn === "split" ? 0.5 : 0;
    return [
      { key: "c1", label: `1st cutoff · ${c === 1 ? "1" : `1–${c}`}`, fromDay: 1, toDay: c, deductionFactor: first, allowanceFactor: 0.5 },
      { key: "c2", label: `2nd cutoff · ${c + 1}–${lastDay}`, fromDay: c + 1, toDay: lastDay, deductionFactor: second, allowanceFactor: 0.5 },
    ];
  }
  if (formula.payFrequency === "weekly") {
    const chunks: [number, number][] = [];
    for (let s = 1; s <= lastDay; s += 7) chunks.push([s, Math.min(s + 6, lastDay)]);
    const n = chunks.length;
    return chunks.map(([f, t], i) => ({
      key: `w${i}`,
      label: `Week ${i + 1} · ${f}–${t}`,
      fromDay: f,
      toDay: t,
      deductionFactor: 1 / n,
      allowanceFactor: 1 / n,
    }));
  }
  return [{ key: "full", label: "Whole month", fromDay: 1, toDay: lastDay, deductionFactor: 1, allowanceFactor: 1 }];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── SSS (2025): total 15% of the Monthly Salary Credit — EE 5%, ER 10% — with
// the MSC pegged between ₱5,000 and ₱35,000 in ₱500 steps. Employer also pays a
// small Employees' Compensation (EC) premium. ────────────────────────────────
export function sssContribution(monthlyComp: number) {
  const msc = Math.min(35000, Math.max(5000, Math.round(monthlyComp / 500) * 500));
  const ee = round2(msc * 0.05);
  const erBase = round2(msc * 0.1);
  const ec = msc >= 15000 ? 30 : 10; // employer-paid EC premium
  return { msc, ee, er: round2(erBase + ec), ec };
}

// ── PhilHealth (2024–2025): 5% premium of monthly basic salary, split 50/50,
// with an income floor of ₱10,000 and ceiling of ₱100,000. ────────────────────
export function philhealthContribution(monthlyBasic: number) {
  const base = Math.min(100000, Math.max(10000, monthlyBasic));
  const premium = round2(base * 0.05);
  const ee = round2(premium / 2);
  return { premium, ee, er: round2(premium - ee) };
}

// ── Pag-IBIG (HDMF): EE 1% if monthly comp ≤ ₱1,500 else 2%; ER 2%; the fund
// salary is capped at ₱10,000 (so the max share is ₱200 each). ────────────────
export function pagibigContribution(monthlyComp: number) {
  const base = Math.min(10000, Math.max(0, monthlyComp));
  const eeRate = monthlyComp <= 1500 ? 0.01 : 0.02;
  return { ee: round2(base * eeRate), er: round2(base * 0.02) };
}

// ── BIR withholding tax — TRAIN law MONTHLY table (effective Jan 1, 2023).
// `taxable` = gross compensation minus the mandatory EE contributions. ─────────
export function withholdingTaxMonthly(taxable: number): number {
  if (taxable <= 20833) return 0;
  if (taxable <= 33332) return round2((taxable - 20833) * 0.15);
  if (taxable <= 66666) return round2(1875 + (taxable - 33333) * 0.2);
  if (taxable <= 166666) return round2(8541.8 + (taxable - 66667) * 0.25);
  if (taxable <= 666666) return round2(33541.8 + (taxable - 166667) * 0.3);
  return round2(183541.8 + (taxable - 666667) * 0.35);
}

// A recurring or one-off deduction taken from net pay (SSS/Pag-IBIG loan
// amortization, cash advance, uniform, etc.). These are NOT tax-deductible.
export type OtherDeduction = { label: string; amount: number };

// Extra pay inputs that don't come from the DTR: monthly allowances and any
// recurring deductions carried on the employee's record.
export type PayInputs = {
  allowanceTaxable?: number; // taxable allowance (added to gross AND tax base)
  deMinimis?: number; // non-taxable / de-minimis allowance (added to gross only)
  otherDeductions?: OtherDeduction[]; // loans, cash advances, etc.
};

// How the employee is paid. Basic pay = daily rate × days present (daily), or
// hourly rate × regular hours worked (hourly). The other rate is derived from
// the 8-hour day so premiums/holiday pay work either way.
export type PayBasis = { type: "daily" | "hourly"; dailyRate: number; hourlyRate: number };

// BIR withholding tax — TRAIN law ANNUAL table (for year-end annualization).
// The employer trues up the year's withholding against the tax on total annual
// taxable compensation, refunding/collecting the difference in December.
export function annualWithholdingTax(annualTaxable: number): number {
  const t = annualTaxable;
  if (t <= 250000) return 0;
  if (t <= 400000) return round2((t - 250000) * 0.15);
  if (t <= 800000) return round2(22500 + (t - 400000) * 0.2);
  if (t <= 2000000) return round2(102500 + (t - 800000) * 0.25);
  if (t <= 8000000) return round2(402500 + (t - 2000000) * 0.3);
  return round2(2202500 + (t - 8000000) * 0.35);
}

export type Payslip = {
  // Earnings
  daysPresent: number;
  paidLeaveDays: number;
  payType: "daily" | "hourly";
  hourlyRate: number;
  dailyRate: number;
  regularHours: number;
  basicPay: number;
  otHours: number;
  otPay: number;
  nightHours: number;
  nightPay: number;
  regHolidayPay: number;
  specialHolidayPay: number;
  leavePay: number;
  allowanceTaxable: number;
  deMinimis: number;
  grossPay: number;
  // Employee deductions
  sssEE: number;
  philhealthEE: number;
  pagibigEE: number;
  totalContributions: number;
  taxableIncome: number;
  withholdingTax: number;
  otherDeductions: OtherDeduction[];
  totalOtherDeductions: number;
  totalDeductions: number;
  netPay: number;
  // Employer share (cost to company, not deducted from the employee)
  sssER: number;
  sssEC: number;
  philhealthER: number;
  pagibigER: number;
  employerContributions: number;
  // Accruals
  thirteenthMonthAccrual: number;
};

// Compute a full monthly payslip from a DTR, the employee's daily rate, and any
// allowances / recurring deductions. Premiums come from the DTR's DOLE minute
// tallies; statutory deductions and tax are layered on to arrive at net pay.
export function computePayslip(
  dtr: Dtr,
  pay: PayBasis,
  inputs: PayInputs = {},
  formula: PayFormula = DEFAULT_FORMULA,
): Payslip {
  const { summary, rows } = dtr;
  // Derive both rates from the configured paid-day length so premiums work either way.
  const hourlyRate = pay.type === "hourly" ? round2(pay.hourlyRate) : round2(pay.dailyRate / formula.hoursPerDay);
  const dailyRate = pay.type === "daily" ? round2(pay.dailyRate) : round2(pay.hourlyRate * formula.hoursPerDay);

  // Daily-paid: rate × days present. Hourly-paid: rate × regular hours (worked
  // hours net of overtime, which is paid separately at a premium below).
  const regularHours = round2(Math.max(0, summary.totalMinutes - summary.otMinutes) / 60);
  const basicPay =
    pay.type === "hourly" ? round2(regularHours * hourlyRate) : round2(dailyRate * summary.present);
  const otHours = round2(summary.otMinutes / 60);
  // Overtime hours are beyond basic pay, so they're paid at the full 125%.
  const otPay = round2(otHours * hourlyRate * (1 + formula.otPremium));
  const nightHours = round2(summary.nightMinutes / 60);
  const nightPay = round2(nightHours * hourlyRate * formula.nightDiff);

  // Holiday pay from the DTR rows (basicPay already pays 100% for a WORKED day):
  //   • Regular holiday worked   → +100% premium (200% total)
  //   • Regular holiday unworked → 100% holiday pay (DOLE-mandated)
  //   • Special day worked       → +30% premium (130% total); unworked = no pay
  let regHolidayPay = 0;
  let specialHolidayPay = 0;
  for (const r of rows) {
    if (!r.holiday) continue;
    const worked = r.status === "present";
    if (r.holiday.type === "regular") {
      regHolidayPay += dailyRate * formula.regHolidayPremium; // premium (worked) or mandated pay (unworked)
    } else if (worked) {
      specialHolidayPay += dailyRate * formula.specialHolidayPremium;
    }
  }
  regHolidayPay = round2(regHolidayPay);
  specialHolidayPay = round2(specialHolidayPay);

  // Paid leave: approved paid-leave days paid at the daily rate (or 8h for hourly).
  const leavePay = round2((pay.type === "hourly" ? formula.hoursPerDay * hourlyRate : dailyRate) * summary.paidLeaveDays);

  // Allowances + recurring deductions (from the employee's record).
  const allowanceTaxable = round2(Math.max(0, inputs.allowanceTaxable ?? 0));
  const deMinimis = round2(Math.max(0, inputs.deMinimis ?? 0));
  // BIR de-minimis cap: the excess over the monthly cap is taxable (0 = no cap).
  const deMinimisTaxable = formula.deMinimisCap > 0 ? round2(Math.max(0, deMinimis - formula.deMinimisCap)) : 0;
  const otherDeductions = (inputs.otherDeductions ?? [])
    .filter((d) => d.amount > 0)
    .map((d) => ({ label: d.label, amount: round2(d.amount) }));
  const totalOtherDeductions = round2(otherDeductions.reduce((s, d) => s + d.amount, 0));

  // Taxable compensation excludes the non-taxable de-minimis allowance.
  const taxableComp = round2(basicPay + otPay + nightPay + regHolidayPay + specialHolidayPay + leavePay + allowanceTaxable + deMinimisTaxable);
  const grossPay = round2(basicPay + otPay + nightPay + regHolidayPay + specialHolidayPay + leavePay + allowanceTaxable + deMinimis);

  // Statutory contributions: SSS/Pag-IBIG on taxable monthly compensation,
  // PhilHealth on the basic salary component.
  const sss = sssContribution(taxableComp);
  const ph = philhealthContribution(basicPay);
  const pagibig = pagibigContribution(taxableComp);
  const totalContributions = round2(sss.ee + ph.ee + pagibig.ee);

  const taxableIncome = round2(Math.max(0, taxableComp - totalContributions));
  const withholdingTax = withholdingTaxMonthly(taxableIncome);

  const totalDeductions = round2(totalContributions + withholdingTax + totalOtherDeductions);
  const netPay = round2(grossPay - totalDeductions);

  const employerContributions = round2(sss.er + ph.er + pagibig.er);

  return {
    daysPresent: summary.present,
    paidLeaveDays: summary.paidLeaveDays,
    payType: pay.type,
    hourlyRate,
    dailyRate,
    regularHours,
    basicPay,
    otHours,
    otPay,
    nightHours,
    nightPay,
    regHolidayPay,
    specialHolidayPay,
    leavePay,
    allowanceTaxable,
    deMinimis,
    grossPay,
    sssEE: sss.ee,
    philhealthEE: ph.ee,
    pagibigEE: pagibig.ee,
    totalContributions,
    taxableIncome,
    withholdingTax,
    otherDeductions,
    totalOtherDeductions,
    totalDeductions,
    netPay,
    sssER: sss.er,
    sssEC: sss.ec,
    philhealthER: ph.er,
    pagibigER: pagibig.er,
    employerContributions,
    thirteenthMonthAccrual: round2(basicPay / 12),
  };
}

// Compute a payslip for one pay PERIOD (semi-monthly / weekly). Earnings are the
// period's actual worked days; statutory deductions, tax, and allowances are the
// monthly figures scaled by the period's factors.
export function computePeriodPayslip(
  monthlyDtr: Dtr,
  pay: PayBasis,
  inputs: PayInputs,
  formula: PayFormula,
  period: PayPeriod,
): Payslip {
  // Whole month for the monthly-basis deductions; the slice for period earnings.
  const monthly = computePayslip(monthlyDtr, pay, inputs, formula);
  if (period.fromDay <= 1 && period.deductionFactor === 1 && period.allowanceFactor === 1) {
    return monthly; // whole-month period
  }
  const earn = computePayslip(sliceDtr(monthlyDtr, period.fromDay, period.toDay), pay, {}, formula);
  const df = period.deductionFactor;
  const af = period.allowanceFactor;

  const allowanceTaxable = round2(monthly.allowanceTaxable * af);
  const deMinimis = round2(monthly.deMinimis * af);
  const grossPay = round2(
    earn.basicPay + earn.otPay + earn.nightPay + earn.regHolidayPay + earn.specialHolidayPay + earn.leavePay + allowanceTaxable + deMinimis,
  );

  const sssEE = round2(monthly.sssEE * df);
  const philhealthEE = round2(monthly.philhealthEE * df);
  const pagibigEE = round2(monthly.pagibigEE * df);
  const totalContributions = round2(sssEE + philhealthEE + pagibigEE);
  const withholdingTax = round2(monthly.withholdingTax * df);
  const otherDeductions = monthly.otherDeductions
    .map((d) => ({ label: d.label, amount: round2(d.amount * df) }))
    .filter((d) => d.amount > 0);
  const totalOtherDeductions = round2(otherDeductions.reduce((s, d) => s + d.amount, 0));
  const totalDeductions = round2(totalContributions + withholdingTax + totalOtherDeductions);

  return {
    daysPresent: earn.daysPresent,
    paidLeaveDays: earn.paidLeaveDays,
    payType: earn.payType,
    hourlyRate: earn.hourlyRate,
    dailyRate: earn.dailyRate,
    regularHours: earn.regularHours,
    basicPay: earn.basicPay,
    otHours: earn.otHours,
    otPay: earn.otPay,
    nightHours: earn.nightHours,
    nightPay: earn.nightPay,
    regHolidayPay: earn.regHolidayPay,
    specialHolidayPay: earn.specialHolidayPay,
    leavePay: earn.leavePay,
    allowanceTaxable,
    deMinimis,
    grossPay,
    sssEE,
    philhealthEE,
    pagibigEE,
    totalContributions,
    taxableIncome: round2(monthly.taxableIncome * df),
    withholdingTax,
    otherDeductions,
    totalOtherDeductions,
    totalDeductions,
    netPay: round2(grossPay - totalDeductions),
    sssER: round2(monthly.sssER * df),
    sssEC: round2(monthly.sssEC * df),
    philhealthER: round2(monthly.philhealthER * df),
    pagibigER: round2(monthly.pagibigER * df),
    employerContributions: round2(monthly.employerContributions * df),
    thirteenthMonthAccrual: round2(earn.basicPay / 12),
  };
}

export function peso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
