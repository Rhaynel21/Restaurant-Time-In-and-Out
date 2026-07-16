// Seeds dummy data for the newer HR/payroll features that start empty:
//   • allowances (taxable + de-minimis) and LOANS on employee docs
//   • approved LEAVES (so SIL balances + leave pay show)
//   • approved + pending ATTENDANCE REQUESTS (overtime / DTR corrections)
//
// Run from hikvision-bridge/:
//   npm run seed:hr            → write the dummy HR extras
//   npm run seed:hr -- --clean → remove the dummy leaves / requests it created
//
// Idempotent: leaves/requests use stable IDs (dummy-…) and carry
// source:"dummy-seed"; employee-doc fields are merge-only. Dates land in the
// CURRENT month so they line up with the seeded attendance.
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
const { serverTimestamp } = admin.firestore.FieldValue;

const CLEAN = process.argv.includes("--clean");
const SEED_SOURCE = "dummy-seed";
const pad = (n) => String(n).padStart(2, "0");

async function cleanDummy() {
  let removed = 0;
  for (const coll of ["leaves", "attendanceRequests", "memos"]) {
    const snap = await db.collection(coll).where("source", "==", SEED_SOURCE).get();
    for (const d of snap.docs) {
      await d.ref.delete();
      removed += 1;
    }
  }
  console.log(`Removed ${removed} dummy leave/request doc(s). (Employee allowances/loans left as-is.)`);
}

