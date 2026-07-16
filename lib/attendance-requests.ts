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
  where,
} from "firebase/firestore";

import { EmployeeProfile } from "@/lib/attendance";
import { db } from "@/lib/firebase";

// Employee-filed attendance requests: overtime (pre-)filing and DTR corrections
// (missed / wrong punch). Mirrors the leaves workflow: file → pending → a
// manager approves or rejects. Kept separate from the raw biometric punches so
// the audit trail is clear.

export type RequestKind = "overtime" | "correction";
export type RequestStatus = "pending" | "approved" | "rejected";

export type AttendanceRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  kind: RequestKind;
  date: string; // YYYY-MM-DD
  hours: number | null; // overtime hours requested
  correctIn: string | null; // HH:MM corrected time-in
  correctOut: string | null; // HH:MM corrected time-out
  reason: string;
  status: RequestStatus;
  reviewedBy: string | null;
  createdAt: Date | null;
};

function tsToDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v && typeof v === "object" && "seconds" in v) return new Timestamp((v as { seconds: number }).seconds, 0).toDate();
  return null;
}

function toRequest(id: string, d: Record<string, unknown>): AttendanceRequest {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id,
    employeeId: s(d.employeeId),
    employeeName: s(d.employeeName) || "Employee",
    branchId: typeof d.branchId === "string" ? d.branchId : null,
    branchName: typeof d.branchName === "string" ? d.branchName : null,
    kind: d.kind === "correction" ? "correction" : "overtime",
    date: s(d.date),
    hours: typeof d.hours === "number" ? d.hours : null,
    correctIn: typeof d.correctIn === "string" ? d.correctIn : null,
    correctOut: typeof d.correctOut === "string" ? d.correctOut : null,
    reason: s(d.reason),
    status: (["pending", "approved", "rejected"].includes(d.status as string) ? d.status : "pending") as RequestStatus,
    reviewedBy: typeof d.reviewedBy === "string" ? d.reviewedBy : null,
    createdAt: tsToDate(d.createdAt),
  };
}

export async function fileAttendanceRequest(
  employee: EmployeeProfile,
  input: { kind: RequestKind; date: string; hours?: number | null; correctIn?: string | null; correctOut?: string | null; reason: string },
) {
  await addDoc(collection(db, "attendanceRequests"), {
    employeeId: employee.employeeId,
    employeeName: employee.fullName,
    branchId: employee.branchId,
    branchName: employee.branchName,
    kind: input.kind,
    date: input.date,
    hours: input.hours ?? null,
    correctIn: input.correctIn ?? null,
    correctOut: input.correctOut ?? null,
    reason: input.reason.trim(),
    status: "pending",
    reviewedBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function byRecency(a: AttendanceRequest, b: AttendanceRequest) {
  return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
}

export function subscribeMyRequests(employeeId: string, cb: (r: AttendanceRequest[]) => void, onErr?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "attendanceRequests"), where("employeeId", "==", employeeId), limit(100)),
    (snap) => cb(snap.docs.map((d) => toRequest(d.id, d.data() as Record<string, unknown>)).sort(byRecency)),
    (e) => onErr?.(e as Error),
  );
}

export function subscribePendingRequests(cb: (r: AttendanceRequest[]) => void, onErr?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "attendanceRequests"), where("status", "==", "pending"), limit(200)),
    (snap) => cb(snap.docs.map((d) => toRequest(d.id, d.data() as Record<string, unknown>)).sort(byRecency)),
    (e) => onErr?.(e as Error),
  );
}

export function subscribeAllRequests(cb: (r: AttendanceRequest[]) => void, onErr?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "attendanceRequests"), limit(300)),
    (snap) => cb(snap.docs.map((d) => toRequest(d.id, d.data() as Record<string, unknown>)).sort(byRecency)),
    (e) => onErr?.(e as Error),
  );
}

export async function reviewAttendanceRequest(id: string, decision: Exclude<RequestStatus, "pending">, reviewer: string) {
  await updateDoc(doc(db, "attendanceRequests", id), {
    status: decision,
    reviewedBy: reviewer,
    updatedAt: serverTimestamp(),
  });
}
