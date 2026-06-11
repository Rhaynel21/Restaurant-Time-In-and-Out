import * as SQLite from "expo-sqlite";

import { LocationPoint } from "@/lib/branches";

export type LocalEmployeeProfile = {
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

export type LocalAttendanceRecord = {
  id: string;
  remoteId: string | null;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  totalMinutes: number | null;
  checkInLocation: LocationPoint | null;
  checkOutLocation: LocationPoint | null;
};

type EmployeeRow = {
  employee_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  branch_id: string | null;
  branch_name: string | null;
};

type AttendanceRow = {
  local_id: string;
  remote_id: string | null;
  employee_id: string;
  employee_name: string;
  branch_id: string;
  branch_name: string;
  check_in_at: number;
  check_out_at: number | null;
  total_minutes: number | null;
  check_in_location_json: string | null;
  check_out_location_json: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

// The local SQLite store is now a read cache only: attendance is authored by the
// Hikvision bridge into Firestore and streamed into the app. We keep the
// employee profile + attendance tables so history/today still work offline.
async function openAndMigrate() {
  const db = await SQLite.openDatabaseAsync("kitchen-in-and-out.db");

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      branch_id TEXT,
      branch_name TEXT,
      last_verified_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      local_id TEXT PRIMARY KEY NOT NULL,
      remote_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      check_in_at INTEGER NOT NULL,
      check_out_at INTEGER,
      total_minutes INTEGER,
      check_in_location_json TEXT,
      check_out_location_json TEXT,
      sync_status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_employee_in
      ON attendance_records (employee_id, check_in_at DESC);

    CREATE TABLE IF NOT EXISTS session_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      cache_value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return db;
}

function nowMs() {
  return Date.now();
}

function parseLocation(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as LocationPoint;
  } catch {
    return null;
  }
}

function toEmployee(row: EmployeeRow): LocalEmployeeProfile {
  return {
    employeeId: row.employee_id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    branchId: row.branch_id,
    branchName: row.branch_name,
  };
}

function toAttendance(row: AttendanceRow): LocalAttendanceRecord {
  return {
    id: row.local_id,
    remoteId: row.remote_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    checkInAt: new Date(row.check_in_at),
    checkOutAt: typeof row.check_out_at === "number" ? new Date(row.check_out_at) : null,
    totalMinutes: typeof row.total_minutes === "number" ? row.total_minutes : null,
    checkInLocation: parseLocation(row.check_in_location_json),
    checkOutLocation: parseLocation(row.check_out_location_json),
  };
}

export async function ensureOfflineStoreInitialized() {
  await getDb();
}

export async function upsertEmployeeLocal(profile: LocalEmployeeProfile) {
  const db = await getDb();
  const now = nowMs();

  await db.runAsync(
    `INSERT INTO employees (
      employee_id, first_name, last_name, full_name, email, phone, role,
      branch_id, branch_name, last_verified_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      role = excluded.role,
      branch_id = excluded.branch_id,
      branch_name = excluded.branch_name,
      last_verified_at = excluded.last_verified_at,
      updated_at = excluded.updated_at`,
    profile.employeeId,
    profile.firstName,
    profile.lastName,
    profile.fullName,
    profile.email,
    profile.phone,
    profile.role,
    profile.branchId,
    profile.branchName,
    now,
    now,
  );
}

export async function getEmployeeLocal(employeeId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<EmployeeRow>(
    `SELECT employee_id, first_name, last_name, full_name, email, phone, role, branch_id, branch_name
     FROM employees WHERE employee_id = ?`,
    employeeId,
  );

  return row ? toEmployee(row) : null;
}

export async function setLastSignedInEmployee(employeeId: string) {
  const db = await getDb();
  const now = nowMs();
  await db.runAsync(
    `INSERT INTO session_cache (cache_key, cache_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
      cache_value = excluded.cache_value,
      updated_at = excluded.updated_at`,
    "last_employee_id",
    employeeId,
    now,
  );
}

export async function clearLastSignedInEmployee() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM session_cache WHERE cache_key = ?`, "last_employee_id");
}

export async function getLastSignedInEmployee() {
  const db = await getDb();
  const row = await db.getFirstAsync<{ cache_value: string }>(
    `SELECT cache_value FROM session_cache WHERE cache_key = ?`,
    "last_employee_id",
  );
  return row?.cache_value ?? null;
}

// Upsert a record streamed/fetched from Firestore into the local read cache.
export async function upsertAttendanceFromRemote(input: {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  totalMinutes: number | null;
  checkInLocation: LocationPoint | null;
  checkOutLocation: LocationPoint | null;
}) {
  const db = await getDb();
  const now = nowMs();

  await db.runAsync(
    `INSERT INTO attendance_records (
      local_id, remote_id, employee_id, employee_name, branch_id, branch_name,
      check_in_at, check_out_at, total_minutes,
      check_in_location_json, check_out_location_json,
      sync_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_id) DO UPDATE SET
      remote_id = excluded.remote_id,
      employee_id = excluded.employee_id,
      employee_name = excluded.employee_name,
      branch_id = excluded.branch_id,
      branch_name = excluded.branch_name,
      check_in_at = excluded.check_in_at,
      check_out_at = excluded.check_out_at,
      total_minutes = excluded.total_minutes,
      check_in_location_json = excluded.check_in_location_json,
      check_out_location_json = excluded.check_out_location_json,
      updated_at = excluded.updated_at`,
    input.id,
    input.id,
    input.employeeId,
    input.employeeName,
    input.branchId,
    input.branchName,
    input.checkInAt.getTime(),
    input.checkOutAt ? input.checkOutAt.getTime() : null,
    input.totalMinutes,
    JSON.stringify(input.checkInLocation),
    JSON.stringify(input.checkOutLocation),
    "synced",
    now,
    now,
  );
}

export async function getTodayAttendanceLocal(employeeId: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

  const db = await getDb();
  const rows = await db.getAllAsync<AttendanceRow>(
    `SELECT
      local_id, remote_id, employee_id, employee_name, branch_id, branch_name,
      check_in_at, check_out_at, total_minutes,
      check_in_location_json, check_out_location_json
    FROM attendance_records
    WHERE employee_id = ? AND check_in_at >= ? AND check_in_at < ?
    ORDER BY check_in_at DESC`,
    employeeId,
    start,
    end,
  );

  return rows.map(toAttendance);
}

export async function getRecentAttendanceLocal(employeeId: string, maxItems = 40) {
  const db = await getDb();
  const rows = await db.getAllAsync<AttendanceRow>(
    `SELECT
      local_id, remote_id, employee_id, employee_name, branch_id, branch_name,
      check_in_at, check_out_at, total_minutes,
      check_in_location_json, check_out_location_json
    FROM attendance_records
    WHERE employee_id = ?
    ORDER BY check_in_at DESC
    LIMIT ?`,
    employeeId,
    maxItems,
  );

  return rows.map(toAttendance);
}
