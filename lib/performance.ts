import {
  Timestamp,
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { logAudit } from "@/lib/audit";
import { db } from "@/lib/firebase";
import { notify } from "@/lib/notifications";

// Performance management — three record kinds:
//   appraisals         — periodic reviews scored against weighted KPIs
//   disciplinaryActions — incident / corrective-action records

// ── KPI criteria (restaurant-appropriate defaults) ──
export const DEFAULT_KPIS = [
  "Quality of Work",
  "Productivity",
  "Punctuality & Attendance",
  "Teamwork",
  "Customer Service",
];

export type AppraisalStatus = "draft" | "final";
export type KpiScore = { name: string; score: number }; // score 1..5

export type Appraisal = {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string; // e.g. "2026 H1"
  reviewer: string;
  kpis: KpiScore[];
  overall: number; // average of KPI scores, 1..5
  strengths: string;
  improvements: string;
  status: AppraisalStatus;
  createdAt: Date | null;
};

export const DISCIPLINE_TYPES = [
  "Verbal Warning",
  "Written Warning",
  "Final Warning",
  "Suspension",
  "Termination",
];

export type DisciplineStatus = "open" | "resolved";
export type DisciplinaryAction = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  incidentDate: string; // YYYY-MM-DD
  description: string;
  action: string; // corrective action taken
  status: DisciplineStatus;
  issuedBy: string;
  createdAt: Date | null;
};

export function ratingLabel(overall: number): string {
  if (overall >= 4.5) return "Outstanding";
  if (overall >= 3.5) return "Exceeds Expectations";
  if (overall >= 2.5) return "Meets Expectations";
  if (overall >= 1.5) return "Needs Improvement";
  if (overall > 0) return "Unsatisfactory";
  return "Unrated";
}

function tsToDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v && typeof v === "object" && "seconds" in v) return new Timestamp((v as { seconds: number }).seconds, 0).toDate();
  return null;
}
function s(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function avg(scores: KpiScore[]): number {
  if (!scores.length) return 0;
  return Math.round((scores.reduce((t, k) => t + k.score, 0) / scores.length) * 100) / 100;
}

// ── Appraisals ───────────────────────────────────────────────────────────────
export async function createAppraisal(
  data: { employeeId: string; employeeName: string; period: string; reviewer: string; kpis: KpiScore[]; strengths: string; improvements: string; status: AppraisalStatus },
  actor = "System",
) {
  const overall = avg(data.kpis);
  const ref = await addDoc(collection(db, "appraisals"), {
    ...data,
    overall,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logAudit("create", "appraisal", ref.id, `Appraisal for ${data.employeeName} (${data.period}) — ${ratingLabel(overall)}`, actor);
  if (data.status === "final") {
    notify(data.employeeId, "Performance review", `Your ${data.period} appraisal is ready: ${ratingLabel(overall)} (${overall.toFixed(2)}/5).`);
  }
}

export async function finalizeAppraisal(a: Appraisal, actor = "System") {
  await updateDoc(doc(db, "appraisals", a.id), { status: "final", updatedAt: serverTimestamp() });
  logAudit("finalize", "appraisal", a.id, `Finalized appraisal for ${a.employeeName} (${a.period})`, actor);
  notify(a.employeeId, "Performance review", `Your ${a.period} appraisal is ready: ${ratingLabel(a.overall)} (${a.overall.toFixed(2)}/5).`);
}

export function subscribeAppraisals(onChange: (rows: Appraisal[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "appraisals"), limit(500)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const kpis = Array.isArray(x.kpis)
          ? (x.kpis as unknown[]).map((k) => {
              const o = (k && typeof k === "object" ? k : {}) as Record<string, unknown>;
              return { name: s(o.name), score: typeof o.score === "number" ? o.score : 0 };
            })
          : [];
        return {
          id: d.id,
          employeeId: s(x.employeeId),
          employeeName: s(x.employeeName, "Employee"),
          period: s(x.period),
          reviewer: s(x.reviewer),
          kpis,
          overall: typeof x.overall === "number" ? x.overall : avg(kpis),
          strengths: s(x.strengths),
          improvements: s(x.improvements),
          status: x.status === "final" ? "final" : "draft",
          createdAt: tsToDate(x.createdAt),
        } as Appraisal;
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}

// ── Disciplinary actions ─────────────────────────────────────────────────────
export async function createDisciplinaryAction(
  data: { employeeId: string; employeeName: string; type: string; incidentDate: string; description: string; action: string; issuedBy: string },
  actor = "System",
) {
  const ref = await addDoc(collection(db, "disciplinaryActions"), {
    ...data,
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logAudit("create", "discipline", ref.id, `${data.type} issued to ${data.employeeName}`, actor);
  notify(data.employeeId, "HR notice", `A ${data.type.toLowerCase()} has been recorded on your file. Please see HR.`);
}

export async function resolveDisciplinaryAction(d: DisciplinaryAction, actor = "System") {
  await updateDoc(doc(db, "disciplinaryActions", d.id), { status: "resolved", updatedAt: serverTimestamp() });
  logAudit("resolve", "discipline", d.id, `Resolved ${d.type} for ${d.employeeName}`, actor);
}

export function subscribeDisciplinaryActions(onChange: (rows: DisciplinaryAction[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "disciplinaryActions"), limit(500)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          employeeId: s(x.employeeId),
          employeeName: s(x.employeeName, "Employee"),
          type: s(x.type, "Verbal Warning"),
          incidentDate: s(x.incidentDate),
          description: s(x.description),
          action: s(x.action),
          status: x.status === "resolved" ? "resolved" : "open",
          issuedBy: s(x.issuedBy),
          createdAt: tsToDate(x.createdAt),
        } as DisciplinaryAction;
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}
