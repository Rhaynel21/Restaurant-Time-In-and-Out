// Loads bridge configuration from .env (and process env). Every device-specific
// value lives here so the same code runs against any Hikvision unit / network.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var ${name} — copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

// Optional employeeNo -> app employeeId map. If a scanned person's device ID
// isn't in here, the bridge uses the raw device ID (uppercased) as the app's
// employeeId, so simple deployments can skip the map entirely.
function loadEmployeeMap() {
  const mapPath = path.join(__dirname, "..", "employee-map.json");
  if (!fs.existsSync(mapPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch (err) {
    console.warn(`[config] Could not parse employee-map.json: ${err.message}. Ignoring.`);
    return {};
  }
}

const config = {
  // Device / network
  deviceBaseUrl: required("HIK_HOST").replace(/\/+$/, ""), // e.g. http://192.168.1.64
  username: required("HIK_USER"),
  password: required("HIK_PASS"),

  // Polling
  pollIntervalMs: Number(optional("POLL_INTERVAL_MS", "5000")),
  eventMajor: Number(optional("HIK_EVENT_MAJOR", "5")), // 5 = access-control event
  eventMinor: Number(optional("HIK_EVENT_MINOR", "0")), // 0 = all minor types
  tzOffset: optional("HIK_TZ_OFFSET", "+08:00"), // Philippines
  // Ignore a repeat scan from the same person within this window (anti double-tap).
  debounceSeconds: Number(optional("DEBOUNCE_SECONDS", "60")),

  // ── Device identity (for heartbeat + alarms in Firestore) ──
  deviceId: optional("DEVICE_ID", "kio-terminal-1"),
  deviceName: optional("DEVICE_NAME", "Qui Biometric Terminal"),

  // ── Tamper / anti-fraud detection ──
  // Mark the device "offline" after this many consecutive failed polls.
  offlineAfterFails: Number(optional("OFFLINE_AFTER_FAILS", "3")),
  // A burst of this many failed-auth attempts within the window is flagged as a
  // possible tampering / forced-entry attempt. DISABLED unless you list which
  // minor codes count as a failed authentication (HIK_FAILED_AUTH_MINORS) — many
  // devices emit no-employeeNo sub-events (door open/close) on a *successful*
  // scan, so counting every emptyemployee event causes false alarms.
  failedAuthThreshold: Number(optional("FAILED_AUTH_THRESHOLD", "5")),
  failedAuthWindowSeconds: Number(optional("FAILED_AUTH_WINDOW_SECONDS", "120")),
  failedAuthMinors: optional("HIK_FAILED_AUTH_MINORS", "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  // Extra Hikvision minor codes to treat as a tamper/case alarm (comma list).
  tamperMinors: optional("HIK_TAMPER_MINORS", "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),

  // Fallback branch used when an employee has no branch on their Firestore doc.
  defaultBranchId: optional("DEFAULT_BRANCH_ID", "kio-bgc"),
  defaultBranchName: optional("DEFAULT_BRANCH_NAME", "Qui - BGC"),

  employeeMap: loadEmployeeMap(),
};

module.exports = config;
