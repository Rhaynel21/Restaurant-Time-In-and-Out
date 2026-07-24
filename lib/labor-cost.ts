import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

// Step 8 of the Klicc Staff Management Flow — "Owner Insight: Labor Cost Ratio".
//   ratio = (gross payroll + employer contributions) / POS revenue
// Casual-dining benchmark is 18–22%. Labor cost is captured from a released
// payroll run (Step 7). Revenue comes from the POS feed (`pos_daily`, Phase 1
// via the API bridge) or a manual monthly figure the owner types when the POS
// isn't wired yet.

const COLL = "labor_cost";

export type LaborCost = {
  companyId: string;
  month: string; // "YYYY-MM"
  grossPayroll: number;
  employerContributions: number;
  manualRevenue: number | null; // owner-entered fallback when POS isn't connected
};

export const laborCostId = (companyId: string, month: string) => `${companyId || "_"}_${month}`;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fromDoc(id: string, data: Record<string, unknown>): LaborCost {
  const sep = id.indexOf("_");
  const cutoffTotals = data.cutoffTotals && typeof data.cutoffTotals === "object"
    ? Object.values(data.cutoffTotals as Record<string, unknown>)
    : [];
  const cutoffGross = cutoffTotals.reduce<number>((sum, value) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return sum + num(row.grossPayroll);
  }, 0);
  const cutoffEmployer = cutoffTotals.reduce<number>((sum, value) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return sum + num(row.employerContributions);
  }, 0);
  return {
    companyId: typeof data.companyId === "string" ? data.companyId : id.slice(0, sep),
    month: typeof data.month === "string" ? data.month : id.slice(sep + 1),
    grossPayroll: cutoffTotals.length ? cutoffGross : num(data.grossPayroll),
    employerContributions: cutoffTotals.length ? cutoffEmployer : num(data.employerContributions),
    manualRevenue: typeof data.manualRevenue === "number" ? data.manualRevenue : null,
  };
}

export function laborCostTotal(lc: Pick<LaborCost, "grossPayroll" | "employerContributions">): number {
  return lc.grossPayroll + lc.employerContributions;
}

// ratio as a percentage (e.g. 20.5), or null when revenue is unknown/zero.
export function laborCostRatioPct(laborCost: number, revenue: number): number | null {
  if (!revenue || revenue <= 0) return null;
  return (laborCost / revenue) * 100;
}

export type RatioVerdict = "under" | "within" | "over";
export function ratioVerdict(pct: number, low = 18, high = 22): RatioVerdict {
  if (pct < low) return "under";
  if (pct > high) return "over";
  return "within";
}

export function subscribeLaborCost(
  companyId: string | null,
  month: string,
  onChange: (lc: LaborCost | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, COLL, laborCostId(companyId ?? "", month)),
    (snap) => onChange(snap.exists() ? fromDoc(snap.id, snap.data() as Record<string, unknown>) : null),
    (e) => onError?.(e as Error),
  );
}

// Written when a payroll run is released (Step 7) so the insight has real numbers.
export async function saveLaborCost(
  companyId: string | null,
  month: string,
  totals: { grossPayroll: number; employerContributions: number },
) {
  await setDoc(
    doc(db, COLL, laborCostId(companyId ?? "", month)),
    { companyId: companyId ?? "", month, grossPayroll: totals.grossPayroll, employerContributions: totals.employerContributions, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// Owner-entered monthly revenue fallback (used until the POS API is connected).
export async function setManualRevenue(companyId: string | null, month: string, revenue: number | null) {
  await setDoc(
    doc(db, COLL, laborCostId(companyId ?? "", month)),
    { companyId: companyId ?? "", month, manualRevenue: revenue, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// A low-cardinality feed of every month's labor-cost record for a company.
export function subscribeCompanyLaborCosts(companyId: string | null, onChange: (rows: LaborCost[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    collection(db, COLL),
    (snap) =>
      onChange(
        snap.docs
          .map((d) => fromDoc(d.id, d.data() as Record<string, unknown>))
          .filter((r) => !companyId || r.companyId === companyId),
      ),
    (e) => onError?.(e as Error),
  );
}
