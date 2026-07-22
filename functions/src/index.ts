import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";

// ── Qui POS bridge ───────────────────────────────────────────────────────────
// Qui (kitchen-in-and-out) and the Klicc Phase 1 POS (restaurant-management-96e52)
// are SEPARATE Firebase projects, so Qui can't read Phase 1 from the client. This
// function runs server-side in Qui's project, calls Phase 1's read API, and mirrors
// per-branch-per-day revenue + service-charge pool into Qui's `pos_daily` collection.
// The Qui admin portal (Labor Cost Ratio, service-charge pool) reads `pos_daily`.
//
// Config (set with `firebase functions:secrets:set` / `firebase functions:config`):
//   POS_API_BASE  — Phase 1 posApi URL, e.g. https://<region>-restaurant-management-96e52.cloudfunctions.net/posApi
//   POS_API_KEY   — bearer token the Phase 1 API expects (secret)
//
// The mapping key is each Qui branch's `posBranchId` (set in the Org tab).

const POS_API_BASE = defineString("POS_API_BASE");
const POS_API_KEY = defineSecret("POS_API_KEY");
const BIOMETRIC_API_KEY = defineSecret("BIOMETRIC_API_KEY");
const SEMAPHORE_API_KEY = defineSecret("SEMAPHORE_API_KEY");
const SEMAPHORE_SENDER_NAME = defineString("SEMAPHORE_SENDER_NAME", { default: "" });

initializeApp();
const db = getFirestore();

type PosSummaryRow = { businessDate: string; grossSales: number; netSales: number; serviceCharge: number };

// Pull one branch's daily summaries from the Phase 1 API for a date range.
async function fetchPhase1Summaries(base: string, apiKey: string, posBranchId: string, from: string, to: string): Promise<PosSummaryRow[]> {
  const url = `${base.replace(/\/$/, "")}/v2/daily-summary?branchId=${encodeURIComponent(posBranchId)}&from=${from}&to=${to}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Phase 1 API ${res.status} for branch ${posBranchId}`);
  const body = (await res.json()) as { rows?: PosSummaryRow[] } | PosSummaryRow[];
  return Array.isArray(body) ? body : body.rows ?? [];
}

// Every Qui branch that has a posBranchId set → [{ quiBranchId, posBranchId }].
async function mappedBranches(): Promise<{ quiBranchId: string; posBranchId: string }[]> {
  const snap = await db.collectionGroup("branches").get();
  const out: { quiBranchId: string; posBranchId: string }[] = [];
  snap.forEach((d) => {
    const posBranchId = d.get("posBranchId");
    if (typeof posBranchId === "string" && posBranchId) out.push({ quiBranchId: d.id, posBranchId });
  });
  return out;
}

// YYYY-MM-DD for `daysBack` days ago … today (UTC+8, PH business day).
function dateRange(daysBack: number): { from: string; to: string } {
  const now = new Date(Date.now() + 8 * 3_600_000); // shift to PH time
  const to = now.toISOString().slice(0, 10);
  const fromD = new Date(now.getTime() - daysBack * 86_400_000);
  return { from: fromD.toISOString().slice(0, 10), to };
}

// Mirror the fetched rows into pos_daily/{quiBranchId}_{date}.
async function syncRange(daysBack: number): Promise<{ branches: number; rows: number }> {
  const base = POS_API_BASE.value();
  const apiKey = POS_API_KEY.value();
  if (!base || !apiKey) {
    logger.warn("POS bridge not configured — set POS_API_BASE and POS_API_KEY.");
    return { branches: 0, rows: 0 };
  }
  const { from, to } = dateRange(daysBack);
  const branches = await mappedBranches();
  let rowCount = 0;
  for (const { quiBranchId, posBranchId } of branches) {
    try {
      const rows = await fetchPhase1Summaries(base, apiKey, posBranchId, from, to);
      const batch = db.batch();
      for (const r of rows) {
        batch.set(
          db.collection("pos_daily").doc(`${quiBranchId}_${r.businessDate}`),
          {
            branchId: quiBranchId,
            date: r.businessDate,
            grossSales: Number(r.grossSales) || 0,
            netSales: Number(r.netSales) || 0,
            serviceChargePool: Number(r.serviceCharge) || 0,
            source: "api",
            updatedAt: new Date(),
          },
          { merge: true },
        );
        rowCount += 1;
      }
      await batch.commit();
    } catch (e) {
      logger.error(`POS sync failed for ${quiBranchId} → ${posBranchId}`, e);
    }
  }
  return { branches: branches.length, rows: rowCount };
}

