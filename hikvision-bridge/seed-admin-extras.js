// Seeds the last few admin tabs that start empty:
//   • deviceAlarms  (Devices tab — tamper/security alarms)
//   • auditLog      (Audit tab — who changed what)
//   • notifications (employee bell — a couple per staff)
//   • payrollFormula on the company doc (Payroll tab shows a saved config)
//
// Run from hikvision-bridge/:
//   npm run seed:admin            → write the dummy admin data
//   npm run seed:admin -- --clean → remove what this seeder created
//
// Idempotent: alarms/audit/notifs use stable dummy-… IDs and carry
// source:"dummy-seed".
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
const { Timestamp } = admin.firestore;
const { serverTimestamp } = admin.firestore.FieldValue;

const CLEAN = process.argv.includes("--clean");
const SEED_SOURCE = "dummy-seed";
const DEVICE_ID = "hik-bgc-01";
const DEVICE_NAME = "Qui - BGC Terminal";
const hoursAgo = (h) => Timestamp.fromMillis(Date.now() - h * 3600 * 1000);

async function cleanDummy() {
  let removed = 0;
  for (const coll of ["deviceAlarms", "auditLog", "notifications"]) {
    const snap = await db.collection(coll).where("source", "==", SEED_SOURCE).get();
    for (const d of snap.docs) {
      await d.ref.delete();
      removed += 1;
    }
  }
  console.log(`Removed ${removed} dummy admin doc(s). (payrollFormula left as-is.)`);
}

(async () => {
  if (CLEAN) {
    await cleanDummy();
    process.exit(0);
  }

  // ── Device alarms ───────────────────────────────────────────────────────
  const ALARMS = [
    { key: "tamper", type: "Tamper", severity: "critical", message: "Device enclosure opened — possible tampering.", acknowledged: false, h: 3 },
    { key: "offline", type: "Connectivity", severity: "warning", message: "Terminal lost network for 8 minutes; scans were buffered and synced.", acknowledged: false, h: 20 },
    { key: "failauth", type: "Security", severity: "warning", message: "5 failed fingerprint attempts on an unknown finger.", acknowledged: true, h: 46 },
  ];
  for (const a of ALARMS) {
    await db.collection("deviceAlarms").doc(`dummy-alarm-${a.key}`).set({
      deviceId: DEVICE_ID,
      deviceName: DEVICE_NAME,
      type: a.type,
      severity: a.severity,
      message: a.message,
      acknowledged: a.acknowledged,
      at: hoursAgo(a.h),
      source: SEED_SOURCE,
      updatedAt: serverTimestamp(),
    });
  }

  // Make sure a matching device row exists so the Devices tab isn't empty.
  await db.collection("deviceStatus").doc(DEVICE_ID).set(
    { deviceId: DEVICE_ID, deviceName: DEVICE_NAME, online: true, queueDepth: 0, lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );

  // ── Audit log ───────────────────────────────────────────────────────────
  const AUDITS = [
    { action: "save", entity: "employee", entityId: "EMP-1001", summary: "Juan Dela Cruz record saved", actor: "Hazel Ramos", h: 1 },
    { action: "approve", entity: "leave", entityId: "dummy-leave-2", summary: "Approved sick leave for Ana Reyes", actor: "Maria Santos", h: 4 },
    { action: "save", entity: "payroll", entityId: "qui", summary: "Payroll formula updated (semimonthly)", actor: "Hazel Ramos", h: 26 },
    { action: "approve", entity: "request", entityId: "dummy-ot-1", summary: "Approved 2h overtime for Mark Villanueva", actor: "Maria Santos", h: 27 },
    { action: "finalize", entity: "appraisal", entityId: "dummy-apr-1", summary: "Finalized appraisal for Ana Reyes (2026 H1)", actor: "Hazel Ramos", h: 50 },
    { action: "create", entity: "discipline", entityId: "dummy-disc-1", summary: "Written Warning issued to Ana Reyes", actor: "Hazel Ramos", h: 51 },
    { action: "delete", entity: "employee", entityId: "EMP-9999", summary: "Removed test employee record", actor: "Qui Admin", h: 72 },
  ];
  for (let i = 0; i < AUDITS.length; i += 1) {
    const a = AUDITS[i];
    await db.collection("auditLog").doc(`dummy-audit-${i}`).set({
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      summary: a.summary,
      actor: a.actor,
      at: hoursAgo(a.h),
      source: SEED_SOURCE,
    });
  }

  // ── Notifications (employee bell) ───────────────────────────────────────
  const NOTIFS = [
    { to: "EMP-1001", title: "Overtime approved", body: "Your 2h overtime on the 14th was approved.", kind: "success", read: false, h: 2 },
    { to: "EMP-1001", title: "Performance review", body: "Your 2026 H1 appraisal is ready: Exceeds Expectations.", kind: "info", read: false, h: 30 },
    { to: "EMP-1002", title: "Leave approved", body: "Your sick leave was approved.", kind: "success", read: false, h: 5 },
    { to: "EMP-1002", title: "HR notice", body: "A written warning has been recorded on your file. Please see HR.", kind: "warning", read: true, h: 52 },
  ];
  for (let i = 0; i < NOTIFS.length; i += 1) {
    const n = NOTIFS[i];
    await db.collection("notifications").doc(`dummy-notif-${i}`).set({
      toEmployeeId: n.to,
      title: n.title,
      body: n.body,
      kind: n.kind,
      read: n.read,
      createdAt: hoursAgo(n.h),
      source: SEED_SOURCE,
    });
  }

  // ── Payroll formula on the company doc (Payroll tab shows a saved config) ─
  await db.collection("companies").doc("qui").set(
    {
      payrollFormula: {
        hoursPerDay: 8,
        otPremium: 0.25,
        nightDiff: 0.1,
        regHolidayPremium: 1.0,
        specialHolidayPremium: 0.3,
        payFrequency: "semimonthly",
        cutoffDay: 15,
        contributionOn: "second",
        deMinimisCap: 0,
      },
      payrollFormulaUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  console.log(`Seeded: ${ALARMS.length} device alarms, ${AUDITS.length} audit entries, ${NOTIFS.length} notifications, payroll formula.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
