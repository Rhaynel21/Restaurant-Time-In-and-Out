// Seeds a realistic role-based roster: Firebase Auth (email/password) + an
// `employees` profile doc per person (keyed by Employee ID, linked by uid + email).
// Run from hikvision-bridge/:  node seed-accounts.js
//
// Re-running is idempotent: Auth passwords are reset and profile docs upserted.
// Rates, department, hire date, and worker type are set here so the roster is
// realistic out of the box (seed-dummy.js only backfills 201 details + attendance).
//
// PREREQUISITE: Email/Password enabled in Firebase Console → Authentication.
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

// Branches (must match organization/qui/brands/qui/branches/*):
const BGC = { id: "kio-bgc", name: "Qui - BGC" };
const MKT = { id: "kio-makati", name: "Qui - Makati" };
const QC = { id: "kio-qc", name: "Qui - Quezon City" };
const MNL = { id: "qui-manila", name: "Qui Manila" };

// Realistic NCR daily rates by role (2024 minimum wage ≈ ₱610/day).
function w(role, ...rest) {
  const RATE = {
    Administrator: 2000, "HR Officer": 1200, "Area Manager": 1800, "Branch Manager": 1500,
    "Shift Supervisor": 950, "Sous Chef": 1100, "Head Server": 800, "Line Cook": 750,
    Barista: 700, Cashier: 680, Server: 650, "Kitchen Helper": 620, Dishwasher: 610,
  };
  return { role, dailyRate: RATE[role] ?? 610, ...Object.assign({}, ...rest) };
}
const DEPT = { Management: "Management", HR: "HR", Kitchen: "Kitchen", Service: "Service", Bar: "Bar" };

// employeeId, fullName, email, phone, accessRole, branch, role(+rate), department,
// hireDate, workerType(optional, default "regular"), password.
const ACCOUNTS = [
  // ── Corporate / management ──
  { id: "ADMIN-001", name: "Qui Admin",       email: "admin@qui.local",   phone: "+63 917 000 0001", accessRole: "admin",       branch: BGC, dept: DEPT.Management, hire: "2021-01-05", pw: "admin123",   ...w("Administrator") },
  { id: "HR-001",    name: "Hazel Ramos",     email: "hr@qui.local",      phone: "+63 917 000 0011", accessRole: "hr",          branch: BGC, dept: DEPT.HR,         hire: "2021-03-15", pw: "hr123456",   ...w("HR Officer") },
  { id: "AREA-001",  name: "Diego Ramos",     email: "area@qui.local",    phone: "+63 917 000 0012", accessRole: "areaManager", branch: BGC, dept: DEPT.Management, hire: "2021-02-01", pw: "area12345",  branchIds: ["kio-bgc", "kio-makati"], ...w("Area Manager") },

  // ── Branch managers (one per branch — Qui Manila now covered) ──
  { id: "MGR-001",   name: "Maria Santos",    email: "manager@qui.local", phone: "+63 917 000 0002", accessRole: "manager", branch: BGC, dept: DEPT.Management, hire: "2021-04-01", pw: "manager123", ...w("Branch Manager") },
  { id: "MGR-002",   name: "Carlo Mendoza",   email: "carlo@qui.local",   phone: "+63 917 000 0005", accessRole: "manager", branch: MKT, dept: DEPT.Management, hire: "2021-06-10", pw: "manager123", ...w("Branch Manager") },
  { id: "MGR-003",   name: "Liza Tan",        email: "liza@qui.local",    phone: "+63 917 000 0006", accessRole: "manager", branch: QC,  dept: DEPT.Management, hire: "2021-08-20", pw: "manager123", ...w("Branch Manager") },
  { id: "MGR-004",   name: "Rafael Domingo",  email: "rafael@qui.local",  phone: "+63 917 000 0013", accessRole: "manager", branch: MNL, dept: DEPT.Management, hire: "2022-01-15", pw: "manager123", ...w("Branch Manager") },

  // ── BGC crew ──
  { id: "EMP-1003",  name: "Mark Villanueva", email: "mark@qui.local",    phone: "+63 917 000 0007", accessRole: "staff", branch: BGC, dept: DEPT.Kitchen, hire: "2021-05-02", pw: "staff123", ...w("Sous Chef") },
  { id: "EMP-1007",  name: "Nico Aquino",     email: "nico@qui.local",    phone: "+63 917 000 0014", accessRole: "staff", branch: BGC, dept: DEPT.Kitchen, hire: "2022-07-11", pw: "staff123", ...w("Line Cook") },
  { id: "EMP-1008",  name: "Trisha Bautista", email: "trisha@qui.local",  phone: "+63 917 000 0015", accessRole: "staff", branch: BGC, dept: DEPT.Service, hire: "2023-02-06", pw: "staff123", workerType: "parttime", ...w("Server") },

  // ── Makati crew ──
  { id: "EMP-1002",  name: "Ana Reyes",       email: "ana@qui.local",     phone: "+63 917 000 0004", accessRole: "staff", branch: MKT, dept: DEPT.Service, hire: "2021-09-13", pw: "staff123", ...w("Head Server") },
  { id: "EMP-1005",  name: "Paolo Garcia",    email: "paolo@qui.local",   phone: "+63 917 000 0009", accessRole: "staff", branch: MKT, dept: DEPT.Kitchen, hire: "2022-03-21", pw: "staff123", ...w("Dishwasher") },
  { id: "EMP-1009",  name: "Kevin Ocampo",    email: "kevin@qui.local",   phone: "+63 917 000 0016", accessRole: "staff", branch: MKT, dept: DEPT.Service, hire: "2023-05-18", pw: "staff123", ...w("Cashier") },
  { id: "EMP-1013",  name: "Loren Vega",      email: "loren@qui.local",   phone: "+63 917 000 0017", accessRole: "staff", branch: MKT, dept: DEPT.Service, hire: "2024-01-08", pw: "staff123", workerType: "agency", ...w("Server") },

  // ── Quezon City crew ──
  { id: "EMP-1004",  name: "Grace Lim",       email: "grace@qui.local",   phone: "+63 917 000 0008", accessRole: "staff", branch: QC, dept: DEPT.Bar,     hire: "2021-11-02", pw: "staff123", ...w("Barista") },
  { id: "EMP-1006",  name: "Bea Cruz",        email: "bea@qui.local",     phone: "+63 917 000 0010", accessRole: "staff", branch: QC, dept: DEPT.Service, hire: "2022-05-30", pw: "staff123", ...w("Cashier") },
  { id: "EMP-1010",  name: "Angelo Flores",   email: "angelo@qui.local",  phone: "+63 917 000 0018", accessRole: "staff", branch: QC, dept: DEPT.Kitchen, hire: "2023-08-14", pw: "staff123", ...w("Line Cook") },

  // ── Qui Manila crew ──
  { id: "EMP-1001",  name: "Juan Dela Cruz",  email: "juan@qui.local",    phone: "+63 917 000 0003", accessRole: "staff", branch: MNL, dept: DEPT.Kitchen, hire: "2021-07-19", pw: "staff123", ...w("Line Cook") },
  { id: "EMP-1011",  name: "Camille Torres",  email: "camille@qui.local", phone: "+63 917 000 0019", accessRole: "staff", branch: MNL, dept: DEPT.Service, hire: "2022-10-03", pw: "staff123", ...w("Server") },
  { id: "EMP-1012",  name: "Ryan Navarro",    email: "ryan@qui.local",    phone: "+63 917 000 0020", accessRole: "staff", branch: MNL, dept: DEPT.Kitchen, hire: "2024-02-26", pw: "staff123", workerType: "probationary", ...w("Kitchen Helper") },
];

