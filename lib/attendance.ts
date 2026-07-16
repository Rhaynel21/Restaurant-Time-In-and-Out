import {
  Timestamp,
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { LocationPoint } from "@/lib/branches";
import { db } from "@/lib/firebase";
import {
  LocalAttendanceRecord,
  clearLastSignedInEmployee,
  ensureOfflineStoreInitialized,
  getRecentAttendanceLocal,
  getTodayAttendanceLocal,
  upsertAttendanceFromRemote,
} from "@/lib/offline-store";

export type EmployeeProfile = {
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: string; // job title / position (e.g. "Line Cook")
  companyId: string | null; // org scope: company assignment
  brandId: string | null; // org scope: brand assignment
  branchId: string | null;
  branchName: string | null;
  accessRole: "owner" | "staff" | "manager" | "hr" | "admin"; // app access level
};

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  // One unpaid meal break, inferred by the biometric bridge from scan order +
  // the scheduled break window. Both null when no break was taken/recorded.
  breakOutAt: Date | null; // left for break
  breakInAt: Date | null; // returned from break
  totalMinutes: number | null;
};

function timestampToDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "seconds" in value) {
    return new Timestamp((value as { seconds: number }).seconds, 0).toDate();
  }
  return null;
}

function startOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function toAttendanceRecord(record: LocalAttendanceRecord): AttendanceRecord {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    branchId: record.branchId,
    branchName: record.branchName,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    breakOutAt: null,
    breakInAt: null,
    totalMinutes: record.totalMinutes,
  };
}

function recordFromRemote(id: string, data: Record<string, unknown>): AttendanceRecord | null {
  const checkInAt = timestampToDate(data.checkInAt);
  if (!checkInAt) return null;

  return {
    id,
    employeeId: typeof data.employeeId === "string" ? data.employeeId : "",
    employeeName: typeof data.employeeName === "string" ? data.employeeName : "Employee",
    branchId: typeof data.branchId === "string" ? data.branchId : "unknown-branch",
    branchName: typeof data.branchName === "string" ? data.branchName : "Unknown branch",
    checkInAt,
    checkOutAt: timestampToDate(data.checkOutAt),
    breakOutAt: timestampToDate(data.breakOutAt),
    breakInAt: timestampToDate(data.breakInAt),
    totalMinutes: typeof data.totalMinutes === "number" ? data.totalMinutes : null,
  };
}

// Real-time listener for an employee's TODAY records. Biometric punches written
// by the Hikvision bridge land in Firestore and fire this callback instantly —
// this is what makes the dashboard reflect clock in/out with no button press.
// Returns an unsubscribe function.
export function subscribeTodayAttendance(
  employeeId: string,
  onChange: (records: AttendanceRecord[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "attendance"), where("employeeId", "==", employeeId), limit(60));

  return onSnapshot(
    q,
    (snapshot) => {
      const start = startOfTodayMs();
      const records: AttendanceRecord[] = [];

      snapshot.forEach((row) => {
        const record = recordFromRemote(row.id, row.data() as Record<string, unknown>);
        if (record && record.checkInAt.getTime() >= start) records.push(record);
      });

      records.sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime());

      // Mirror into the local cache so history works offline.
      records.forEach((r) => {
        upsertAttendanceFromRemote({
          id: r.id,
          employeeId: r.employeeId || employeeId,
          employeeName: r.employeeName,
          branchId: r.branchId,
          branchName: r.branchName,
          checkInAt: r.checkInAt,
          checkOutAt: r.checkOutAt,
          totalMinutes: r.totalMinutes,
          checkInLocation: null,
          checkOutLocation: null,
        }).catch(() => null);
      });

      onChange(records);
    },
    (error) => onError?.(error as Error),
  );
}

// Manager view: real-time stream of EVERY employee's punches for today. Unlike
// subscribeTodayAttendance this doesn't touch the local cache (which is scoped to
// the signed-in employee) — it's read-only for the manager dashboard.
export function subscribeAllTodayAttendance(
  onChange: (records: AttendanceRecord[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "attendance"), limit(500));
  return onSnapshot(
    q,
    (snapshot) => {
      const start = startOfTodayMs();
      const records: AttendanceRecord[] = [];
      snapshot.forEach((row) => {
        const record = recordFromRemote(row.id, row.data() as Record<string, unknown>);
        if (record && record.checkInAt.getTime() >= start) records.push(record);
      });
      records.sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime());
      onChange(records);
    },
    (error) => onError?.(error as Error),
  );
}

// Manager view: every employee's punches since a timestamp (e.g. the last 7
// days), for dashboard trend charts. One-shot read, no local cache.
export async function getAttendanceSince(sinceMs: number): Promise<AttendanceRecord[]> {
  const q = query(collection(db, "attendance"), limit(1000));
  const snap = await getDocs(q);
  const out: AttendanceRecord[] = [];
  snap.forEach((row) => {
    const record = recordFromRemote(row.id, row.data() as Record<string, unknown>);
    if (record && record.checkInAt.getTime() >= sinceMs) out.push(record);
  });
  return out;
}

// Manager view: all of one employee's records within a given month (0-indexed),
// fetched straight from Firestore (no local cache).
export async function getAttendanceForMonth(
  employeeId: string,
  year: number,
  month: number,
): Promise<AttendanceRecord[]> {
  const q = query(collection(db, "attendance"), where("employeeId", "==", employeeId), limit(500));
  const snap = await getDocs(q);
  const records: AttendanceRecord[] = [];
  snap.forEach((row) => {
    const record = recordFromRemote(row.id, row.data() as Record<string, unknown>);
    if (record && record.checkInAt.getFullYear() === year && record.checkInAt.getMonth() === month) {
      records.push(record);
    }
  });
  return records.sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
}

async function hydrateLocalFromRemote(employeeId: string, maxItems: number) {
  const q = query(collection(db, "attendance"), where("employeeId", "==", employeeId), limit(maxItems));
  const snap = await getDocs(q);

  for (const row of snap.docs) {
    const data = row.data();
    const checkInAt = timestampToDate(data.checkInAt);
    if (!checkInAt) continue;

    await upsertAttendanceFromRemote({
      id: row.id,
      employeeId,
      employeeName: typeof data.employeeName === "string" ? data.employeeName : "Employee",
      branchId: typeof data.branchId === "string" ? data.branchId : "unknown-branch",
      branchName: typeof data.branchName === "string" ? data.branchName : "Unknown branch",
      checkInAt,
      checkOutAt: timestampToDate(data.checkOutAt),
      totalMinutes: typeof data.totalMinutes === "number" ? data.totalMinutes : null,
      checkInLocation: (data.checkInLocation as LocationPoint | null | undefined) ?? null,
      checkOutLocation: (data.checkOutLocation as LocationPoint | null | undefined) ?? null,
    });
  }
}

export async function getTodayAttendance(employeeId: string) {
  await ensureOfflineStoreInitialized();

  try {
    await hydrateLocalFromRemote(employeeId, 120);
  } catch {
    // offline — fall back to local cache
  }

  const records = await getTodayAttendanceLocal(employeeId);
  return records.map(toAttendanceRecord);
}

export async function getRecentAttendance(employeeId: string, maxItems = 40) {
  await ensureOfflineStoreInitialized();

  try {
    await hydrateLocalFromRemote(employeeId, 120);
  } catch {
    // offline — fall back to local cache
  }

  const localRecords = await getRecentAttendanceLocal(employeeId, maxItems);
  return localRecords.map(toAttendanceRecord);
}

export async function clearLocalSession() {
  await ensureOfflineStoreInitialized();
  await clearLastSignedInEmployee();
}
