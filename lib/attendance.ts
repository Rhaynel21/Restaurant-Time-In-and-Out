import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { Branch, LocationPoint } from "@/lib/branches";
import { db } from "@/lib/firebase";
import {
  LocalAttendanceRecord,
  LocalEmployeeProfile,
  clearLastSignedInEmployee,
  createCheckInLocal,
  createCheckOutLocal,
  ensureOfflineStoreInitialized,
  enqueueBranchSync,
  getEmployeeLocal,
  getPendingAttendanceSync,
  getPendingBranchSyncItems,
  getRecentAttendanceLocal,
  getTodayAttendanceLocal,
  markAttendanceSynced,
  markBranchSyncFailure,
  markBranchSyncSuccess,
  saveEmployeeBranchLocal,
  setLastSignedInEmployee,
  upsertAttendanceFromRemote,
  upsertEmployeeLocal,
} from "@/lib/offline-store";

export type EmployeeProfile = {
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
};

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  totalMinutes: number | null;
};

const DEFAULT_EMPLOYEE_ID = "EMP-0001";
export const OFFLINE_LOGIN_CACHE_MISS = "OFFLINE_LOGIN_CACHE_MISS";

function normalizeEmployeeId(input: string) {
  const trimmed = input.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : DEFAULT_EMPLOYEE_ID;
}

// Migrate emails seeded under old brand names (kopiklock / kitcheninout) to the
// current "thymein.local" domain so records created before the rebrand update
// themselves on next load.
function normalizeBrandEmail(email: string) {
  return email.replace(/@(kopiklock|kitcheninout)\.local$/i, "@thymein.local");
}

function timestampToDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "seconds" in value) {
    return new Timestamp((value as { seconds: number }).seconds, 0).toDate();
  }
  return null;
}

function toEmployeeProfile(profile: LocalEmployeeProfile): EmployeeProfile {
  return {
    employeeId: profile.employeeId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    email: normalizeBrandEmail(profile.email),
    phone: profile.phone,
    role: profile.role,
    branchId: profile.branchId,
    branchName: profile.branchName,
  };
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
    totalMinutes: record.totalMinutes,
  };
}