async function ensureAuthUser(acc) {
  try {
    const existing = await fbAuth.getUserByEmail(acc.email);
    await fbAuth.updateUser(existing.uid, { password: acc.pw, displayName: acc.name });
    return existing.uid;
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      const created = await fbAuth.createUser({ email: acc.email, password: acc.pw, displayName: acc.name, emailVerified: true });
      return created.uid;
    }
    throw e;
  }
}

(async () => {
  console.log("Seeding realistic roster (Auth users + profiles)…\n");
  for (const acc of ACCOUNTS) {
    const uid = await ensureAuthUser(acc);
    const [firstName, ...rest] = acc.name.split(" ");
    await db.collection("employees").doc(acc.id).set(
      {
        employeeId: acc.id,
        uid,
        firstName,
        lastName: rest.join(" "),
        fullName: acc.name,
        email: acc.email.toLowerCase(),
        phone: acc.phone,
        role: acc.role,
        department: acc.dept,
        accessRole: acc.accessRole,
        workerType: acc.workerType || "regular",
        payType: "daily",
        dailyRate: acc.dailyRate,
        hireDate: acc.hire,
        // Everyone belongs to the "qui" company + brand (org scope needs companyId).
        companyId: "qui",
        brandId: "qui",
        branchId: acc.branch.id,
        branchIds: acc.branchIds || [],
        branchName: acc.branch.name,
        status: "active",
        inactiveReason: "",
        salt: admin.firestore.FieldValue.delete(),
        passwordHash: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`  ✓ ${acc.accessRole.padEnd(11)} ${acc.id.padEnd(10)} ${acc.name.padEnd(18)} ${String(acc.role).padEnd(15)} ₱${acc.dailyRate}/day  ${acc.branch.name}`);
  }

  console.log(`\n────────── ${ACCOUNTS.length} ACCOUNTS (sign in with Employee ID or email) ──────────`);
  console.log("ROLE        EMPLOYEE ID   EMAIL                       PASSWORD     WHERE");
  for (const a of ACCOUNTS) {
    const where = a.accessRole === "staff" ? "Mobile app" : "Web portal";
    console.log(`${a.accessRole.padEnd(11)} ${a.id.padEnd(13)} ${a.email.padEnd(27)} ${a.pw.padEnd(12)} ${where}`);
  }
  console.log("──────────────────────────────────────────────────────────────────────");
  console.log("⚠  Change these demo passwords after first login. Next: node seed-dummy.js");
  process.exit(0);
})().catch((err) => {
  console.error("Seed failed:", err.message || err);
  if ((err.message || "").includes("CONFIGURATION_NOT_FOUND") || err.code === "auth/configuration-not-found") {
    console.error("\n→ Enable Authentication: Build → Authentication → Get started → Email/Password → Enable.");
  }
  process.exit(1);
});