// Nightly at 02:00 Asia/Manila — re-pull the last 3 days (covers late Z-readings).
export const syncPosDaily = onSchedule(
  { schedule: "0 2 * * *", timeZone: "Asia/Manila", secrets: [POS_API_KEY] },
  async () => {
    const res = await syncRange(3);
    logger.info(`POS sync done: ${res.rows} rows across ${res.branches} branches.`);
  },
);

// Manual backfill: GET .../syncPosNow?days=30 (auth via the same bearer token).
export const syncPosNow = onRequest({ secrets: [POS_API_KEY] }, async (req, res) => {
  const auth = req.get("Authorization") || "";
  if (auth !== `Bearer ${POS_API_KEY.value()}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const days = Math.min(120, Math.max(1, Number(req.query.days) || 3));
  const result = await syncRange(days);
  res.json({ ok: true, ...result });
});

// Authenticated device bridge for fingerprint terminals. Face recognition is
// intentionally not implemented. Devices may queue
// events while offline and retry with the same eventId; the event document id
// makes ingestion idempotent. DTR locks are checked server-side before any
// attendance mutation, so an Admin SDK bridge cannot accidentally alter a
// closed cutoff.
export const ingestBiometricPunch = onRequest({ secrets: [BIOMETRIC_API_KEY] }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if ((req.get("Authorization") || "") !== `Bearer ${BIOMETRIC_API_KEY.value()}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  const branchId = typeof body.branchId === "string" ? body.branchId.trim() : "";
  const branchName = typeof body.branchName === "string" ? body.branchName.trim() : "";
  const employeeName = typeof body.employeeName === "string" ? body.employeeName.trim() : employeeId;
  const kind = body.kind === "out" ? "out" : body.kind === "in" ? "in" : null;
  const capturedAt = typeof body.capturedAt === "string" ? new Date(body.capturedAt) : new Date();
  if (!eventId || !employeeId || !branchId || !kind || Number.isNaN(capturedAt.getTime())) {
    res.status(400).json({ error: "eventId, employeeId, branchId, kind, and a valid capturedAt are required" });
    return;
  }
  if (body.biometricMode === "face") {
    res.status(400).json({ error: "face_recognition_not_implemented" });
    return;
  }
  const ph = new Date(capturedAt.getTime() + 8 * 3_600_000);
  const period = `${ph.getUTCFullYear()}-${String(ph.getUTCMonth() + 1).padStart(2, "0")}`;
  const eventRef = db.collection("biometric_events").doc(eventId);
  if ((await eventRef.get()).exists) {
    res.json({ ok: true, duplicate: true });
    return;
  }
  const lock = await db.collection("dtr_locks").doc(`${branchId}_${period}`).get();
  if (lock.exists && lock.get("locked") === true) {
    res.status(409).json({ error: "dtr_locked", branchId, period });
    return;
  }
  if (kind === "in") {
    const attendanceRef = db.collection("attendance").doc();
    const batch = db.batch();
    batch.create(attendanceRef, {
      employeeId, employeeName, branchId, branchName, period,
      checkInAt: capturedAt, checkOutAt: null, method: "biometric",
      biometricMode: "fingerprint",
      deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
      sourceEventId: eventId, createdAt: new Date(),
    });
    batch.create(eventRef, { employeeId, branchId, period, kind, capturedAt, attendanceId: attendanceRef.id, receivedAt: new Date() });
    await batch.commit();
    res.status(201).json({ ok: true, attendanceId: attendanceRef.id });
    return;
  }
  const open = await db.collection("attendance")
    .where("employeeId", "==", employeeId).where("checkOutAt", "==", null).limit(10).get();
  const target = open.docs.sort((a, b) => b.get("checkInAt").toMillis() - a.get("checkInAt").toMillis())[0];
  if (!target) {
    res.status(409).json({ error: "no_open_shift" });
    return;
  }
  const checkInAt = target.get("checkInAt").toDate() as Date;
  const batch = db.batch();
  batch.update(target.ref, { checkOutAt: capturedAt, totalMinutes: Math.max(0, Math.round((capturedAt.getTime() - checkInAt.getTime()) / 60000)), checkOutEventId: eventId });
  batch.create(eventRef, { employeeId, branchId, period, kind, capturedAt, attendanceId: target.id, receivedAt: new Date() });
  await batch.commit();
  res.json({ ok: true, attendanceId: target.id });
});

type AlertSettings = {
  companyId: string;
  minPresentPerBranch: number;
  checkHour: number;
  recipientPhones: string[];
};

function philippinesClock(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3_600_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  return {
    date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour: shifted.getUTCHours(),
    startUtc: new Date(Date.UTC(year, month, day) - 8 * 3_600_000),
  };
}

async function sendSms(to: string, message: string) {
  const body = new URLSearchParams({ apikey: SEMAPHORE_API_KEY.value(), number: to, message });
  const senderName = SEMAPHORE_SENDER_NAME.value().trim();
  if (senderName) body.set("sendername", senderName);
  const response = await fetch("https://api.semaphore.co/api/v4/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Semaphore returned ${response.status}`);
  const result = await response.json() as Array<{ status?: string }> | { message?: string };
  if (!Array.isArray(result) || result.some((item) => String(item.status).toLowerCase() === "failed")) {
    throw new Error("Semaphore rejected the SMS request");
  }
}

async function processAttendanceAlerts(forceCompanyId?: string) {
    const clock = philippinesClock();
    const settingDocs = forceCompanyId
      ? [await db.collection("attendance_alert_settings").doc(forceCompanyId).get()].filter((d) => d.exists)
      : (await db.collection("attendance_alert_settings").where("enabled", "==", true).get()).docs;
    let abnormalBranches = 0;
    let sent = 0;
    for (const settingDoc of settingDocs) {
      const data = settingDoc.data() ?? {};
      const settings: AlertSettings = {
        companyId: typeof data.companyId === "string" && data.companyId ? data.companyId : settingDoc.id,
        minPresentPerBranch: Math.max(1, Math.floor(Number(data.minPresentPerBranch) || 3)),
        checkHour: Math.min(23, Math.max(0, Math.floor(Number(data.checkHour) || 10))),
        recipientPhones: Array.isArray(data.recipientPhones) ? data.recipientPhones.filter((p): p is string => typeof p === "string" && !!p.trim()) : [],
      };
      if ((!forceCompanyId && clock.hour < settings.checkHour) || settings.recipientPhones.length === 0) continue;
      const alertRef = db.collection("attendance_alerts").doc(
        forceCompanyId ? `${settings.companyId}_${clock.date}_manual_${Date.now()}` : `${settings.companyId}_${clock.date}`,
      );
      const priorAlert = await alertRef.get();
      const alreadySent = new Set<string>(priorAlert.exists && Array.isArray(priorAlert.get("successfulRecipients")) ? priorAlert.get("successfulRecipients") as string[] : []);

      // Qui employee docs are NOT stamped with companyId — they carry branchId, and
      // the org owns branches. So read all employees and scope by branch membership.
      const [employeeSnap, attendanceSnap, branchSnap, companySnap, leaveSnap, reqSnap, deviceSnap] = await Promise.all([
        db.collection("employees").get(),
        db.collection("attendance").where("checkInAt", ">=", clock.startUtc).get(),
        db.collectionGroup("branches").get(),
        db.collection("organization").doc(settings.companyId).get(),
        db.collection("leaves").where("status", "==", "pending").get(),
        db.collection("attendanceRequests").where("status", "==", "pending").get(),
        db.collection("deviceStatus").get(),
      ]);
      const companyName = companySnap.exists ? String(companySnap.get("name") || "HRIS") : "HRIS";
      // Branches this org owns (new `organization/…` or legacy `companies/…` path).
      const branchNames = new Map<string, string>();
      branchSnap.docs
        .filter((d) => d.ref.path.startsWith(`organization/${settings.companyId}/`) || d.ref.path.startsWith(`companies/${settings.companyId}/`))
        .forEach((d) => branchNames.set(d.id, String(d.get("name") || d.id)));
      // If the org tree has branches, scope to them; otherwise fall back to whatever
      // branches the employees themselves reference (single-org / pre-migrate data).
      const scopeToOrgBranches = branchNames.size > 0;
      const activeByBranch = new Map<string, number>();
      employeeSnap.docs.forEach((d) => {
        if (d.get("status") === "inactive") return;
        const branchId = d.get("branchId");
        if (typeof branchId !== "string" || !branchId) return;
        if (scopeToOrgBranches && !branchNames.has(branchId)) return;
        activeByBranch.set(branchId, (activeByBranch.get(branchId) || 0) + 1);
        if (!branchNames.has(branchId)) branchNames.set(branchId, String(d.get("branchName") || branchId));
      });
      const presentByBranch = new Map<string, Set<string>>();
      attendanceSnap.docs.forEach((d) => {
        const branchId = d.get("branchId");
        const employeeId = d.get("employeeId");
        if (typeof branchId !== "string" || typeof employeeId !== "string" || !activeByBranch.has(branchId)) return;
        const ids = presentByBranch.get(branchId) || new Set<string>();
        ids.add(employeeId);
        presentByBranch.set(branchId, ids);
      });
      const allBranches = [...activeByBranch.entries()]
        .map(([branchId, active]) => ({ branchId, name: branchNames.get(branchId) || branchId, active, present: presentByBranch.get(branchId)?.size || 0 }))
        .sort((a, b) => a.present - b.present);
      const abnormal = allBranches.filter((row) => row.present < settings.minPresentPerBranch);

      // ── Extra report sections (this org's scope) ──
      const inOrg = (branchId: unknown) => !scopeToOrgBranches || (typeof branchId === "string" && (branchId === "" || branchNames.has(branchId)));
      const pendingLeaves = leaveSnap.docs.filter((d) => inOrg(d.get("branchId"))).length;
      const pendingReqs = reqSnap.docs.filter((d) => inOrg(d.get("branchId"))).length;
      const offlineDevices = deviceSnap.docs.filter((d) => {
        const last = d.get("lastSeenAt");
        const lastMs = last && typeof last.toMillis === "function" ? last.toMillis() : null;
        return d.get("online") !== true || lastMs === null || Date.now() - lastMs > 120000;
      }).length;
      const totalPresent = allBranches.reduce((sum, row) => sum + row.present, 0);

      // Scheduled runs report only when there's something actionable (attendance
      // dip, pending approvals, or an offline scanner); manual "Send now" always sends.
      const hasNews = abnormal.length > 0 || pendingLeaves > 0 || pendingReqs > 0 || offlineDevices > 0;
      if (!forceCompanyId && !hasNews) continue;
      abnormalBranches += abnormal.length;

      // ── Build the multi-section daily digest ──
      const sections: string[] = [];
      if (abnormal.length > 0) {
        const details = abnormal.map((row) => `${row.name} ${row.present}/${row.active}`).join(", ");
        sections.push(`Attendance: ${totalPresent} present, ${abnormal.length} low branch${abnormal.length === 1 ? "" : "es"} (${details})`);
      } else if (allBranches.length > 0) {
        sections.push(`Attendance: OK, ${totalPresent} present across ${allBranches.length} branch${allBranches.length === 1 ? "" : "es"}`);
      } else {
        sections.push("Attendance: no active branches to evaluate");
      }
      if (pendingLeaves > 0 || pendingReqs > 0) {
        sections.push(`Approvals pending: ${pendingLeaves} leave, ${pendingReqs} DTR/OT`);
      }
      if (offlineDevices > 0) {
        sections.push(`Devices: ${offlineDevices} scanner${offlineDevices === 1 ? "" : "s"} offline`);
      }
      const message = `${companyName} daily report ${clock.date}. ${sections.join(". ")}.`;
      const results: { to: string; ok: boolean; error?: string }[] = [];
      const pendingRecipients = settings.recipientPhones.filter((phone) => !alreadySent.has(phone));
      if (pendingRecipients.length === 0) continue;
      for (const to of pendingRecipients) {
        try { await sendSms(to, message); results.push({ to, ok: true }); }
        catch (e) { results.push({ to, ok: false, error: e instanceof Error ? e.message : "send failed" }); }
      }
      results.filter((r) => r.ok).forEach((r) => alreadySent.add(r.to));
      sent += results.filter((r) => r.ok).length;
      await alertRef.set({ companyId: settings.companyId, date: clock.date, message, branches: abnormal, results, successfulRecipients: [...alreadySent], updatedAt: new Date() }, { merge: true });

      const managers = priorAlert.exists || abnormal.length === 0 ? [] : employeeSnap.docs.filter((d) => ["owner", "admin", "hr", "manager", "areaManager"].includes(String(d.get("accessRole"))));
      const batch = db.batch();
      managers.forEach((manager) => batch.create(db.collection("notifications").doc(), {
        toEmployeeId: manager.id, title: "Attendance abnormality", body: message, kind: "warning", read: false, createdAt: new Date(),
      }));
      if (managers.length) await batch.commit();
    }
    return { abnormalBranches, sent };
}

// Every 15 minutes, evaluate each enabled company once after its configured
// check hour. A single SMS names all branches below the minimum, including
// present/active-roster counts. The alert document id deduplicates retries.
export const sendAttendanceAbnormalityAlerts = onSchedule(
  { schedule: "*/15 * * * *", timeZone: "Asia/Manila", secrets: [SEMAPHORE_API_KEY] },
  async () => { await processAttendanceAlerts(); },
);

export const sendAttendanceAlertNow = onCall(
  { secrets: [SEMAPHORE_API_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before sending an alert.");
    const companyId = typeof request.data?.companyId === "string" ? request.data.companyId.trim() : "";
    if (!companyId) throw new HttpsError("invalid-argument", "Select an organization first.");
    // Qui stores roles on the Firestore `employees` doc (resolved by email at login),
    // NOT as Auth custom claims — so authorize the caller by looking up their record.
    const email = String(request.auth.token.email || "").toLowerCase();
    const empSnap = email ? await db.collection("employees").where("email", "==", email).limit(1).get() : null;
    const emp = empSnap && !empSnap.empty ? empSnap.docs[0].data() : null;
    const role = String(emp?.accessRole || "");
    if (!["owner", "admin", "hr", "manager", "areaManager"].includes(role)) {
      throw new HttpsError("permission-denied", "Your role cannot send attendance alerts.");
    }
    const empCompany = typeof emp?.companyId === "string" ? emp.companyId : "";
    if (role !== "owner" && empCompany && empCompany !== companyId) {
      throw new HttpsError("permission-denied", "You cannot send alerts for another organization.");
    }
    const settings = await db.collection("attendance_alert_settings").doc(companyId).get();
    if (!settings.exists || !Array.isArray(settings.get("recipientPhones")) || settings.get("recipientPhones").length === 0) {
      throw new HttpsError("failed-precondition", "Save at least one SMS recipient first.");
    }
    const result = await processAttendanceAlerts(companyId);
    return { ok: true, ...result };
  },
);

// Read-only device health check. GET with Authorization: Bearer <BIOMETRIC_API_KEY>.
// Reports each biometric device's last heartbeat so the Hikvision bridge's
// online/offline state can be verified server-side (a device is "live" if it
// reported within 2 minutes).
export const deviceHealth = onRequest({ secrets: [BIOMETRIC_API_KEY], invoker: "public" }, async (req, res) => {
  if ((req.get("Authorization") || "") !== `Bearer ${BIOMETRIC_API_KEY.value()}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  // Maintenance: ?delete=<deviceId> removes one stale/decommissioned device doc.
  const del = typeof req.query.delete === "string" ? req.query.delete : "";
  if (del) {
    await db.collection("deviceStatus").doc(del).delete();
    res.json({ ok: true, deleted: del });
    return;
  }
  // Maintenance: ?setgeo=1 stamps approximate Metro Manila coordinates + a 300 m
  // geofence radius onto every branch doc (both org trees) so GPS check-in can
  // enforce a fence. Coordinates are approximate — refine per branch in the Org tab.
  if (req.query.setgeo) {
    const GEO: Record<string, { lat: number; lng: number; radius: number }> = {
      "kio-qc": { lat: 14.63093, lng: 121.03371, radius: 300 },
      "kio-makati": { lat: 14.55686, lng: 121.01975, radius: 300 },
      "kio-bgc": { lat: 14.55122, lng: 121.04673, radius: 300 },
      "qui-manila": { lat: 14.63, lng: 121.043, radius: 300 },
    };
    const bsnap = await db.collectionGroup("branches").get();
    const updated: string[] = [];
    for (const d of bsnap.docs) {
      const g = GEO[d.id];
      if (!g) continue;
      await d.ref.set({ latitude: g.lat, longitude: g.lng, radiusMeters: g.radius }, { merge: true });
      updated.push(d.ref.path);
    }
    res.json({ ok: true, updated });
    return;
  }
  // Maintenance: ?consolidate=1 merges the legacy `companies/` org tree into the
  // canonical `organization/` tree (copying any missing branch first, e.g. Qui
  // Manila), then deletes the duplicate `companies/` tree. Employee branchIds are
  // referenced by id, not path, so they keep resolving after the merge.
  if (req.query.consolidate) {
    const bsnap = await db.collectionGroup("branches").get();
    const orgBranchIds = new Set(bsnap.docs.filter((d) => d.ref.path.startsWith("organization/")).map((d) => d.id));
    const copied: string[] = [];
    const deleted: string[] = [];
    // 1) Copy company-only branches into the organization tree (preserve coords).
    for (const d of bsnap.docs) {
      if (!d.ref.path.startsWith("companies/")) continue;
      const p = d.ref.path.split("/"); // companies,{co},brands,{br},branches,{id}
      if (!orgBranchIds.has(d.id)) {
        await db.doc(`organization/${p[1]}/brands/${p[3]}/branches/${d.id}`).set(d.data(), { merge: true });
        copied.push(d.id);
      }
    }
    // 2) Delete the legacy companies tree (branches, brands, areas, company docs).
    const [brandSnap, areaSnap, coSnap] = await Promise.all([
      db.collectionGroup("brands").get(),
      db.collectionGroup("areas").get(),
      db.collection("companies").get(),
    ]);
    for (const d of bsnap.docs) if (d.ref.path.startsWith("companies/")) { await d.ref.delete(); deleted.push(d.ref.path); }
    for (const d of brandSnap.docs) if (d.ref.path.startsWith("companies/")) { await d.ref.delete(); deleted.push(d.ref.path); }
    for (const d of areaSnap.docs) if (d.ref.path.startsWith("companies/")) { await d.ref.delete(); deleted.push(d.ref.path); }
    for (const d of coSnap.docs) { await d.ref.delete(); deleted.push(d.ref.path); }
    res.json({ ok: true, copied, deleted });
    return;
  }
  // Diagnostics: ?branches=1 dumps org branches + employee branch assignments so
  // a branchId ↔ org-branch mismatch (why geofencing fails) can be pinpointed.
  if (req.query.branches) {
    const [bsnap, esnap] = await Promise.all([db.collectionGroup("branches").get(), db.collection("employees").get()]);
    const branches = bsnap.docs.map((d) => ({
      id: d.id,
      path: d.ref.path,
      name: d.get("name") || null,
      lat: d.get("latitude") ?? null,
      lng: d.get("longitude") ?? null,
      radius: d.get("radiusMeters") ?? null,
    }));
    const employees = esnap.docs.map((d) => ({ id: d.id, name: d.get("fullName") || `${d.get("firstName") || ""} ${d.get("lastName") || ""}`.trim(), branchId: d.get("branchId") ?? null, branchName: d.get("branchName") ?? null }));
    res.json({ branchCount: branches.length, branches, employees });
    return;
  }
  const snap = await db.collection("deviceStatus").get();
  const now = Date.now();
  const devices = snap.docs.map((d) => {
    const x = d.data();
    const lastMs = x.lastSeenAt && typeof x.lastSeenAt.toMillis === "function" ? x.lastSeenAt.toMillis() : null;
    const ageSec = lastMs ? Math.round((now - lastMs) / 1000) : null;
    return {
      id: d.id,
      name: x.deviceName || d.id,
      onlineFlag: x.online === true,
      lastSeenAgeSec: ageSec,
      live: x.online === true && lastMs !== null && now - lastMs <= 120000,
      queueDepth: typeof x.queueDepth === "number" ? x.queueDepth : 0,
    };
  });
  // Latest punches, to confirm scans are flowing in real time.
  const attSnap = await db.collection("attendance").orderBy("checkInAt", "desc").limit(3).get();
  const recentPunches = attSnap.docs.map((d) => {
    const x = d.data();
    const inMs = x.checkInAt && typeof x.checkInAt.toMillis === "function" ? x.checkInAt.toMillis() : null;
    const outMs = x.checkOutAt && typeof x.checkOutAt.toMillis === "function" ? x.checkOutAt.toMillis() : null;
    return {
      employee: x.employeeName || x.employeeId || "?",
      branch: x.branchName || x.branchId || "?",
      method: x.method || "biometric",
      checkInAgeSec: inMs ? Math.round((now - inMs) / 1000) : null,
      checkedOut: outMs !== null,
    };
  });
  res.json({ now: new Date(now).toISOString(), count: devices.length, anyLive: devices.some((d) => d.live), devices, recentPunches });
});
