// Seeds DUMMY 201-file documents for every employee: uploads small real files to
// Firebase Storage (employee-docs/{empId}/…) with a Firebase download token, and
// writes a metadata row in `employeeDocuments` so they list + open in the portal.
//
// Run from hikvision-bridge/:
//   npm run seed:docs           → upload dummy documents for every employee
//   npm run seed:docs -- --clean    → remove only the dummy docs it created
//
// Idempotent: doc metadata uses stable IDs `dummy-<empId>-<n>` and carries
// `source: "dummy-seed"`; storage paths are deterministic, so re-runs overwrite.
//
// PREREQUISITES: hikvision-bridge/serviceAccountKey.json AND Firebase Storage
// enabled for the project (Console → Build → Storage → Get started).
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const admin = require("firebase-admin");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
if (!fs.existsSync(keyPath)) {
  console.error("Missing serviceAccountKey.json in hikvision-bridge/.");
  process.exit(1);
}
const BUCKET = "kitchen-in-and-out.firebasestorage.app";
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)), storageBucket: BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const { serverTimestamp } = admin.firestore.FieldValue;

const CLEAN = process.argv.includes("--clean");
const SEED_SOURCE = "dummy-seed";

// ── Minimal, valid PDF with correct xref offsets ─────────────────────────────
function makePdf(titleLines) {
  const objs = [];
  objs.push("<</Type/Catalog/Pages 2 0 R>>");
  objs.push("<</Type/Pages/Kids[3 0 R]/Count 1>>");
  objs.push("<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 350]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>");
  let content = "BT /F1 16 Tf 40 300 Td 22 TL ";
  for (const ln of titleLines) content += `(${ln.replace(/([()\\])/g, "\\$1")}) Tj T* `;
  content += "ET";
  objs.push(`<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`);
  objs.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");

  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  body += xref + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

// A small solid-color PNG (32×32) built from scratch — stands in for an ID photo.
function makePng(r, g, b) {
  const W = 32, H = 32;
  const zlib = require("zlib");
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y += 1) {
    const row = y * (1 + W * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < W; x += 1) {
      const p = row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tb = Buffer.from(type, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
    return Buffer.concat([len, tb, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// ── The dummy 201-file set every employee gets ───────────────────────────────
function docSet(emp) {
  const name = emp.fullName || emp.employeeId;
  return [
    {
      file: "Employment Contract.pdf",
      contentType: "application/pdf",
      bytes: makePdf(["QUI  ·  PAN-ASIAN BRASSERIE", "", "EMPLOYMENT CONTRACT", "", `Employee: ${name}`, `Employee ID: ${emp.employeeId}`, `Position: ${emp.role || "Staff"}`, `Branch: ${emp.branchName || ""}`, "", "*** DUMMY DOCUMENT — for demo only ***"]),
    },
    {
      file: "Resume.pdf",
      contentType: "application/pdf",
      bytes: makePdf(["RESUME", "", name, emp.email || "", "", "Experience, skills and references", "would appear here.", "", "*** DUMMY DOCUMENT — for demo only ***"]),
    },
    {
      file: "NBI Clearance.pdf",
      contentType: "application/pdf",
      bytes: makePdf(["NATIONAL BUREAU OF INVESTIGATION", "CLEARANCE", "", `Name: ${name}`, "Purpose: Local Employment", "", "*** DUMMY DOCUMENT — for demo only ***"]),
    },
    {
      file: "ID Photo.png",
      contentType: "image/png",
      bytes: makePng(0x1f, 0x1f, 0x1f),
    },
  ];
}

async function cleanDummyDocs() {
  const snap = await db.collection("employeeDocuments").where("source", "==", SEED_SOURCE).get();
  if (snap.empty) {
    console.log("No dummy documents to remove.");
    return;
  }
  let removed = 0;
  for (const d of snap.docs) {
    const sp = d.data().storagePath;
    if (sp) {
      try { await bucket.file(sp).delete(); } catch { /* already gone */ }
    }
    await d.ref.delete();
    removed += 1;
  }
  console.log(`Removed ${removed} dummy document(s).`);
}

(async () => {
  if (CLEAN) {
    await cleanDummyDocs();
    process.exit(0);
  }

  // Is Storage reachable? If not, fall back to metadata-only rows so the
  // Documents list still populates (file bytes / Open links need Storage enabled).
  let storageOk = false;
  try {
    const [exists] = await bucket.exists();
    storageOk = exists;
  } catch {
    storageOk = false;
  }
  if (!storageOk) {
    console.warn(`\n⚠  Storage bucket "${BUCKET}" is not enabled — seeding METADATA ONLY.`);
    console.warn("   The Documents list will populate, but file bytes / Open links won't work");
    console.warn("   until you enable Storage (Console → Build → Storage → Get started) and");
    console.warn("   re-run `npm run seed:docs` to replace these with real, openable files.\n");
  }

  const empSnap = await db.collection("employees").get();
  if (empSnap.empty) {
    console.error("No employees found — run `npm run seed` first.");
    process.exit(1);
  }

  let uploaded = 0;
  for (const empDoc of empSnap.docs) {
    const raw = empDoc.data();
    const emp = {
      employeeId: raw.employeeId || empDoc.id,
      fullName: raw.fullName || `${raw.firstName || ""} ${raw.lastName || ""}`.trim() || empDoc.id,
      email: raw.email || "",
      role: raw.role || "",
      branchName: raw.branchName || "",
    };
    const set = docSet(emp);
    for (let n = 0; n < set.length; n += 1) {
      const item = set[n];
      let url = "";
      let storagePath = "";
      if (storageOk) {
        storagePath = `employee-docs/${emp.employeeId}/dummy-${n}-${item.file.replace(/[^\w.\-]+/g, "_")}`;
        const token = crypto.randomUUID();
        await bucket.file(storagePath).save(item.bytes, {
          resumable: false,
          contentType: item.contentType,
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
      }
      await db.collection("employeeDocuments").doc(`dummy-${emp.employeeId}-${n}`).set({
        employeeId: emp.employeeId,
        name: item.file,
        size: item.bytes.length,
        contentType: item.contentType,
        url,
        storagePath,
        uploadedBy: "Dummy Seed",
        uploadedAt: serverTimestamp(),
        source: SEED_SOURCE,
      });
      uploaded += 1;
    }
    console.log(`  ✓ ${String(emp.employeeId).padEnd(12)} ${set.length} docs  ${emp.fullName}`);
  }

  console.log(`\nDone. Uploaded ${uploaded} dummy document(s) across ${empSnap.size} employee(s).`);
  console.log("Open the Documents tab, pick an employee, and their 201 files should be listed.");
  console.log("Undo with: npm run seed:docs -- --clean");
  process.exit(0);
})().catch((err) => {
  console.error("seed:docs failed:", err.message || err);
  process.exit(1);
});
