import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
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
  branchIds: string[]; // area managers cover several branches
  branchName: string | null;
  accessRole: "owner" | "staff" | "manager" | "areaManager" | "hr" | "admin"; // app access level
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
  // How the punch was captured (Step 3): "biometric" = Hikvision fingerprint
  // bridge (the default for existing records), "gps" = mobile GPS check-in,
  // "manual" = HR-entered. GPS punches carry the device location.
  method: "biometric" | "gps" | "manual";
  checkInLocation: LocationPoint | null;
  checkOutLocation: LocationPoint | null;
  selfieUrl: string | null;
  // Midnight roll-over flags (set by the bridge): a shift still open at 23:59 is
  // auto-closed for that day (autoClosed) and, if it's an overnight shift, a
  // continuation record is auto-opened at 00:00 (autoOpened + continuedFrom).
  // buildDtr recombines the pair back onto the shift's start day.
  autoClosed: boolean;
  autoOpened: boolean;
  continuedFrom: string | null;
};

function toLocation(value: unknown): LocationPoint | null {
  if (value && typeof value === "object" && "lat" in value && "lng" in value) {
    const v = value as { lat: unknown; lng: unknown; accuracyMeters?: unknown };
    if (typeof v.lat === "number" && typeof v.lng === "number") {
      return { lat: v.lat, lng: v.lng, accuracyMeters: typeof v.accuracyMeters === "number" ? v.accuracyMeters : null };
    }
  }
  return null;
}

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
    method: "biometric",
    checkInLocation: null,
    checkOutLocation: null,
    selfieUrl: null,
    autoClosed: false,
    autoOpened: false,
    continuedFrom: null,
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
    method: data.method === "gps" ? "gps" : data.method === "manual" ? "manual" : "biometric",
    checkInLocation: toLocation(data.checkInLocation),
    checkOutLocation: toLocation(data.checkOutLocation),
    selfieUrl: typeof data.selfieUrl === "string" ? data.selfieUrl : null,
    autoClosed: data.autoClosed === true,
    autoOpened: data.autoOpened === true,
    continuedFrom: typeof data.continuedFrom === "string" ? data.continuedFrom : null,
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

// ── Mobile GPS check-in (Step 3) ─────────────────────────────────────────────
// An alternative to the biometric terminal: the employee punches from their phone,
// stamped with device location (validated against the branch geofence by the
// caller). Writes into the same `attendance` collection the
// bridge uses, tagged method:"gps" so DTR/reports can tell punches apart.

type PunchEmployee = Pick<EmployeeProfile, "employeeId" | "fullName" | "branchId" | "branchName">;

export async function gpsCheckIn(employee: PunchEmployee, location: LocationPoint): Promise<string> {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ref = await addDoc(collection(db, "attendance"), {
    employeeId: employee.employeeId,
    employeeName: employee.fullName,
    branchId: employee.branchId ?? "",
    branchName: employee.branchName ?? "",
    checkInAt: serverTimestamp(),
    checkOutAt: null,
    method: "gps",
    checkInLocation: location,
    selfieUrl: null,
    period,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function gpsCheckOut(recordId: string, checkInAt: Date, location: LocationPoint): Promise<void> {
  const totalMinutes = Math.max(0, Math.round((Date.now() - checkInAt.getTime()) / 60000));
  await updateDoc(doc(db, "attendance", recordId), {
    checkOutAt: serverTimestamp(),
    checkOutLocation: location,
    totalMinutes,
  });
}
