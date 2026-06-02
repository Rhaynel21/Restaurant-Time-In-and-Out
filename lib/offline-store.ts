import * as SQLite from "expo-sqlite";

import { Branch, LocationPoint } from "@/lib/branches";

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
  syncStatus: "pending" | "synced";
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
  sync_status: "pending" | "synced";
};

type BranchSyncRow = {
  id: number;
  employee_id: string;
  branch_id: string;
  branch_name: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

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

    CREATE INDEX IF NOT EXISTS idx_attendance_sync
      ON attendance_records (sync_status, check_in_at DESC);

    CREATE TABLE IF NOT EXISTS branch_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_branch_sync_updated
      ON branch_sync_queue (updated_at ASC);

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
    syncStatus: row.sync_status,
  };
}

function makeLocalAttendanceId(employeeId: string, checkInAt: Date) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${employeeId}-${checkInAt.getTime()}-${rand}`;
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

export async function saveEmployeeBranchLocal(employeeId: string, branch: Branch) {
  const db = await getDb();
  const now = nowMs();

  await db.runAsync(
    `UPDATE employees
      SET branch_id = ?, branch_name = ?, updated_at = ?
      WHERE employee_id = ?`,
    branch.id,
    branch.name,
    now,
    employeeId,
  );
}

export async function enqueueBranchSync(employeeId: string, branch: Branch) {
  const db = await getDb();
  const now = nowMs();

  await db.runAsync(
    `DELETE FROM branch_sync_queue WHERE employee_id = ?`,
    employeeId,
  );

  await db.runAsync(
    `INSERT INTO branch_sync_queue (employee_id, branch_id, branch_name, attempts, updated_at, created_at)
      VALUES (?, ?, ?, 0, ?, ?)`,
    employeeId,
    branch.id,
    branch.name,
    now,
    now,
  );
}

export async function getPendingBranchSyncItems(limit = 20) {
  const db = await getDb();
  const rows = await db.getAllAsync<BranchSyncRow>(
    `SELECT id, employee_id, branch_id, branch_name
      FROM branch_sync_queue
      ORDER BY updated_at ASC
      LIMIT ?`,
    limit,
  );

  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    branch: {
      id: row.branch_id,
      name: row.branch_name,
      address: row.branch_name,
      lat: 0,
      lng: 0,
    } as Branch,
  }));
}

export async function markBranchSyncSuccess(id: number) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM branch_sync_queue WHERE id = ?`, id);
}

export async function markBranchSyncFailure(id: number) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE branch_sync_queue SET attempts = attempts + 1, updated_at = ? WHERE id = ?`,
    nowMs(),
    id,
  );
}

export async function createCheckInLocal(input: {
  employeeId: string;
  employeeName: string;
  branch: Branch;
  location: LocationPoint | null;
  checkInAt?: Date;
}) {
  const db = await getDb();
  const checkInAt = input.checkInAt ?? new Date();
  const id = makeLocalAttendanceId(input.employeeId, checkInAt);
  const now = nowMs();

  await db.runAsync(
    `INSERT INTO attendance_records (
      local_id, remote_id, employee_id, employee_name, branch_id, branch_name,
      check_in_at, check_out_at, total_minutes,
      check_in_location_json, check_out_location_json,
      sync_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    null,
    input.employeeId,
    input.employeeName,
    input.branch.id,
    input.branch.name,
    checkInAt.getTime(),
    null,
    null,
    JSON.stringify(input.location),
    null,
    "pending",
    now,
    now,
  );

  return {
    id,
    checkInAt,
  };
}

export async function getLatestOpenAttendanceLocal(employeeId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<AttendanceRow>(
    `SELECT
      local_id, remote_id, employee_id, employee_name, branch_id, branch_name,
      check_in_at, check_out_at, total_minutes,
      check_in_location_json, check_out_location_json,
      sync_status
    FROM attendance_records
    WHERE employee_id = ? AND check_out_at IS NULL
    ORDER BY check_in_at DESC
    LIMIT 1`,
    employeeId,
  );

  return row ? toAttendance(row) : null;
}

export async function createCheckOutLocal(input: {
  employeeId: string;
  location: LocationPoint | null;
  checkOutAt?: Date;
}) {
  const active = await getLatestOpenAttendanceLocal(input.employeeId);
  if (!active) return null;

  const checkOutAt = input.checkOutAt ?? new Date();
  const totalMinutes = Math.max(
    0,
    Math.round((checkOutAt.getTime() - active.checkInAt.getTime()) / 60000),
  );

  const db = await getDb();
  await db.runAsync(
    `UPDATE attendance_records
      SET check_out_at = ?,
          total_minutes = ?,
          check_out_location_json = ?,
          sync_status = ?,
          updated_at = ?
      WHERE local_id = ?`,
    checkOutAt.getTime(),
    totalMinutes,
    JSON.stringify(input.location),
    "pending",
    nowMs(),
    active.id,
  );

  return {
    ...active,
    checkOutAt,
    totalMinutes,
    checkOutLocation: input.location,
    syncStatus: "pending" as const,
  };
}

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
      sync_status = excluded.sync_status,
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

export async function markAttendanceSynced(localId: string, remoteId: string | null) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE attendance_records
      SET remote_id = COALESCE(?, remote_id),
          sync_status = ?,
          updated_at = ?
      WHERE local_id = ?`,
    remoteId,
    "synced",
    nowMs(),
    localId,
  );
}

export async function getPendingAttendanceSync(limit = 40) {
  const db = await getDb();
  const rows = await db.getAllAsync<AttendanceRow>(
    `SELECT
      local_id, remote_id, employee_id, employee_name, branch_id, branch_name,
      check_in_at, check_out_at, total_minutes,
      check_in_location_json, check_out_location_json,
      sync_status
    FROM attendance_records
    WHERE sync_status = ?
    ORDER BY check_in_at ASC
    LIMIT ?`,
    "pending",
    limit,
  );

  return rows.map(toAttendance);
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
      check_in_location_json, check_out_location_json,
      sync_status
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
      check_in_location_json, check_out_location_json,
      sync_status
    FROM attendance_records
    WHERE employee_id = ?
    ORDER BY check_in_at DESC
    LIMIT ?`,
    employeeId,
    maxItems,
  );

  return rows.map(toAttendance);
}