async function pushBranchQueueToFirestore() {
  const pending = await getPendingBranchSyncItems(20);

  for (const item of pending) {
    try {
      await setDoc(
        doc(db, "employees", item.employeeId),
        {
          branchId: item.branch.id,
          branchName: item.branch.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      await markBranchSyncSuccess(item.id);
    } catch {
      await markBranchSyncFailure(item.id);
      throw new Error("BRANCH_SYNC_PENDING");
    }
  }
}

async function pushAttendanceQueueToFirestore() {
  const pending = await getPendingAttendanceSync(60);

  for (const item of pending) {
    try {
      await setDoc(
        doc(db, "attendance", item.id),
        {
          employeeId: item.employeeId,
          employeeName: item.employeeName,
          branchId: item.branchId,
          branchName: item.branchName,
          checkInAt: Timestamp.fromDate(item.checkInAt),
          checkOutAt: item.checkOutAt ? Timestamp.fromDate(item.checkOutAt) : null,
          checkInLocation: item.checkInLocation,
          checkOutLocation: item.checkOutLocation,
          totalMinutes: item.totalMinutes,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      await markAttendanceSynced(item.id, item.id);
    } catch {
      throw new Error("ATTENDANCE_SYNC_PENDING");
    }
  }
}

export async function syncPendingOperations() {
  await ensureOfflineStoreInitialized();

  try {
    await pushBranchQueueToFirestore();
    await pushAttendanceQueueToFirestore();
    return { synced: true };
  } catch {
    return { synced: false };
  }
}

export async function ensureEmployeeProfile(employeeIdInput: string) {
  const employeeId = normalizeEmployeeId(employeeIdInput);
  await ensureOfflineStoreInitialized();

  try {
    const ref = doc(db, "employees", employeeId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const profile: EmployeeProfile = {
        employeeId,
        firstName: "Alfred",
        lastName: "Cabato",
        fullName: "Alfred Cabato",
        email: "alfred.cabato@thymein.local",
        phone: "+63 917 555 0101",
        role: "Line Cook",
        branchId: "kio-bgc",
        branchName: "Thyme In - BGC",
      };

      await setDoc(ref, {
        ...profile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await upsertEmployeeLocal(profile);
      await setLastSignedInEmployee(employeeId);
      return profile;
    }

    const data = snap.data() as Partial<EmployeeProfile>;
    const profile: EmployeeProfile = {
      employeeId,
      firstName: data.firstName ?? "Alfred",
      lastName: data.lastName ?? "Cabato",
      fullName: data.fullName ?? "Alfred Cabato",
      email: normalizeBrandEmail(data.email ?? "alfred.cabato@thymein.local"),
      phone: data.phone ?? "+63 917 555 0101",
      role: data.role ?? "Line Cook",
      branchId: data.branchId ?? "kio-bgc",
      branchName: data.branchName ?? "Thyme In - BGC",
    };

    // If the stored email used an old brand domain, persist the migrated value.
    if (data.email && data.email !== profile.email) {
      await setDoc(ref, { email: profile.email, updatedAt: serverTimestamp() }, { merge: true });
    }

    await upsertEmployeeLocal(profile);
    await setLastSignedInEmployee(employeeId);
    await syncPendingOperations();
    return profile;
  } catch {
    const localProfile = await getEmployeeLocal(employeeId);
    if (!localProfile) {
      throw new Error(OFFLINE_LOGIN_CACHE_MISS);
    }

    await setLastSignedInEmployee(localProfile.employeeId);
    return toEmployeeProfile(localProfile);
  }
}

export async function saveEmployeeBranch(employeeId: string, branch: Branch) {
  await ensureOfflineStoreInitialized();
  await saveEmployeeBranchLocal(employeeId, branch);

  try {
    await setDoc(
      doc(db, "employees", employeeId),
      {
        branchId: branch.id,
        branchName: branch.name,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    await enqueueBranchSync(employeeId, branch);
  }
}

export async function createCheckInRecord(input: {
  employeeId: string;
  employeeName: string;
  branch: Branch;
  location: LocationPoint | null;
}) {
  await ensureOfflineStoreInitialized();

  const created = await createCheckInLocal({
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    branch: input.branch,
    location: input.location,
  });

  const syncResult = await syncPendingOperations();

  return {
    id: created.id,
    checkInAt: created.checkInAt,
    synced: syncResult.synced,
  };
}

export async function createCheckOutRecord(input: {
  employeeId: string;
  location: LocationPoint | null;
}) {
  await ensureOfflineStoreInitialized();

  const updated = await createCheckOutLocal({
    employeeId: input.employeeId,
    location: input.location,
  });

  if (!updated) return null;

  const syncResult = await syncPendingOperations();

  return {
    id: updated.id,
    checkInAt: updated.checkInAt,
    checkOutAt: updated.checkOutAt,
    totalMinutes: updated.totalMinutes,
    synced: syncResult.synced,
  };
}

async function hydrateLocalFromRemote(employeeId: string, maxItems: number) {
  const q = query(collection(db, "attendance"), where("employeeId", "==", employeeId), limit(maxItems));
  const snap = await getDocs(q);

  for (const row of snap.docs) {
    const data = row.data();
    const checkInAt = timestampToDate(data.checkInAt);
    if (!checkInAt) continue;

    const checkOutAt = timestampToDate(data.checkOutAt);

    await upsertAttendanceFromRemote({
      id: row.id,
      employeeId,
      employeeName: typeof data.employeeName === "string" ? data.employeeName : "Employee",
      branchId: typeof data.branchId === "string" ? data.branchId : "unknown-branch",
      branchName: typeof data.branchName === "string" ? data.branchName : "Unknown branch",
      checkInAt,
      checkOutAt,
      totalMinutes: typeof data.totalMinutes === "number" ? data.totalMinutes : null,
      checkInLocation: (data.checkInLocation as LocationPoint | null | undefined) ?? null,
      checkOutLocation: (data.checkOutLocation as LocationPoint | null | undefined) ?? null,
    });
  }
}

export async function getTodayAttendance(employeeId: string) {
  await ensureOfflineStoreInitialized();

  try {
    await syncPendingOperations();
  } catch {
    // no-op
  }

  const records = await getTodayAttendanceLocal(employeeId);
  if (records.length > 0) {
    return records.map(toAttendanceRecord);
  }

  try {
    await hydrateLocalFromRemote(employeeId, 120);
  } catch {
    // no-op
  }

  const refreshed = await getTodayAttendanceLocal(employeeId);
  return refreshed.map(toAttendanceRecord);
}

export async function getRecentAttendance(employeeId: string, maxItems = 40) {
  await ensureOfflineStoreInitialized();

  try {
    await syncPendingOperations();
  } catch {
    // no-op
  }

  const localRecords = await getRecentAttendanceLocal(employeeId, maxItems);

  if (localRecords.length > 0) {
    return localRecords.map(toAttendanceRecord);
  }

  try {
    await hydrateLocalFromRemote(employeeId, 120);
  } catch {
    // no-op
  }

  const refreshedLocalRecords = await getRecentAttendanceLocal(employeeId, maxItems);
  return refreshedLocalRecords.map(toAttendanceRecord);
}

export async function clearLocalSession() {
  await ensureOfflineStoreInitialized();
  await clearLastSignedInEmployee();
}
