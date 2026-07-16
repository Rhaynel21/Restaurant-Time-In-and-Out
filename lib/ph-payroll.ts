import { Dtr } from "@/lib/dtr";

// Philippine statutory payroll engine — DOLE pay rules + BIR/SSS/PhilHealth/
// Pag-IBIG deductions — turning a month's DTR into a full payslip (gross → net).
//
// ⚠️  RATES ARE AS OF 2025 and are provided for computation, NOT as tax/legal
// advice. Contribution tables and tax rules change (often yearly) — verify
// against the latest SSS / PhilHealth / HDMF circulars and BIR RR before filing
// or paying. All rate constants live at the top so they're easy to update.

export const PH_RATES_VERSION = "2025";

// Standard hours in a paid working day (DOLE) — used to derive the hourly rate.
const HOURS_PER_DAY = 8;

// DOLE premium multipliers (as a fraction ON TOP of the base hour/day).
const OT_PREMIUM = 0.25; // ordinary-day overtime: +25% of hourly
const NIGHT_DIFF = 0.10; // night differential (22:00–06:00): +10% of hourly
const REG_HOLIDAY_PREMIUM = 1.0; // regular holiday: +100% (200% when worked)
const SPECIAL_HOLIDAY_PREMIUM = 0.3; // special non-working day worked: +30%

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

export type Payslip = {
  // Earnings
  daysPresent: number;
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
export function computePayslip(dtr: Dtr, pay: PayBasis, inputs: PayInputs = {}): Payslip {
  const { summary, rows } = dtr;
  // Derive both rates from the 8-hour day so premiums work for either basis.
  const hourlyRate = pay.type === "hourly" ? round2(pay.hourlyRate) : round2(pay.dailyRate / HOURS_PER_DAY);
  const dailyRate = pay.type === "daily" ? round2(pay.dailyRate) : round2(pay.hourlyRate * HOURS_PER_DAY);

  // Daily-paid: rate × days present. Hourly-paid: rate × regular hours (worked
  // hours net of overtime, which is paid separately at a premium below).
  const regularHours = round2(Math.max(0, summary.totalMinutes - summary.otMinutes) / 60);
  const basicPay =
    pay.type === "hourly" ? round2(regularHours * hourlyRate) : round2(dailyRate * summary.present);
  const otHours = round2(summary.otMinutes / 60);
  // Overtime hours are beyond basic pay, so they're paid at the full 125%.
  const otPay = round2(otHours * hourlyRate * (1 + OT_PREMIUM));
  const nightHours = round2(summary.nightMinutes / 60);
  const nightPay = round2(nightHours * hourlyRate * NIGHT_DIFF);

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
      regHolidayPay += dailyRate * REG_HOLIDAY_PREMIUM; // premium (worked) or mandated pay (unworked)
    } else if (worked) {
      specialHolidayPay += dailyRate * SPECIAL_HOLIDAY_PREMIUM;
    }
  }
  regHolidayPay = round2(regHolidayPay);
  specialHolidayPay = round2(specialHolidayPay);

  // Allowances + recurring deductions (from the employee's record).
  const allowanceTaxable = round2(Math.max(0, inputs.allowanceTaxable ?? 0));
  const deMinimis = round2(Math.max(0, inputs.deMinimis ?? 0));
  const otherDeductions = (inputs.otherDeductions ?? [])
    .filter((d) => d.amount > 0)
    .map((d) => ({ label: d.label, amount: round2(d.amount) }));
  const totalOtherDeductions = round2(otherDeductions.reduce((s, d) => s + d.amount, 0));

  // Taxable compensation excludes the non-taxable de-minimis allowance.
  const taxableComp = round2(basicPay + otPay + nightPay + regHolidayPay + specialHolidayPay + allowanceTaxable);
  const grossPay = round2(taxableComp + deMinimis);

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

export function peso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
