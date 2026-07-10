import { collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc } from "firebase/firestore";

import { AccessRole } from "@/lib/auth";
import { db } from "@/lib/firebase";

// HR employee master ("201 file"). Backed by the same `employees/{ID}` docs the
// rest of the app reads, extended with HR fields (department, hire date, daily
// rate, status) that seed the Org and Payroll modules.

export type EmployeeStatus = "active" | "inactive";

export type EmployeeMaster = {
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  position: string; // job title — stored as `role` on the doc
  department: string;
  companyId: string | null;
  brandId: string | null;
  branchId: string | null;
  branchName: string | null;
  accessRole: AccessRole;
  hireDate: string | null; // YYYY-MM-DD
  dailyRate: number | null; // ₱ per day, for Payroll
  status: EmployeeStatus;
  createdAt: Date | null;
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function tsToDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value && typeof value === "object" && "seconds" in value) {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return null;
}

function toMaster(id: string, data: Record<string, unknown>): EmployeeMaster {
  const firstName = str(data.firstName);
  const lastName = str(data.lastName);
  return {
    employeeId: id,
    firstName,
    lastName,
    fullName: str(data.fullName) || `${firstName} ${lastName}`.trim() || id,
    email: str(data.email),
    phone: str(data.phone),
    position: str(data.role, "Staff"),
    department: str(data.department),
    companyId: typeof data.companyId === "string" ? data.companyId : null,
    brandId: typeof data.brandId === "string" ? data.brandId : null,
    branchId: typeof data.branchId === "string" ? data.branchId : null,
    branchName: typeof data.branchName === "string" ? data.branchName : null,
    accessRole: str(data.accessRole, "staff") as AccessRole,
    hireDate: typeof data.hireDate === "string" ? data.hireDate : null,
    dailyRate: typeof data.dailyRate === "number" ? data.dailyRate : null,
    status: data.status === "inactive" ? "inactive" : "active",
    createdAt: tsToDate(data.createdAt),
  };
}

export function blankEmployee(): EmployeeMaster {
  return {
    employeeId: "",
    firstName: "",
    lastName: "",
    fullName: "",
    email: "",
    phone: "",
    position: "",
    department: "",
    companyId: null,
    brandId: null,
    branchId: null,
    branchName: null,
    accessRole: "staff",
    hireDate: null,
    dailyRate: null,
    status: "active",
    createdAt: null,
  };
}

// Real-time roster of full employee master records, sorted by name.
export function subscribeEmployeeMasters(
  onChange: (employees: EmployeeMaster[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    query(collection(db, "employees")),
    (snapshot) => {
      const items = snapshot.docs.map((d) => toMaster(d.id, d.data() as Record<string, unknown>));
      items.sort((a, b) => a.fullName.localeCompare(b.fullName));
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}

// Create or update an employee master record. Preserves the auth `uid` and
// original `createdAt` (merge). Note: this manages the HR record only — a login
// account (Firebase Auth) is provisioned separately via sign-up / seed.
export async function saveEmployeeMaster(rec: EmployeeMaster, updatedBy: string): Promise<string> {
  const id = rec.employeeId.trim().toUpperCase();
  const fullName = `${rec.firstName.trim()} ${rec.lastName.trim()}`.trim() || id;
  const ref = doc(db, "employees", id);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      firstName: rec.firstName.trim(),
      lastName: rec.lastName.trim(),
      fullName,
      email: rec.email.trim().toLowerCase(),
      phone: rec.phone.trim(),
      role: rec.position.trim() || "Staff",
      department: rec.department.trim(),
      companyId: rec.companyId,
      brandId: rec.brandId,
      branchId: rec.branchId,
      branchName: rec.branchName,
      accessRole: rec.accessRole,
      hireDate: rec.hireDate,
      dailyRate: rec.dailyRate,
      status: rec.status,
      updatedBy,
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  return id;
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  await deleteDoc(doc(db, "employees", employeeId.trim().toUpperCase()));
}
