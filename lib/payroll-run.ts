import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

// Step 7 of the Klicc Staff Management Flow — "Approve & Release". A payroll run
// moves through: draft → approved → released. HR computes a draft; a manager/owner
// approves it; releasing generates the bank file and unlocks payslips. Tracking
// the run status here means the Bank File export is gated on release, and a
// released run is a durable record of who approved and released it.

const COLL = "payroll_runs";

export type RunStatus = "draft" | "approved" | "released";

export type PayrollRun = {
  companyId: string;
  period: string; // "YYYY-MM"
  periodKey: string; // cutoff within the month ("full", "1", "2", …)
  status: RunStatus;
  approvedBy: string | null;
  releasedBy: string | null;
};

export const payrollRunId = (companyId: string, period: string, periodKey: string) =>
  `${companyId || "_"}_${period}_${periodKey || "full"}`;

function fromDoc(data: Record<string, unknown>): PayrollRun {
  const status = data.status === "released" ? "released" : data.status === "approved" ? "approved" : "draft";
  return {
    companyId: typeof data.companyId === "string" ? data.companyId : "",
    period: typeof data.period === "string" ? data.period : "",
    periodKey: typeof data.periodKey === "string" ? data.periodKey : "full",
    status,
    approvedBy: typeof data.approvedBy === "string" ? data.approvedBy : null,
    releasedBy: typeof data.releasedBy === "string" ? data.releasedBy : null,
  };
}

// Real-time status for one run (draft until the doc exists).
export function subscribePayrollRun(
  companyId: string | null,
  period: string,
  periodKey: string,
  onChange: (run: PayrollRun) => void,
  onError?: (e: Error) => void,
) {
  const empty: PayrollRun = { companyId: companyId ?? "", period, periodKey: periodKey || "full", status: "draft", approvedBy: null, releasedBy: null };
  return onSnapshot(
    doc(db, COLL, payrollRunId(companyId ?? "", period, periodKey)),
    (snap) => onChange(snap.exists() ? fromDoc(snap.data() as Record<string, unknown>) : empty),
    (e) => onError?.(e as Error),
  );
}

async function writeStatus(companyId: string | null, period: string, periodKey: string, patch: Record<string, unknown>) {
  await setDoc(
    doc(db, COLL, payrollRunId(companyId ?? "", period, periodKey)),
    { companyId: companyId ?? "", period, periodKey: periodKey || "full", ...patch, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function approveRun(companyId: string | null, period: string, periodKey: string, approvedBy: string) {
  await writeStatus(companyId, period, periodKey, { status: "approved", approvedBy, approvedAt: serverTimestamp() });
}
export async function releaseRun(companyId: string | null, period: string, periodKey: string, releasedBy: string) {
  await writeStatus(companyId, period, periodKey, { status: "released", releasedBy, releasedAt: serverTimestamp() });
}
export async function reopenRun(companyId: string | null, period: string, periodKey: string) {
  await writeStatus(companyId, period, periodKey, { status: "draft", approvedBy: null, releasedBy: null });
}

// A low-cardinality feed of every run for a company (for a future runs history view).
export function subscribeCompanyRuns(companyId: string | null, onChange: (runs: PayrollRun[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    collection(db, COLL),
    (snap) =>
      onChange(
        snap.docs
          .map((d) => fromDoc(d.data() as Record<string, unknown>))
          .filter((r) => !companyId || r.companyId === companyId),
      ),
    (e) => onError?.(e as Error),
  );
}
