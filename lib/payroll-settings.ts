import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { DEFAULT_FORMULA, PayFormula } from "@/lib/ph-payroll";

// Payroll pay-formula settings are stored PER COMPANY (multi-tenant) as a
// `payrollFormula` map on the companies/{companyId} document — a path the app
// already has read/write access to — so no extra Firestore rule is required.

function coerce(data: unknown): PayFormula {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const freq =
    d.payFrequency === "semimonthly" || d.payFrequency === "weekly" ? d.payFrequency : DEFAULT_FORMULA.payFrequency;
  return {
    hoursPerDay: num(d.hoursPerDay, DEFAULT_FORMULA.hoursPerDay),
    otPremium: num(d.otPremium, DEFAULT_FORMULA.otPremium),
    nightDiff: num(d.nightDiff, DEFAULT_FORMULA.nightDiff),
    regHolidayPremium: num(d.regHolidayPremium, DEFAULT_FORMULA.regHolidayPremium),
    specialHolidayPremium: num(d.specialHolidayPremium, DEFAULT_FORMULA.specialHolidayPremium),
    payFrequency: freq,
    cutoffDay: Math.min(28, Math.max(1, Math.round(num(d.cutoffDay, DEFAULT_FORMULA.cutoffDay)))),
    contributionOn: d.contributionOn === "split" ? "split" : "second",
  };
}

// Live subscription to a company's pay formula. With no company (e.g. owner
// viewing everything) it just yields the Labor-Code defaults.
export function subscribePayrollFormula(
  companyId: string | null,
  onChange: (formula: PayFormula) => void,
  onError?: (error: Error) => void,
) {
  if (!companyId) {
    onChange(DEFAULT_FORMULA);
    return () => {};
  }
  return onSnapshot(
    doc(db, "companies", companyId),
    (snap) => onChange(coerce(snap.exists() ? (snap.data() as Record<string, unknown>).payrollFormula : null)),
    (error) => onError?.(error as Error),
  );
}

export async function savePayrollFormula(companyId: string, formula: PayFormula): Promise<void> {
  await setDoc(
    doc(db, "companies", companyId),
    { payrollFormula: formula, payrollFormulaUpdatedAt: serverTimestamp() },
    { merge: true },
  );
}
