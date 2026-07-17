// Finds (and with --delete, removes) attendance records whose computation is
// impossible/wrong, regardless of source:
//   • check-out at/before check-in (reversed pair) → shows 00:00
//   • a single pair longer than 16h (forgotten time-out / stale open record)
//   • a stored totalMinutes over 16h
// Open records (no check-out) are left alone. Run report-only first:
//   node clean-bad-attendance.js            → report
//   node clean-bad-attendance.js --delete   → delete the bad records
const path = require("path");
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, "serviceAccountKey.json"))) });
const db = admin.firestore();

const DELETE = process.argv.includes("--delete");
const MAX_MIN = 16 * 60;

(async () => {
  const snap = await db.collection("attendance").get();
  const bad = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const ci = d.checkInAt && d.checkInAt.toMillis ? d.checkInAt.toMillis() : null;
    const co = d.checkOutAt && d.checkOutAt.toMillis ? d.checkOutAt.toMillis() : null;
    if (ci == null || co == null) return; // open records untouched
    const spanMin = Math.round((co - ci) / 60000);
    let reason = null;
    if (co <= ci) reason = "reversed (out<=in)";
    else if (spanMin > MAX_MIN) reason = `span ${(spanMin / 60).toFixed(1)}h > 16h`;
    else if (typeof d.totalMinutes === "number" && d.totalMinutes > MAX_MIN) reason = `total ${(d.totalMinutes / 60).toFixed(1)}h > 16h`;
    else if (spanMin >= 120 && (d.totalMinutes === 0 || d.totalMinutes == null)) reason = `${(spanMin / 60).toFixed(1)}h span but total=${d.totalMinutes}`;
    if (reason) bad.push({ id: doc.id, ref: doc.ref, emp: d.employeeId, src: d.source || "hikvision", reason, spanMin, total: d.totalMinutes });
  });

  console.log(`Scanned ${snap.size} attendance records. Found ${bad.length} bad:\n`);
  for (const b of bad) {
    console.log(`  ${b.emp.padEnd(10)} ${String(b.src).padEnd(11)} ${b.reason.padEnd(22)} stored=${b.total}`);
  }
  if (!bad.length) { process.exit(0); }

  if (DELETE) {
    let n = 0;
    for (const b of bad) { await b.ref.delete(); n += 1; }
    console.log(`\nDeleted ${n} bad record(s).`);
  } else {
    console.log(`\n(report only — re-run with --delete to remove them)`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
