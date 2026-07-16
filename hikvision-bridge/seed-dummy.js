// Seeds realistic DUMMY data across every existing employee, so the HRIS
// features (201 file, split/rotating schedules, DTR OT/UT/night-diff, and the
// live per-branch dashboard) all have something to show.
//
// Run from hikvision-bridge/:
//   npm run seed:dummy          → write profiles + schedules + this-month attendance
//   npm run seed:dummy -- --clean   → remove only the dummy attendance it created
//
// Safe to re-run: everything is deterministic (seeded by employee ID) and
// merge-only. It never deletes real fields; attendance docs use the stable ID
// `dummy-<empId>-<YYYY-MM-DD>` and carry `source: "dummy-seed"` so they can be
// distinguished from real biometric punches and cleaned up.
//
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
const { Timestamp, FieldValue } = admin.firestore;

const CLEAN = process.argv.includes("--clean");
const SEED_SOURCE = "dummy-seed";

// ── Deterministic PRNG so re-runs produce identical data ─────────────────────
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function digitsFrom(seed, n) {
  const r = mulberry32(seed);
  let s = "";
  for (let i = 0; i < n; i += 1) s += Math.floor(r() * 10);
  return s;
}
function pick(seed, arr) {
  return arr[Math.floor(mulberry32(seed)() * arr.length)];
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function pad(n) {
  return String(n).padStart(2, "0");
}
function toYMD(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysBetween(aYMD, bYMD) {
  const [ay, am, ad] = aYMD.split("-").map(Number);
  const [by, bm, bd] = bYMD.split("-").map(Number);
  const a = new Date(ay, am - 1, ad).getTime();
  const b = new Date(by, bm - 1, bd).getTime();
  return Math.round((b - a) / 86400000);
}
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function at(baseDate, hhmm, extraMin = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), h, m, 0, 0);
  if (extraMin) d.setMinutes(d.getMinutes() + extraMin);
  return d;
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// ── Dummy value pools ────────────────────────────────────────────────────────
const STREETS = ["Rizal St.", "Mabini Ave.", "Bonifacio Dr.", "Katipunan Ave.", "P. Burgos St.", "Aguinaldo Hwy", "Del Pilar St.", "Luna St."];
const CITIES = ["Taguig", "Makati", "Quezon City", "Pasig", "Mandaluyong", "Parañaque", "Manila"];
const BARANGAYS = ["Brgy. San Antonio", "Brgy. Poblacion", "Brgy. Bagumbayan", "Brgy. Santa Cruz", "Brgy. Ugong"];
const GIVEN = ["Maria", "Jose", "Antonio", "Rosa", "Ramon", "Elena", "Pedro", "Cristina", "Miguel", "Teresa", "Andres", "Luz"];
const SUR = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Flores", "Ramos"];
const REL = ["Spouse", "Mother", "Father", "Sibling", "Guardian"];
const GENDERS = ["male", "female"];
const CIVIL = ["single", "married", "widowed", "separated"];

// ── Schedule profiles (guaranteed variety: every employee cycles through these)
// makeWeekly(shift, restDayIndexes) → 7-element weekly grid.
function shift(start, end, segments) {
  return segments ? { off: false, start: segments[0].start, end: segments[segments.length - 1].end, segments } : { off: false, start, end };
}
const REST = { off: true, start: "09:00", end: "18:00" };
function weekly(workShift, restDays) {
  return Array.from({ length: 7 }, (_, d) => (restDays.includes(d) ? { ...REST } : { ...workShift }));
}

function profileFor(index, monthStartYMD) {
  const kind = index % 5;
  if (kind === 1) {
    // Split / broken shift (gap acts as the break → no meal-break punches)
    const s = shift(null, null, [{ start: "10:00", end: "14:00" }, { start: "17:00", end: "22:00" }]);
    return { label: "split", weekly: weekly(s, [0]), restRotation: null, breakStart: null, breakEnd: null };
  }
  if (kind === 2) {
    // Night shift 22:00–06:00 (exercises night differential)
    const s = shift("22:00", "06:00");
    return { label: "night", weekly: weekly(s, [0]), restRotation: null, breakStart: "02:00", breakEnd: "02:30" };
  }
  if (kind === 3) {
    // Rotating rest: 6 days on, 1 off, anchored to the 1st of this month
    const s = shift("08:00", "17:00");
    return {
      label: "rotation",
      weekly: weekly(s, [0]),
      restRotation: { enabled: true, anchorDate: monthStartYMD, workDays: 6, restDays: 1, shift: s },
      breakStart: "12:00",
      breakEnd: "13:00",
    };
  }
  if (kind === 4) {
    // 5-day week (Sat + Sun off)
    const s = shift("09:00", "18:00");
    return { label: "5-day", weekly: weekly(s, [0, 6]), restRotation: null, breakStart: "12:00", breakEnd: "13:00" };
  }
  // Standard restaurant week: Mon–Sat 09:00–18:00, Sun off
  const s = shift("09:00", "18:00");
  return { label: "standard", weekly: weekly(s, [0]), restRotation: null, breakStart: "12:00", breakEnd: "13:00" };
}

function shiftBlocks(s) {
  if (s.off) return [];
  if (s.segments && s.segments.length >= 2) return s.segments;
  return [{ start: s.start, end: s.end }];
}

// Mirror of lib/schedules effectiveShift (override-free, rotation + weekly).
function effectiveShift(profile, date) {
  const rr = profile.restRotation;
  if (rr && rr.enabled) {
    const cycle = rr.workDays + rr.restDays;
    const idx = ((daysBetween(rr.anchorDate, toYMD(date)) % cycle) + cycle) % cycle;
    if (idx >= rr.workDays) return { ...REST };
    return rr.shift;
  }
  return profile.weekly[date.getDay()];
}

// ── 201-file dummy fields for one employee ───────────────────────────────────
function dummyProfileFields(emp, existing) {
  const seed = hashStr(emp.employeeId || emp.id);
  const birthYear = 1980 + (seed % 24); // 1980–2003
  const birthMonth = 1 + (seed % 12);
  const birthDay = 1 + (seed % 28);
  const fields = {
    birthDate: `${birthYear}-${pad(birthMonth)}-${pad(birthDay)}`,
    gender: pick(seed, GENDERS),
    civilStatus: pick(seed ^ 0x9e3779b9, CIVIL),
    address: `${1 + (seed % 200)} ${pick(seed + 1, STREETS)}, ${pick(seed + 2, BARANGAYS)}, ${pick(seed + 3, CITIES)}`,
    emergencyContactName: `${pick(seed + 4, GIVEN)} ${pick(seed + 5, SUR)} (${pick(seed + 6, REL)})`,
    emergencyContactPhone: `0917 ${digitsFrom(seed + 7, 3)} ${digitsFrom(seed + 8, 4)}`,
    sss: `34-${digitsFrom(seed + 10, 7)}-${digitsFrom(seed + 11, 1)}`,
    philhealth: `12-${digitsFrom(seed + 12, 9)}-${digitsFrom(seed + 13, 1)}`,
    pagibig: `${digitsFrom(seed + 14, 4)}-${digitsFrom(seed + 15, 4)}-${digitsFrom(seed + 16, 4)}`,
    tin: `${digitsFrom(seed + 17, 3)}-${digitsFrom(seed + 18, 3)}-${digitsFrom(seed + 19, 3)}-000`,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Only backfill these if the real record hasn't set them.
  if (!existing.department) fields.department = pick(seed + 20, ["Kitchen", "Service", "Bar", "Front of House"]);
  if (existing.dailyRate == null) fields.dailyRate = 610 + (seed % 12) * 45;
  if (!existing.hireDate) fields.hireDate = `${2021 + (seed % 4)}-${pad(1 + (seed % 12))}-${pad(1 + (seed % 27))}`;
  return fields;
}

// ── Attendance generation for one working day ────────────────────────────────
// Returns a full attendance doc, or null for an absence / rest day.
function dayAttendance(emp, profile, date, isToday) {
  const s = effectiveShift(profile, date);
  if (s.off) return null;

  const seed = hashStr(emp.employeeId) ^ Math.imul(date.getDate() + 1, 2654435761);
  const rnd = mulberry32(seed);
  const r = rnd();

  // ~7% absences on past days (never for today — today is an open shift).
  if (!isToday && r < 0.07) return null;

  const blocks = shiftBlocks(s);
  const firstStart = blocks[0].start;
  const lastEnd = blocks[blocks.length - 1].end;
  const crossesMidnight = toMin(lastEnd) <= toMin(firstStart);

  // Clock-in jitter: usually on time, sometimes late.
  const rl = rnd();
  const lateJitter = rl < 0.75 ? Math.round((rnd() - 0.5) * 10) : 10 + Math.floor(rnd() * 35);
  const inAt = at(date, firstStart, lateJitter);

  if (isToday) {
    // Open shift → shows as "On shift" on the live dashboard.
    return {
      employeeId: emp.employeeId,
      employeeName: emp.fullName,
      branchId: emp.branchId || "kio-bgc",
      branchName: emp.branchName || "Qui - BGC",
      checkInAt: Timestamp.fromDate(inAt),
      checkOutAt: null,
      breakOutAt: null,
      breakInAt: null,
      checkInLocation: null,
      checkOutLocation: null,
      totalMinutes: null,
      source: SEED_SOURCE,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  // Clock-out jitter: mostly near schedule, sometimes OT, sometimes undertime.
  const ro = rnd();
  let outJitter;
  if (ro < 0.6) outJitter = Math.round((rnd() - 0.5) * 20);
  else if (ro < 0.85) outJitter = 45 + Math.floor(rnd() * 90); // overtime
  else outJitter = -(40 + Math.floor(rnd() * 70)); // undertime
  const outBase = crossesMidnight ? addDays(date, 1) : date;
  const outAt = at(outBase, lastEnd, outJitter);

  // Meal break punches only for single-block shifts that define a break window.
  let breakOutAt = null;
  let breakInAt = null;
  let breakMinutes = 0;
  if (blocks.length === 1 && profile.breakStart && profile.breakEnd) {
    const bOutBase = crossesMidnight && toMin(profile.breakStart) < toMin(firstStart) ? addDays(date, 1) : date;
    const bInBase = crossesMidnight && toMin(profile.breakEnd) < toMin(firstStart) ? addDays(date, 1) : date;
    const bo = at(bOutBase, profile.breakStart, Math.round((rnd() - 0.5) * 8));
    const bi = at(bInBase, profile.breakEnd, Math.round((rnd() - 0.5) * 8));
    if (bi > bo) {
      breakOutAt = bo;
      breakInAt = bi;
      breakMinutes = Math.round((bi.getTime() - bo.getTime()) / 60000);
    }
  }

  const gross = Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / 60000));
  const totalMinutes = Math.max(0, gross - breakMinutes);

  return {
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    branchId: emp.branchId || "kio-bgc",
    branchName: emp.branchName || "Qui - BGC",
    checkInAt: Timestamp.fromDate(inAt),
    checkOutAt: Timestamp.fromDate(outAt),
    breakOutAt: breakOutAt ? Timestamp.fromDate(breakOutAt) : null,
    breakInAt: breakInAt ? Timestamp.fromDate(breakInAt) : null,
    checkInLocation: null,
    checkOutLocation: null,
    totalMinutes,
    source: SEED_SOURCE,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// ── Cleanup: delete only the dummy attendance this script created ────────────
async function cleanDummyAttendance() {
  const snap = await db.collection("attendance").where("source", "==", SEED_SOURCE).get();
  if (snap.empty) {
    console.log("No dummy attendance to remove.");
    return;
  }
  let batch = db.batch();
  let n = 0;
  let removed = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    n += 1;
    removed += 1;
    if (n === 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  console.log(`Removed ${removed} dummy attendance record(s).`);
}

(async () => {
  if (CLEAN) {
    await cleanDummyAttendance();
    process.exit(0);
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthStartYMD = `${year}-${pad(month + 1)}-01`;
  const todayDay = today.getDate();

  const empSnap = await db.collection("employees").get();
  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (employees.length === 0) {
    console.error("No employees found — run `npm run seed` first.");
    process.exit(1);
  }

  console.log(`Seeding dummy data for ${employees.length} employee(s) — ${monthStartYMD} → ${toYMD(today)}\n`);

  let attWrites = 0;
  let batch = db.batch();
  let pending = 0;
  const commitIfFull = async () => {
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (let i = 0; i < employees.length; i += 1) {
    const raw = employees[i];
    const emp = {
      employeeId: raw.employeeId || raw.id,
      fullName: raw.fullName || `${raw.firstName || ""} ${raw.lastName || ""}`.trim() || raw.id,
      branchId: raw.branchId || null,
      branchName: raw.branchName || null,
    };
    const profile = profileFor(i, monthStartYMD);

    // 1) 201-file profile fields (merge — never clobbers real data).
    batch.set(db.collection("employees").doc(raw.id), dummyProfileFields(raw, raw), { merge: true });
    pending += 1;
    await commitIfFull();

    // 2) Schedule doc.
    batch.set(
      db.collection("schedules").doc(emp.employeeId),
      {
        employeeId: emp.employeeId,
        employeeName: emp.fullName,
        branchId: emp.branchId,
        branchName: emp.branchName,
        weekly: profile.weekly,
        overrides: {},
        restRotation: profile.restRotation,
        breakStart: profile.breakStart,
        breakEnd: profile.breakEnd,
        updatedBy: "dummy-seed",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    pending += 1;
    await commitIfFull();

    // 3) This-month attendance (day 1 … today).
    for (let day = 1; day <= todayDay; day += 1) {
      const date = new Date(year, month, day);
      const doc = dayAttendance(emp, profile, date, day === todayDay);
      if (!doc) continue;
      const id = `dummy-${emp.employeeId}-${toYMD(date)}`;
      batch.set(db.collection("attendance").doc(id), doc);
      pending += 1;
      attWrites += 1;
      await commitIfFull();
    }

    console.log(`  ✓ ${String(emp.employeeId).padEnd(12)} ${profile.label.padEnd(9)} ${emp.fullName}`);
  }

  if (pending > 0) await batch.commit();

  console.log(`\nDone. Profiles + schedules for ${employees.length} employee(s); ${attWrites} attendance record(s).`);
  console.log("Open DTR for any employee (this month) to see OT / UT / Night-diff, and the");
  console.log("Attendance tab for the live per-branch board. Undo attendance with: npm run seed:dummy -- --clean");
  process.exit(0);
})().catch((err) => {
  console.error("Dummy seed failed:", err.message || err);
  process.exit(1);
});
