// Firestore writer. Mirrors the exact `attendance` document shape the Qui
// app reads, so biometric punches are indistinguishable from app-created ones.
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const config = require("./config");
const queue = require("./queue");

const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");
if (!fs.existsSync(keyPath)) {
  throw new Error(
    "Missing serviceAccountKey.json in hikvision-bridge/. Download it from " +
      "Firebase Console > Project Settings > Service accounts > Generate new private key.",
  );
}

admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

// Resolve a device employeeNo to an app employee profile (id, name, branch).
async function resolveEmployee(employeeNo, deviceName) {
  const employeeId = (config.employeeMap[employeeNo] || employeeNo).toUpperCase();

  let name = deviceName || "";
  let branchId = config.defaultBranchId;
  let branchName = config.defaultBranchName;

  try {
    const snap = await db.collection("employees").doc(employeeId).get();
    if (snap.exists) {
      const data = snap.data();
      name = data.fullName || name || "Employee";
      if (data.branchId) branchId = data.branchId;
      if (data.branchName) branchName = data.branchName;
    }
  } catch (err) {
    console.warn(`[firestore] employee lookup failed for ${employeeId}: ${err.message}`);
  }

  return { employeeId, name: name || "Employee", branchId, branchName };
}

// Cache of each employee's scheduled meal-break window, so we don't read the
// schedule doc on every punch. Entries expire so schedule edits still propagate.
const breakCache = new Map(); // employeeId -> { window, fetchedMs }
const BREAK_TTL_MS = 5 * 60 * 1000;

// Read an employee's scheduled break window { breakStart, breakEnd } (HH:MM) from
// `schedules/{id}`. Returns nulls when no break is set. Used to classify a punch
// as a break-out vs a clock-out.
async function getScheduleBreak(employeeId) {
  const cached = breakCache.get(employeeId);
  if (cached && Date.now() - cached.fetchedMs < BREAK_TTL_MS) return cached.window;
  let window = { breakStart: null, breakEnd: null };
  try {
    const snap = await db.collection("schedules").doc(employeeId).get();
    if (snap.exists) {
      const data = snap.data();
      window = {
        breakStart: typeof data.breakStart === "string" ? data.breakStart : null,
        breakEnd: typeof data.breakEnd === "string" ? data.breakEnd : null,
      };
    }
  } catch (err) {
    console.warn(`[firestore] schedule break lookup failed for ${employeeId}: ${err.message}`);
  }
  breakCache.set(employeeId, { window, fetchedMs: Date.now() });
  return window;
}

