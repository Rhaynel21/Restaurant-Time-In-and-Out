// Firestore writer. Mirrors the exact `attendance` document shape the Thyme In
// app reads, so biometric punches are indistinguishable from app-created ones.
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const config = require("./config");

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

async function writeCheckIn(emp, time) {
  const id = `${emp.employeeId}-${time.getTime()}-bio`;
  await db.collection("attendance").doc(id).set({
    employeeId: emp.employeeId,
    employeeName: emp.name,
    branchId: emp.branchId,
    branchName: emp.branchName,
    checkInAt: Timestamp.fromDate(time),
    checkOutAt: null,
    checkInLocation: null,
    checkOutLocation: null,
    totalMinutes: null,
    source: "hikvision",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return id;
}

async function writeCheckOut(openRecord, time) {
  const checkInMs =
    openRecord.checkInAt && openRecord.checkInAt.toMillis
      ? openRecord.checkInAt.toMillis()
      : time.getTime();
  const totalMinutes = Math.max(0, Math.round((time.getTime() - checkInMs) / 60000));

  await db.collection("attendance").doc(openRecord.id).set(
    {
      checkOutAt: Timestamp.fromDate(time),
      totalMinutes,
      source: "hikvision",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { id: openRecord.id, totalMinutes };
}

module.exports = {
  resolveEmployee,
  findOpenRecord,
  findLatestRecord,
  writeCheckIn,
  writeCheckOut,
};
