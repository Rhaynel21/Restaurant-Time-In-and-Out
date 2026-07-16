// Sets Firebase Auth CUSTOM CLAIMS (role + employeeId + companyId + branchId) on
// every auth user, read from their employees/{id} profile. The RBAC Firestore
// rules read these claims from request.auth.token to decide access.
//
// Run from hikvision-bridge/:  npm run seed:claims
//
// ⚠️  DEPLOY ORDER MATTERS — run THIS first, have everyone RE-LOGIN (a fresh
// sign-in mints a token that carries the new claims), and ONLY THEN deploy the
// RBAC rules. If you deploy the rules before claims exist, users have no `role`
// in their token and get locked out.
//
// Re-run it any time you change someone's accessRole / branch / company.
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

(async () => {
  const snap = await db.collection("employees").get();
  let set = 0;
  let skipped = 0;
  for (const d of snap.docs) {
    const e = d.data();
    if (!e.uid) {
      skipped += 1; // no Firebase Auth user → can't sign in, no claims needed
      continue;
    }
    const claims = {
      role: ["owner", "admin", "hr", "manager", "staff"].includes(e.accessRole) ? e.accessRole : "staff",
      employeeId: d.id,
      companyId: e.companyId || null,
      branchId: e.branchId || null,
    };
    try {
      await admin.auth().setCustomUserClaims(e.uid, claims);
      console.log(`  ✓ ${d.id.padEnd(12)} ${claims.role.padEnd(8)} ${e.email || ""}`);
      set += 1;
    } catch (err) {
      console.warn(`  ! ${d.id}: ${err.message}`);
    }
  }
  console.log(`\nDone. Claims set on ${set} user(s); ${skipped} profile(s) without a uid (no login).`);
  console.log("→ Have users RE-LOGIN so their token picks up the claims, THEN deploy the RBAC rules.");
  process.exit(0);
})().catch((err) => {
  console.error("set:claims failed:", err.message || err);
  process.exit(1);
});
