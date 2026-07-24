import AsyncStorage from "@react-native-async-storage/async-storage";
import { Timestamp, collection, doc, setDoc, updateDoc } from "firebase/firestore";

import { attendanceDocumentId, type EmployeeProfile } from "@/lib/attendance";
import { LocationPoint } from "@/lib/branches";
import { db } from "@/lib/firebase";

const KEY = "qui.pendingGpsCheckIns.v1";
const OUT_KEY = "qui.pendingGpsCheckOuts.v1";
type Employee = Pick<EmployeeProfile, "employeeId" | "fullName" | "branchId" | "branchName">;
export type QueuedGpsCheckIn = {
  id: string;
  employee: Employee;
  location: LocationPoint;
  capturedAt: string;
};
type QueuedGpsCheckOut = { id: string; recordId: string; checkInAt: string; location: LocationPoint; capturedAt: string };

async function readQueue(): Promise<QueuedGpsCheckIn[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || "[]") as QueuedGpsCheckIn[]; }
  catch { return []; }
}
async function writeQueue(rows: QueuedGpsCheckIn[]) { await AsyncStorage.setItem(KEY, JSON.stringify(rows)); }

export async function queueGpsCheckIn(employee: Employee, location: LocationPoint) {
  const rows = await readQueue();
  const capturedAt = new Date();
  const item: QueuedGpsCheckIn = {
    id: attendanceDocumentId(employee.employeeId, capturedAt, "gps"),
    employee, location, capturedAt: capturedAt.toISOString(),
  };
  rows.push(item);
  await writeQueue(rows);
  return item.id;
}

export async function queueGpsCheckOut(recordId: string, checkInAt: Date, location: LocationPoint) {
  const rows = JSON.parse((await AsyncStorage.getItem(OUT_KEY)) || "[]") as QueuedGpsCheckOut[];
  rows.push({ id: `gps_out_${Date.now()}`, recordId, checkInAt: checkInAt.toISOString(), location, capturedAt: new Date().toISOString() });
  await AsyncStorage.setItem(OUT_KEY, JSON.stringify(rows));
}

async function upload(item: QueuedGpsCheckIn) {
  const capturedAt = new Date(item.capturedAt);
  const period = `${capturedAt.getFullYear()}-${String(capturedAt.getMonth() + 1).padStart(2, "0")}`;
  await setDoc(doc(collection(db, "attendance"), item.id), {
    employeeId: item.employee.employeeId,
    employeeName: item.employee.fullName,
    branchId: item.employee.branchId ?? "",
    branchName: item.employee.branchName ?? "",
    checkInAt: Timestamp.fromDate(capturedAt),
    checkOutAt: null,
    method: "gps",
    checkInLocation: item.location,
    selfieUrl: null,
    period,
    capturedOffline: true,
    syncedAt: Timestamp.now(),
  });
}

export async function flushQueuedGpsCheckIns(): Promise<number> {
  const rows = await readQueue();
  const remaining: QueuedGpsCheckIn[] = [];
  let synced = 0;
  for (const item of rows) {
    try { await upload(item); synced += 1; }
    catch { remaining.push(item); }
  }
  await writeQueue(remaining);
  return synced;
}

export async function flushQueuedGpsCheckOuts(): Promise<number> {
  let rows: QueuedGpsCheckOut[] = [];
  try { rows = JSON.parse((await AsyncStorage.getItem(OUT_KEY)) || "[]") as QueuedGpsCheckOut[]; } catch { /* empty */ }
  const remaining: QueuedGpsCheckOut[] = [];
  let synced = 0;
  for (const item of rows) {
    try {
      const capturedAt = new Date(item.capturedAt);
      const checkInAt = new Date(item.checkInAt);
      await updateDoc(doc(db, "attendance", item.recordId), {
        checkOutAt: Timestamp.fromDate(capturedAt), checkOutLocation: item.location,
        totalMinutes: Math.max(0, Math.round((capturedAt.getTime() - checkInAt.getTime()) / 60000)),
        checkOutCapturedOffline: true, syncedAt: Timestamp.now(),
      });
      synced += 1;
    } catch { remaining.push(item); }
  }
  await AsyncStorage.setItem(OUT_KEY, JSON.stringify(remaining));
  return synced;
}
