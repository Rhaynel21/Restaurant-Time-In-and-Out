import { collection, onSnapshot, query } from "firebase/firestore";

import { AccessRole } from "@/lib/auth";
import { db } from "@/lib/firebase";

// A lightweight employee record for manager-side pickers and rosters. (The full
// profile type lives in lib/attendance as EmployeeProfile.)
export type EmployeeSummary = {
  employeeId: string;
  fullName: string;
  email: string;
  role: string; // job title
  accessRole: AccessRole;
  branchId: string | null;
  branchName: string | null;
};

function toSummary(id: string, data: Record<string, unknown>): EmployeeSummary {
  return {
    employeeId: id,
    fullName: typeof data.fullName === "string" && data.fullName ? data.fullName : id,
    email: typeof data.email === "string" ? data.email : "",
    role: typeof data.role === "string" ? data.role : "Staff",
    accessRole: (typeof data.accessRole === "string" ? data.accessRole : "staff") as AccessRole,
    branchId: typeof data.branchId === "string" ? data.branchId : null,
    branchName: typeof data.branchName === "string" ? data.branchName : null,
  };
}

// Real-time roster of all employees, sorted by name. Returns an unsubscribe fn.
export function subscribeEmployees(
  onChange: (employees: EmployeeSummary[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    query(collection(db, "employees")),
    (snapshot) => {
      const items = snapshot.docs.map((d) => toSummary(d.id, d.data() as Record<string, unknown>));
      items.sort((a, b) => a.fullName.localeCompare(b.fullName));
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}
