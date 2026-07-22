import { collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc } from "firebase/firestore";

import { logAudit } from "@/lib/audit";
import { AccessRole } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { Loan, coerceLoans } from "@/lib/loans";

// HR employee master ("201 file"). Backed by the same `employees/{ID}` docs the
// rest of the app reads, extended with HR fields (department, hire date, daily
// rate, status) that seed the Org and Payroll modules.

export type EmployeeStatus = "active" | "inactive";
export type PayType = "daily" | "hourly";
export type Gender = "" | "male" | "female" | "other";
export type CivilStatus = "" | "single" | "married" | "widowed" | "separated";

// Employment classification (WM-PM-01 §4). Drives payroll eligibility.
export type WorkerType = "regular" | "probationary" | "parttime" | "agency" | "ojt" | "apprentice";
export const WORKER_TYPES: { value: WorkerType; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "probationary", label: "Probationary" },
  { value: "parttime", label: "Part-time" },
  { value: "agency", label: "Agency (contractual)" },
  { value: "ojt", label: "OJT / Intern" },
  { value: "apprentice", label: "Apprentice (TESDA)" },
];
// Agency Personnel are the manning agency's payroll responsibility (DOLE DO 174 /
// WM-PM-05): excluded from payroll runs, payslips, bank files, and government
// reports — but STILL recorded on timekeeping. This is the hard PM-05 rule and is
// independent of the (blocked) service-charge agency-coverage toggle (ISS-02).
export function isPayrollExcluded(e: { workerType: WorkerType }): boolean {
  return e.workerType === "agency";
}

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
  branchIds: string[]; // area managers cover several branches
  branchName: string | null;
  accessRole: AccessRole;
  workerType: WorkerType; // employment classification (agency = payroll-excluded)
  hireDate: string | null; // YYYY-MM-DD
  // ── Payroll: pay basis + rates ──
  payType: PayType; // "daily" → rate × days present; "hourly" → rate × hours worked
  dailyRate: number | null; // ₱ per day
  hourlyRate: number | null; // ₱ per hour (used when payType = "hourly")
  // ── Payroll: monthly allowances & recurring deductions ──
  allowanceTaxable: number; // taxable allowance (added to gross + tax base)
  deMinimis: number; // non-taxable / de-minimis allowance (gross only)
  sssLoan: number; // monthly SSS salary-loan amortization
  pagibigLoan: number; // monthly Pag-IBIG loan amortization
  cashAdvance: number; // cash advance / other recurring deduction
  loans: Loan[]; // amortizing loans with a derived running balance
  status: EmployeeStatus;
  // ── 201 file: personal details ──
  birthDate: string | null; // YYYY-MM-DD
  gender: Gender;
  civilStatus: CivilStatus;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  // ── 201 file: PH government IDs ──
  sss: string; // SSS number
  philhealth: string; // PhilHealth number
  pagibig: string; // Pag-IBIG (HDMF) number
  tin: string; // BIR TIN
  // ── Payroll disbursement ──
  bankName: string;
  bankAccount: string;
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
    branchIds: Array.isArray(data.branchIds) ? data.branchIds.filter((x): x is string => typeof x === "string") : [],
    branchName: typeof data.branchName === "string" ? data.branchName : null,
    accessRole: str(data.accessRole, "staff") as AccessRole,
    workerType: (WORKER_TYPES.some((t) => t.value === data.workerType) ? data.workerType : "regular") as WorkerType,
    hireDate: typeof data.hireDate === "string" ? data.hireDate : null,
    payType: data.payType === "hourly" ? "hourly" : "daily",
    dailyRate: typeof data.dailyRate === "number" ? data.dailyRate : null,
    hourlyRate: typeof data.hourlyRate === "number" ? data.hourlyRate : null,
    allowanceTaxable: typeof data.allowanceTaxable === "number" ? data.allowanceTaxable : 0,
    deMinimis: typeof data.deMinimis === "number" ? data.deMinimis : 0,
    sssLoan: typeof data.sssLoan === "number" ? data.sssLoan : 0,
    pagibigLoan: typeof data.pagibigLoan === "number" ? data.pagibigLoan : 0,
    cashAdvance: typeof data.cashAdvance === "number" ? data.cashAdvance : 0,
    loans: coerceLoans(data.loans),
    status: data.status === "inactive" ? "inactive" : "active",
    birthDate: typeof data.birthDate === "string" ? data.birthDate : null,
    gender: (["male", "female", "other"].includes(data.gender as string) ? data.gender : "") as Gender,
    civilStatus: (["single", "married", "widowed", "separated"].includes(data.civilStatus as string)
      ? data.civilStatus
      : "") as CivilStatus,
    address: str(data.address),
    emergencyContactName: str(data.emergencyContactName),
    emergencyContactPhone: str(data.emergencyContactPhone),
    sss: str(data.sss),
    philhealth: str(data.philhealth),
    pagibig: str(data.pagibig),
    tin: str(data.tin),
    bankName: str(data.bankName),
    bankAccount: str(data.bankAccount),
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
    branchIds: [],
    branchName: null,
    accessRole: "staff",
    workerType: "regular",
    hireDate: null,
    payType: "daily",
    dailyRate: null,
    hourlyRate: null,
    allowanceTaxable: 0,
    deMinimis: 0,
    sssLoan: 0,
    pagibigLoan: 0,
    cashAdvance: 0,
    loans: [],
    status: "active",
    birthDate: null,
    gender: "",
    civilStatus: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    sss: "",
    philhealth: "",
    pagibig: "",
    tin: "",
    bankName: "",
    bankAccount: "",
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

// Live subscription to a single employee's master record (for self-service).
export function subscribeEmployeeMaster(
  employeeId: string,
  onChange: (employee: EmployeeMaster | null) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, "employees", employeeId),
    (snap) => onChange(snap.exists() ? toMaster(snap.id, snap.data() as Record<string, unknown>) : null),
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
      branchIds: rec.branchIds,
      branchName: rec.branchName,
      accessRole: rec.accessRole,
      workerType: rec.workerType,
      hireDate: rec.hireDate,
      payType: rec.payType,
      dailyRate: rec.dailyRate,
      hourlyRate: rec.hourlyRate,
      allowanceTaxable: rec.allowanceTaxable,
      deMinimis: rec.deMinimis,
      sssLoan: rec.sssLoan,
      pagibigLoan: rec.pagibigLoan,
      cashAdvance: rec.cashAdvance,
      loans: rec.loans,
      status: rec.status,
      birthDate: rec.birthDate,
      gender: rec.gender,
      civilStatus: rec.civilStatus,
      address: rec.address.trim(),
      emergencyContactName: rec.emergencyContactName.trim(),
      emergencyContactPhone: rec.emergencyContactPhone.trim(),
      sss: rec.sss.trim(),
      philhealth: rec.philhealth.trim(),
      pagibig: rec.pagibig.trim(),
      tin: rec.tin.trim(),
      bankName: rec.bankName.trim(),
      bankAccount: rec.bankAccount.trim(),
      updatedBy,
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  logAudit("save", "employee", id, `${fullName || id} record saved`, updatedBy);
  return id;
}

export async function deleteEmployee(employeeId: string, actor = "System"): Promise<void> {
  const id = employeeId.trim().toUpperCase();
  await deleteDoc(doc(db, "employees", id));
  logAudit("delete", "employee", id, `Employee ${id} deleted`, actor);
}
