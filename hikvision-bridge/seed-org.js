// Assigns EVERY employee (and the admin/manager accounts) to the "qui" company +
// brand, and marks them active. This is what makes the branch-scoped tabs
// (Documents, Payroll, Attendance, DTR, Dashboard) actually show data: those tabs
// filter employees through the Org branch scope derived from the signed-in user's
// companyId. Without companyId on the accounts, an admin's scope resolves to zero
// branches and every employee is filtered out ("Loading employees…" forever).
//
// Run from hikvision-bridge/:  npm run seed:org
//
// Idempotent + merge-only: never deletes real fields. Ensures the org tree
// (Company "qui" → Brand "qui" → the branches) exists, then stamps
// companyId/brandId on every employee and defaults status to "active".
//
// PREREQUISITE: hikvision-bridge/serviceAccountKey.json.
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

const COMPANY_ID = "qui";
const BRAND_ID = "qui";

// Branch catalog (ids match those already stamped on employee/attendance docs).
const BRANCHES = [
  { id: "kio-qc", name: "Qui - Quezon City", address: "32 Tomas Morato Ave, Quezon City" },
  { id: "kio-makati", name: "Qui - Makati", address: "5th Floor, Paseo Tower, Makati City" },
  { id: "kio-bgc", name: "Qui - BGC", address: "26th St, Bonifacio Global City, Taguig" },
];

async function ensureOrgTree() {
  await db.collection("companies").doc(COMPANY_ID).set(
    { name: "Qui", code: "QUI", updatedAt: serverTimestamp() },
    { merge: true },
  );
  const brandRef = db.collection("companies").doc(COMPANY_ID).collection("brands").doc(BRAND_ID);
  await brandRef.set({ name: "Qui", code: "QUI", updatedAt: serverTimestamp() }, { merge: true });
  for (const b of BRANCHES) {
    await brandRef.collection("branches").doc(b.id).set(
      { name: b.name, code: b.id.toUpperCase(), address: b.address, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }
  console.log(`Org tree ensured: company "${COMPANY_ID}" → brand "${BRAND_ID}" → ${BRANCHES.length} branches.`);
}

(async () => {
  await ensureOrgTree();

  const snap = await db.collection("employees").get();
  if (snap.empty) {
    console.error("No employees found — run `npm run seed` first.");
    process.exit(1);
  }

  const branchIds = new Set(BRANCHES.map((b) => b.id));
  let batch = db.batch();
  let pending = 0;
  let assigned = 0;
  const commitIfFull = async () => {
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (const d of snap.docs) {
    const data = d.data();
    // Keep an existing branch if it's one of ours; otherwise default to BGC.
    const branchId = branchIds.has(data.branchId) ? data.branchId : "kio-bgc";
    const branch = BRANCHES.find((b) => b.id === branchId);
    const update = {
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      branchId,
      branchName: data.branchName || branch.name,
      updatedAt: serverTimestamp(),
    };
    // Only default status when it isn't already set (never demote a real record).
    if (data.status !== "active" && data.status !== "inactive") update.status = "active";
    batch.set(d.ref, update, { merge: true });
    pending += 1;
    assigned += 1;
    await commitIfFull();
    console.log(`  ✓ ${d.id.padEnd(12)} → ${COMPANY_ID}/${BRAND_ID}/${branchId}`);
  }

  if (pending > 0) await batch.commit();

  console.log(`\nDone. ${assigned} employee(s) assigned to the "${COMPANY_ID}" organization.`);
  console.log("Documents, Payroll, Attendance, DTR and the Dashboard should now show data for the admin.");
  process.exit(0);
})().catch((err) => {
  console.error("seed:org failed:", err.message || err);
  process.exit(1);
});