// The currently-open (no checkout) attendance record for an employee, if any.
async function findOpenRecord(employeeId) {
  const snap = await db
    .collection("attendance")
    .where("employeeId", "==", employeeId)
    .where("checkOutAt", "==", null)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

// Most recent record overall (used to debounce repeat scans regardless of state).
async function findLatestRecord(employeeId) {
  const snap = await db
    .collection("attendance")
    .where("employeeId", "==", employeeId)
    .get();
  if (snap.empty) return null;
  let latest = null;
  snap.forEach((doc) => {
    const data = doc.data();
    const ci = data.checkInAt && data.checkInAt.toMillis ? data.checkInAt.toMillis() : 0;
    const co = data.checkOutAt && data.checkOutAt.toMillis ? data.checkOutAt.toMillis() : 0;
    const touched = Math.max(ci, co);
    if (!latest || touched > latest.touched) latest = { id: doc.id, data, touched };
  });
  return latest;
}

// A network-class error means we're offline — queue the write and replay later
// rather than losing the punch. Anything else (e.g. permission denied) is a real
// bug we want surfaced, so it's re-thrown.
function isOffline(err) {
  const code = err && (err.code || err.errno);
  return (
    code === 14 || // gRPC UNAVAILABLE
    code === 4 || // DEADLINE_EXCEEDED
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    /network|ENOTFOUND|ETIMEDOUT|ECONNRESET|unavailable/i.test(String(err && err.message))
  );
}

function checkInDoc(emp, time) {
  return {
    employeeId: emp.employeeId,
    employeeName: emp.name,
    branchId: emp.branchId,
    branchName: emp.branchName,
    checkInAt: Timestamp.fromDate(time),
    checkOutAt: null,
    breakOutAt: null,
    breakInAt: null,
    checkInLocation: null,
    checkOutLocation: null,
    totalMinutes: null,
    source: "hikvision",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// A punch that starts the meal break.
function breakOutDoc(time) {
  return {
    breakOutAt: Timestamp.fromDate(time),
    source: "hikvision",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function writeBreakOut(openRecord, time) {
  try {
    await db.collection("attendance").doc(openRecord.id).set(breakOutDoc(time), { merge: true });
  } catch (err) {
    if (!isOffline(err)) throw err;
    queue.enqueue({ kind: "breakout", recordId: openRecord.id, timeMs: time.getTime() });
  }
  return openRecord.id;
}

// A punch that ends the meal break.
function breakInDoc(time) {
  return {
    breakInAt: Timestamp.fromDate(time),
    source: "hikvision",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function writeBreakIn(openRecord, time) {
  try {
    await db.collection("attendance").doc(openRecord.id).set(breakInDoc(time), { merge: true });
  } catch (err) {
    if (!isOffline(err)) throw err;
    queue.enqueue({ kind: "breakin", recordId: openRecord.id, timeMs: time.getTime() });
  }
  return openRecord.id;
}

async function writeCheckIn(emp, time) {
  // Deterministic ID makes the write idempotent, so a queued replay can never
  // create a duplicate record.
  const id = `${emp.employeeId}-${time.getTime()}-bio`;
  try {
    await db.collection("attendance").doc(id).set(checkInDoc(emp, time));
  } catch (err) {
    if (!isOffline(err)) throw err;
    queue.enqueue({ kind: "checkin", emp, timeMs: time.getTime() });
  }
  return id;
}

function checkOutDoc(time, totalMinutes) {
  return {
    checkOutAt: Timestamp.fromDate(time),
    totalMinutes,
    source: "hikvision",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function breakMillis(record) {
  const bo = record.breakOutAt && record.breakOutAt.toMillis ? record.breakOutAt.toMillis() : 0;
  const bi = record.breakInAt && record.breakInAt.toMillis ? record.breakInAt.toMillis() : 0;
  return bo && bi && bi > bo ? bi - bo : 0;
}

async function writeCheckOut(openRecord, time) {
  const checkInMs =
    openRecord.checkInAt && openRecord.checkInAt.toMillis
      ? openRecord.checkInAt.toMillis()
      : time.getTime();
  // Net worked time = gross shift minus any recorded (unpaid) meal break.
  const grossMinutes = Math.max(0, Math.round((time.getTime() - checkInMs) / 60000));
  const breakMinutes = Math.round(breakMillis(openRecord) / 60000);
  const totalMinutes = Math.max(0, grossMinutes - breakMinutes);

  try {
    await db.collection("attendance").doc(openRecord.id).set(checkOutDoc(time, totalMinutes), { merge: true });
  } catch (err) {
    if (!isOffline(err)) throw err;
    queue.enqueue({ kind: "checkout", recordId: openRecord.id, totalMinutes, timeMs: time.getTime() });
  }
  return { id: openRecord.id, totalMinutes };
}

// Replay one queued write. Idempotent: same deterministic IDs as the live path.
async function replayOp(op) {
  if (op.kind === "checkin") {
    const time = new Date(op.timeMs);
    const id = `${op.emp.employeeId}-${op.timeMs}-bio`;
    await db.collection("attendance").doc(id).set(checkInDoc(op.emp, time));
  } else if (op.kind === "checkout") {
    await db
      .collection("attendance")
      .doc(op.recordId)
      .set(checkOutDoc(new Date(op.timeMs), op.totalMinutes), { merge: true });
  } else if (op.kind === "breakout") {
    await db.collection("attendance").doc(op.recordId).set(breakOutDoc(new Date(op.timeMs)), { merge: true });
  } else if (op.kind === "breakin") {
    await db.collection("attendance").doc(op.recordId).set(breakInDoc(new Date(op.timeMs)), { merge: true });
  }
}

// List employees as { employeeId, name, branchId, branchName } — used by the
// live simulator to pick who to punch. Falls back to the configured default
// branch when an employee has none on their doc.
async function listEmployees() {
  const snap = await db.collection("employees").get();
  return snap.docs
    .map((d) => {
      const data = d.data() || {};
      const employeeId = (data.employeeId || d.id || "").toUpperCase();
      if (!employeeId) return null;
      return {
        employeeId,
        name: data.fullName || `${data.firstName || ""} ${data.lastName || ""}`.trim() || employeeId,
        branchId: data.branchId || config.defaultBranchId,
        branchName: data.branchName || config.defaultBranchName,
        accessRole: data.accessRole || "staff",
        status: data.status || "active",
      };
    })
    .filter(Boolean);
}

// Drain any punches captured while offline. Returns how many were flushed.
async function flushQueue() {
  return queue.flush(replayOp);
}

// Heartbeat: lets the manager portal show whether the terminal is online.
async function heartbeat(online, meta = {}) {
  try {
    await db
      .collection("deviceStatus")
      .doc(config.deviceId)
      .set(
        {
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          online,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          queueDepth: queue.size(),
          ...meta,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch {
    // best-effort; never let telemetry break the main loop
  }
}

// Record a tamper / anti-fraud alarm for the manager portal.
async function recordAlarm(alarm) {
  try {
    await db
      .collection("deviceAlarms")
      .doc(`${config.deviceId}-${alarm.key}`)
      .set(
        {
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          type: alarm.type,
          severity: alarm.severity,
          message: alarm.message,
          count: alarm.count ?? null,
          at: alarm.at ? Timestamp.fromDate(alarm.at) : admin.firestore.FieldValue.serverTimestamp(),
          acknowledged: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch {
    // best-effort
  }
}

module.exports = {
  resolveEmployee,
  getScheduleBreak,
  findOpenRecord,
  findLatestRecord,
  listEmployees,
  writeCheckIn,
  writeBreakOut,
  writeBreakIn,
  writeCheckOut,
  flushQueue,
  heartbeat,
  recordAlarm,
};
