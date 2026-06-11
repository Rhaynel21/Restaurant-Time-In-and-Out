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

export type LeaveType = "vacation" | "sick" | "emergency" | "unpaid";
export type LeaveStatus = "pending" | "approved" | "rejected";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  type: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  days: number;
  reason: string;
  status: LeaveStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: Date | null;
};

export const LEAVE_TYPES: { key: LeaveType; label: string; icon: string; tint: string }[] = [
  { key: "vacation", label: "Vacation", icon: "umbrella-beach", tint: "#059669" },
  { key: "sick", label: "Sick", icon: "medical-bag", tint: "#3B82F6" },
  { key: "emergency", label: "Emergency", icon: "alarm-light-outline", tint: "#DC2626" },
  { key: "unpaid", label: "Unpaid", icon: "cash-remove", tint: "#92400E" },
];

const APPROVER_ROLE = /(manager|admin|supervisor|owner|head)/i;

// Anyone whose role names a leadership keyword can review leave requests. To make
// someone an approver, set their `role` in the Firestore `employees` doc to
// include e.g. "Manager" / "Branch Supervisor" / "Admin".
export function isApprover(employee: Pick<EmployeeProfile, "role"> | null | undefined) {
  return !!employee?.role && APPROVER_ROLE.test(employee.role);
}

// ── Date helpers (work in local time, store as YYYY-MM-DD) ───────────────────
export function toYMD(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromYMD(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function countDays(startYMD: string, endYMD: string) {
  const start = fromYMD(startYMD).getTime();
  const end = fromYMD(endYMD).getTime();
  if (end < start) return 0;
  return Math.round((end - start) / 86400000) + 1; // inclusive
}

export function formatRange(startYMD: string, endYMD: string) {
  const start = fromYMD(startYMD);
  const end = fromYMD(endYMD);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (startYMD === endYMD) {
    return start.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  })}${sameYear ? "" : ""}`;
}

function timestampToDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "seconds" in value) {
    return new Timestamp((value as { seconds: number }).seconds, 0).toDate();
  }
  return null;
}

function toLeaveRequest(id: string, data: Record<string, unknown>): LeaveRequest {
  return {
    id,
    employeeId: typeof data.employeeId === "string" ? data.employeeId : "",
    employeeName: typeof data.employeeName === "string" ? data.employeeName : "Employee",
    branchId: typeof data.branchId === "string" ? data.branchId : null,
    branchName: typeof data.branchName === "string" ? data.branchName : null,
    type: (typeof data.type === "string" ? data.type : "vacation") as LeaveType,
    startDate: typeof data.startDate === "string" ? data.startDate : "",
    endDate: typeof data.endDate === "string" ? data.endDate : "",
    days: typeof data.days === "number" ? data.days : 0,
    reason: typeof data.reason === "string" ? data.reason : "",
    status: (typeof data.status === "string" ? data.status : "pending") as LeaveStatus,
    reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : null,
    reviewNote: typeof data.reviewNote === "string" ? data.reviewNote : null,
    createdAt: timestampToDate(data.createdAt),
  };
}

// File a new leave request (status starts as "pending").
export async function fileLeave(
  employee: EmployeeProfile,
  input: { type: LeaveType; startDate: string; endDate: string; reason: string },
) {
  const days = countDays(input.startDate, input.endDate);
  await addDoc(collection(db, "leaves"), {
    employeeId: employee.employeeId,
    employeeName: employee.fullName,
    branchId: employee.branchId,
    branchName: employee.branchName,
    type: input.type,
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    reason: input.reason.trim(),
    status: "pending",
    reviewedBy: null,
    reviewNote: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function sortByRecency(a: LeaveRequest, b: LeaveRequest) {
  const at = a.createdAt ? a.createdAt.getTime() : fromYMD(a.startDate).getTime();
  const bt = b.createdAt ? b.createdAt.getTime() : fromYMD(b.startDate).getTime();
  return bt - at;
}

// Real-time stream of one employee's own requests.
export function subscribeMyLeaves(
  employeeId: string,
  onChange: (leaves: LeaveRequest[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "leaves"), where("employeeId", "==", employeeId), limit(100));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => toLeaveRequest(d.id, d.data() as Record<string, unknown>));
      items.sort(sortByRecency);
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}

// Real-time queue of all pending requests (for approvers).
export function subscribePendingLeaves(
  onChange: (leaves: LeaveRequest[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "leaves"), where("status", "==", "pending"), limit(200));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => toLeaveRequest(d.id, d.data() as Record<string, unknown>));
      items.sort((a, b) => {
        // Oldest pending first (FIFO for review).
        const at = a.createdAt ? a.createdAt.getTime() : fromYMD(a.startDate).getTime();
        const bt = b.createdAt ? b.createdAt.getTime() : fromYMD(b.startDate).getTime();
        return at - bt;
      });
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}

// Approve or reject a request.
export async function reviewLeave(
  leaveId: string,
  decision: Exclude<LeaveStatus, "pending">,
  reviewerName: string,
  note?: string,
) {
  await updateDoc(doc(db, "leaves", leaveId), {
    status: decision,
    reviewedBy: reviewerName,
    reviewNote: note?.trim() || null,
    updatedAt: serverTimestamp(),
  });
}
