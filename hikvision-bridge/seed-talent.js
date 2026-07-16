// Seeds dummy data for the Recruitment/ATS and Performance modules so they
// don't start empty:
//   • jobPosts  + applicants (spread across the hiring pipeline)
//   • appraisals (scored KPIs) for a few employees
//   • disciplinaryActions (one open, one resolved)
//
// Run from hikvision-bridge/:
//   npm run seed:talent            → write dummy talent data
//   npm run seed:talent -- --clean → remove what this seeder created
//
// Idempotent: everything carries source:"dummy-seed"; job posts/applicants use
// stable dummy-… IDs.
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
  for (const coll of ["jobPosts", "applicants", "appraisals", "disciplinaryActions"]) {
    const snap = await db.collection(coll).where("source", "==", SEED_SOURCE).get();
    for (const d of snap.docs) {
      await d.ref.delete();
      removed += 1;
    }
  }
  console.log(`Removed ${removed} dummy talent doc(s).`);
}

(async () => {
  if (CLEAN) {
    await cleanDummy();
    process.exit(0);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const ymd = (day) => `${year}-${pad(month + 1)}-${pad(day)}`;

  // ── Job posts + applicants ──────────────────────────────────────────────
  const POSTS = [
    { id: "dummy-post-cook", title: "Line Cook", department: "Kitchen", branchName: "Main Branch", openings: 2, description: "Prep and cook menu items to spec. 1+ yr commercial kitchen experience.", status: "open" },
    { id: "dummy-post-server", title: "Server / Wait Staff", department: "Front of House", branchName: "Main Branch", openings: 3, description: "Take orders, serve guests, maintain floor cleanliness. Friendly and fast.", status: "open" },
    { id: "dummy-post-cashier", title: "Cashier", department: "Front of House", branchName: "Main Branch", openings: 1, description: "Handle POS, cash, and daily reconciliation. Attention to detail a must.", status: "closed" },
  ];

  const APPLICANTS = [
    { post: "dummy-post-cook", name: "Marco Reyes", email: "marco.reyes@example.com", phone: "0917-100-1001", stage: "interview", notes: "3 yrs at a hotel kitchen. Strong on the grill station." },
    { post: "dummy-post-cook", name: "Liza Santos", email: "liza.santos@example.com", phone: "0917-100-1002", stage: "screening", notes: "Culinary graduate, no restaurant experience yet." },
    { post: "dummy-post-cook", name: "Jun Dela Cruz", email: "jun.delacruz@example.com", phone: "0917-100-1003", stage: "applied", notes: "" },
    { post: "dummy-post-server", name: "Anna Lim", email: "anna.lim@example.com", phone: "0917-100-1004", stage: "offer", notes: "Great personality, prior cafe experience. Reference checked." },
    { post: "dummy-post-server", name: "Paolo Garcia", email: "paolo.garcia@example.com", phone: "0917-100-1005", stage: "applied", notes: "" },
    { post: "dummy-post-server", name: "Kim Tan", email: "kim.tan@example.com", phone: "0917-100-1006", stage: "rejected", notes: "Schedule conflict with our shifts." },
    { post: "dummy-post-cashier", name: "Rica Flores", email: "rica.flores@example.com", phone: "0917-100-1007", stage: "hired", notes: "Hired — starts next cutoff." },
  ];

  for (const p of POSTS) {
    const { id, ...data } = p;
    await db.collection("jobPosts").doc(id).set({ ...data, source: SEED_SOURCE, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  let appCount = 0;
  for (let i = 0; i < APPLICANTS.length; i += 1) {
    const a = APPLICANTS[i];
    const post = POSTS.find((p) => p.id === a.post);
    await db.collection("applicants").doc(`dummy-appl-${i}`).set({
      jobPostId: a.post,
      jobTitle: post ? post.title : "",
      name: a.name,
      email: a.email,
      phone: a.phone,
      stage: a.stage,
      notes: a.notes,
      source: SEED_SOURCE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    appCount += 1;
  }

  // ── Appraisals + disciplinary (need real employees) ─────────────────────
  const empSnap = await db.collection("employees").get();
  const emps = empSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.accessRole !== "admin" && e.accessRole !== "owner");

  const KPIS = ["Quality of Work", "Productivity", "Punctuality & Attendance", "Teamwork", "Customer Service"];
  const nameOf = (e) => e.fullName || [e.firstName, e.lastName].filter(Boolean).join(" ") || e.id;
  const avg = (ks) => Math.round((ks.reduce((t, k) => t + k.score, 0) / ks.length) * 100) / 100;

  let apr = 0, disc = 0;
  const reviewPeriod = `${year} ${month < 6 ? "H1" : "H2"}`;

  for (let i = 0; i < Math.min(4, emps.length); i += 1) {
    const e = emps[i];
    const kpis = KPIS.map((name, j) => ({ name, score: 3 + ((i + j) % 3) })); // 3..5
    const overall = avg(kpis);
    await db.collection("appraisals").doc(`dummy-apr-${i}`).set({
      employeeId: e.id,
      employeeName: nameOf(e),
      period: reviewPeriod,
      reviewer: "HR Manager",
      kpis,
      overall,
      strengths: "Reliable, works well under pressure, positive attitude with guests.",
      improvements: "Could improve consistency on plating standards during peak hours.",
      status: i === 0 ? "draft" : "final",
      source: SEED_SOURCE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    apr += 1;
  }

  if (emps.length > 0) {
    await db.collection("disciplinaryActions").doc("dummy-disc-0").set({
      employeeId: emps[0].id,
      employeeName: nameOf(emps[0]),
      type: "Verbal Warning",
      incidentDate: ymd(5),
      description: "Late for shift twice within the same week without prior notice.",
      action: "Verbal reminder issued; expected to notify supervisor for any tardiness.",
      status: "resolved",
      issuedBy: "HR Manager",
      source: SEED_SOURCE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    disc += 1;
  }
  if (emps.length > 1) {
    await db.collection("disciplinaryActions").doc("dummy-disc-1").set({
      employeeId: emps[1].id,
      employeeName: nameOf(emps[1]),
      type: "Written Warning",
      incidentDate: ymd(12),
      description: "Failure to follow food-safety storage procedure on the line.",
      action: "Written warning filed; re-briefed on HACCP storage protocol.",
      status: "open",
      issuedBy: "HR Manager",
      source: SEED_SOURCE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    disc += 1;
  }

  console.log(`Seeded: ${POSTS.length} job posts, ${appCount} applicants, ${apr} appraisals, ${disc} disciplinary records.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
