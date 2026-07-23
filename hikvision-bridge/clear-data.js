// Wipe seeded/dummy operational data so the project can be reseeded clean.
//
//   node clear-data.js            → clear attendance, schedules, leaves, memos,
//                                    requests, payroll/labor, notifications, docs,
//                                    device alarms/events, ATS + performance, and
//                                    any junk (non-@qui.local) employees + their Auth.
//   node clear-data.js --all      → the above AND delete EVERY employee doc (a full
//                                    reset; re-run seed-accounts.js afterwards).
//
// PRESERVED: organization/ (branches you configured) and deviceStatus (device).
// PREREQUISITE: hikvision-bridge/serviceAccountKey.json (same key the bridge uses).
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
if (!fs.existsSync(keyPath)) {
  console.error("Missing serviceAccountKey.json in hikvision-bridge/.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();
const fbAuth = admin.auth();

const ALL = process.argv.includes("--all");

// Operational collections that only ever hold seeded/generated data.
const COLLECTIONS = [
  "attendance",
  "schedules",
  "leaves",
  "attendanceRequests",
  "memos",
  "notifications",
  "employeeDocuments",
  "payroll_runs",
  "labor_cost",
  "pos_daily",
  "dtr_locks",
  "deviceAlarms",
  "biometric_events",
  "auditLog",
  "appraisals",
  "disciplinaryActions",
  "jobPosts",
  "applicants",
  "attendance_alerts",
];

async function clearCollection(name) {
  const snap = await db.collection(name).get();
  if (snap.empty) return 0;
  let batch = db.batch();
  let n = 0;
  let total = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    n += 1;
    total += 1;
    if (n === 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return total;
}

(async () => {
  console.log(`Clearing seeded data${ALL ? " (--all: also removing every employee)" : ""}…\n`);

  for (const name of COLLECTIONS) {
    const removed = await clearCollection(name);
    console.log(`  ✓ ${name.padEnd(22)} ${removed} doc(s) removed`);
  }

  // Employees: always drop junk (non-@qui.local, e.g. test/signup leftovers); with
  // --all, drop everyone. Delete the matching Auth user too so logins stay tidy.
  const empSnap = await db.collection("employees").get();
  let empRemoved = 0;
  for (const doc of empSnap.docs) {
    const email = String(doc.get("email") || "").toLowerCase();
    const isJunk = !email.endsWith("@qui.local");
    if (!ALL && !isJunk) continue;
    // Remove the linked Firebase Auth user (junk only, or all under --all).
    try {
      const user = email ? await fbAuth.getUserByEmail(email) : null;
      if (user) await fbAuth.deleteUser(user.uid);
    } catch {
      /* no Auth user — fine */
    }
    await doc.ref.delete();
    empRemoved += 1;
    console.log(`  ✗ employee removed: ${doc.id} (${email || "no email"})`);
  }
  console.log(`\n  ${empRemoved} employee(s) removed.`);

  console.log("\n✅ Clear complete. Next:");
  console.log("   1) node seed-accounts.js   → realistic roster + logins");
  console.log("   2) node seed-dummy.js      → schedules + this-month attendance");
  console.log("   (organization/branches and the device were preserved.)");
  process.exit(0);
})().catch((err) => {
  console.error("Clear failed:", err.message || err);
  process.exit(1);
});
