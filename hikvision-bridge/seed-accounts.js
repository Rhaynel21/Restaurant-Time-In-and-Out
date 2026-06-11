// Seeds role-based accounts using Firebase Authentication (email/password) plus
// an `employees` profile doc (keyed by Employee ID, linked by uid + email).
// Run from hikvision-bridge/:  npm run seed
//
// Re-running is idempotent: existing auth users have their password reset to the
// value below, and profile docs are upserted. Any legacy salt/passwordHash
// fields from the old Firestore-credential scheme are removed.
//
// PREREQUISITE: enable Email/Password in Firebase Console →
//   Authentication → Sign-in method → Email/Password → Enable.
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

// Accounts to provision, one per role. Change passwords after first login.
const ACCOUNTS = [
  { employeeId: "ADMIN-001", fullName: "Thyme Admin", email: "admin@thymein.local",   phone: "+63 917 000 0001", role: "Administrator", accessRole: "admin",   branchId: "kio-bgc",    branchName: "Thyme In - BGC",    password: "admin123" },
  { employeeId: "MGR-001",   fullName: "Maria Santos", email: "manager@thymein.local", phone: "+63 917 000 0002", role: "Branch Manager", accessRole: "manager", branchId: "kio-bgc",    branchName: "Thyme In - BGC",    password: "manager123" },
  { employeeId: "EMP-1001",  fullName: "Juan Dela Cruz", email: "juan@thymein.local",  phone: "+63 917 000 0003", role: "Line Cook",      accessRole: "staff",   branchId: "kio-bgc",    branchName: "Thyme In - BGC",    password: "staff123" },
  { employeeId: "EMP-1002",  fullName: "Ana Reyes",     email: "ana@thymein.local",    phone: "+63 917 000 0004", role: "Server",         accessRole: "staff",   branchId: "kio-makati", branchName: "Thyme In - Makati", password: "staff123" },
];

async function ensureAuthUser(acc) {
  try {
    const existing = await fbAuth.getUserByEmail(acc.email);
    await fbAuth.updateUser(existing.uid, { password: acc.password, displayName: acc.fullName });
    return existing.uid;
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      const created = await fbAuth.createUser({
        email: acc.email,
        password: acc.password,
        displayName: acc.fullName,
        emailVerified: true,
      });
      return created.uid;
    }
    throw e;
  }
}

(async () => {
  console.log("Seeding Firebase Auth users + profiles…\n");
  for (const acc of ACCOUNTS) {
    const uid = await ensureAuthUser(acc);
    const [firstName, ...rest] = acc.fullName.split(" ");
    await db.collection("employees").doc(acc.employeeId).set(
      {
        employeeId: acc.employeeId,
        uid,
        firstName,
        lastName: rest.join(" "),
        fullName: acc.fullName,
        email: acc.email.toLowerCase(),
        phone: acc.phone,
        role: acc.role,
        accessRole: acc.accessRole,
        branchId: acc.branchId,
        branchName: acc.branchName,
        // Remove legacy Firestore-credential fields if present.
        salt: admin.firestore.FieldValue.delete(),
        passwordHash: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`  ✓ ${acc.accessRole.padEnd(8)} ${acc.employeeId.padEnd(10)} ${acc.email}  (uid ${uid.slice(0, 8)}…)`);
  }

  console.log("\n────────── ACCOUNTS (sign in with Employee ID or email) ──────────");
  console.log("ROLE      EMPLOYEE ID   EMAIL                      PASSWORD     WHERE");
  for (const a of ACCOUNTS) {
    const where = a.accessRole === "staff" ? "Mobile app" : "Web portal";
    console.log(`${a.accessRole.padEnd(9)} ${a.employeeId.padEnd(13)} ${a.email.padEnd(26)} ${a.password.padEnd(12)} ${where}`);
  }
  console.log("──────────────────────────────────────────────────────────────────");
  console.log("⚠  Enable Email/Password in Firebase Console if you haven't, and change");
  console.log("   these demo passwords after first login.");
  process.exit(0);
})().catch((err) => {
  console.error("Seed failed:", err.message || err);
  if ((err.message || "").includes("CONFIGURATION_NOT_FOUND") || err.code === "auth/configuration-not-found") {
    console.error("\n→ Enable Authentication in the Firebase Console first:");
    console.error("  Build → Authentication → Get started → Email/Password → Enable.");
  }
  process.exit(1);
});