(async () => {
  if (CLEAN) {
    await cleanDummy();
    process.exit(0);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const ymd = (day) => `${year}-${pad(month + 1)}-${pad(day)}`;
  const monthAgo = (n) => {
    const d = new Date(year, month - n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };

  const empSnap = await db.collection("employees").get();
  // Regular staff/managers only (skip the admin/HR system accounts for realism).
  const emps = empSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.accessRole !== "admin" && e.accessRole !== "owner");

  if (emps.length === 0) {
    console.error("No employees found — run `npm run seed` first.");
    process.exit(1);
  }

  let allow = 0, loans = 0, leaves = 0, reqs = 0;

  for (let i = 0; i < emps.length; i += 1) {
    const e = emps[i];
    const kind = i % 4;

    // 1) Allowances / de-minimis on ~half the employees.
    if (i % 2 === 0) {
      await db.collection("employees").doc(e.id).set(
        { allowanceTaxable: 2000, deMinimis: 1500, updatedAt: serverTimestamp() },
        { merge: true },
      );
      allow += 1;
    }

    // 2) Loans on every 3rd employee (SSS loan + a cash advance).
    if (kind === 0) {
      await db.collection("employees").doc(e.id).set(
        {
          loans: [
            { type: "sss", label: "SSS Loan", principal: 20000, monthlyAmortization: 1667, startMonth: monthAgo(2) },
            { type: "cash-advance", label: "Cash Advance", principal: 6000, monthlyAmortization: 2000, startMonth: monthAgo(0) },
          ],
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      loans += 1;
    }

    // 3) Approved leaves on ~every other employee (so SIL used + leave pay show).
    if (i % 2 === 1) {
      const leaveDefs = [
        { n: 0, type: "vacation", start: 8, end: 9, reason: "Family matter" },
        { n: 1, type: "sick", start: 15, end: 15, reason: "Not feeling well" },
      ];
      for (const l of leaveDefs) {
        await db.collection("leaves").doc(`dummy-${e.id}-${l.n}`).set({
          employeeId: e.id,
          employeeName: e.fullName || e.id,
          branchId: e.branchId || null,
          branchName: e.branchName || null,
          type: l.type,
          startDate: ymd(l.start),
          endDate: ymd(l.end),
          days: l.end - l.start + 1,
          reason: l.reason,
          status: "approved",
          reviewedBy: "Dummy Seed",
          reviewNote: null,
          source: SEED_SOURCE,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        leaves += 1;
      }
    }

    // 4) Attendance requests: an approved OT + a DTR correction, and (for a few)
    //    a PENDING one so the approval queue isn't empty.
    if (kind === 1 || kind === 2) {
      await db.collection("attendanceRequests").doc(`dummy-ot-${e.id}`).set({
        employeeId: e.id,
        employeeName: e.fullName || e.id,
        branchId: e.branchId || null,
        branchName: e.branchName || null,
        kind: "overtime",
        date: ymd(10),
        hours: 2,
        correctIn: null,
        correctOut: null,
        reason: "Dinner-service rush",
        status: "approved",
        reviewedBy: "Dummy Seed",
        source: SEED_SOURCE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      reqs += 1;
      await db.collection("attendanceRequests").doc(`dummy-corr-${e.id}`).set({
        employeeId: e.id,
        employeeName: e.fullName || e.id,
        branchId: e.branchId || null,
        branchName: e.branchName || null,
        kind: "correction",
        date: ymd(12),
        hours: null,
        correctIn: "09:00",
        correctOut: "18:00",
        reason: "Forgot to time out",
        status: "approved",
        reviewedBy: "Dummy Seed",
        source: SEED_SOURCE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      reqs += 1;
    }
    if (kind === 3) {
      await db.collection("attendanceRequests").doc(`dummy-pending-${e.id}`).set({
        employeeId: e.id,
        employeeName: e.fullName || e.id,
        branchId: e.branchId || null,
        branchName: e.branchName || null,
        kind: "overtime",
        date: ymd(18),
        hours: 3,
        correctIn: null,
        correctOut: null,
        reason: "Inventory count",
        status: "pending",
        reviewedBy: null,
        source: SEED_SOURCE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      reqs += 1;
    }

    console.log(`  ✓ ${String(e.id).padEnd(12)} ${e.fullName || ""}`);
  }

  // 5) HR memos (sent to everyone).
  const allIds = emps.map((e) => e.id);
  const allNames = emps.map((e) => e.fullName || e.id);
  const memoDefs = [
    { subject: "Holiday Schedule Reminder", content: "Please be reminded to observe the regular holiday schedule this month. Coordinate your shifts with your branch manager." },
    { subject: "Payroll Cutoff", content: "Kindly ensure your DTR is complete and file any correction before the cutoff so payroll is released on time." },
    { subject: "Uniform & Grooming Standards", content: "A gentle reminder to observe the company uniform and grooming standards during service hours. Thank you." },
  ];
  let memos = 0;
  for (const m of memoDefs) {
    await db.collection("memos").doc(`dummy-memo-${memos}`).set({
      subject: m.subject,
      content: m.content,
      recipientIds: allIds,
      recipientNames: allNames,
      status: "sent",
      createdBy: "Dummy Seed",
      source: SEED_SOURCE,
      createdAt: serverTimestamp(),
      sentAt: serverTimestamp(),
    });
    memos += 1;
  }

  // 6) A couple of PENDING leaves so the Approvals queue isn't empty.
  let pending = 0;
  for (const e of emps.slice(0, 2)) {
    await db.collection("leaves").doc(`dummy-pendlv-${e.id}`).set({
      employeeId: e.id,
      employeeName: e.fullName || e.id,
      branchId: e.branchId || null,
      branchName: e.branchName || null,
      type: pending === 0 ? "vacation" : "emergency",
      startDate: ymd(22),
      endDate: ymd(pending === 0 ? 23 : 22),
      days: pending === 0 ? 2 : 1,
      reason: pending === 0 ? "Out of town" : "Family emergency",
      status: "pending",
      reviewedBy: null,
      reviewNote: null,
      source: SEED_SOURCE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    pending += 1;
  }

  console.log(`\nDone. allowances:${allow}  loans:${loans}  leaves:${leaves}(+${pending} pending)  requests:${reqs}  memos:${memos}`);
  console.log("Recompute Payroll (current month) to see leave pay, OT floor, corrections, and loan deductions.");
  console.log("Undo leaves/requests with: npm run seed:hr -- --clean");
  process.exit(0);
})().catch((err) => {
  console.error("seed:hr failed:", err.message || err);
  process.exit(1);
});
