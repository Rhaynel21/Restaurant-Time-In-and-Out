// Heuristic tamper / anti-fraud detection over the device's raw access events.
//
// We can't trust the device to push a clean "tamper" signal on every firmware, so
// we derive integrity signals from the event stream the bridge already polls:
//   • failed-auth bursts  — many unknown/denied scans in a short window (someone
//     trying forged or random credentials, or forcing the reader).
//   • case/tamper alarms  — events whose Hikvision minor code is in the configured
//     tamper list (enclosure opened, sensor tripped).
//
// Detected alarms are de-duplicated by a stable key so the same incident isn't
// re-reported on every poll.
const config = require("./config");

// A genuine failed/denied authentication: no person id AND a minor code that the
// operator has declared (in HIK_FAILED_AUTH_MINORS) to mean "auth failed". We
// require the explicit minor list because a successful scan on many devices also
// emits no-employeeNo sub-events (door open/close), which must NOT be counted.
function isDeniedAttempt(raw) {
  if (config.failedAuthMinors.length === 0) return false;
  const emp = raw.employeeNoString != null ? raw.employeeNoString : raw.employeeNo;
  const id = emp == null ? "" : String(emp).trim();
  const noPerson = id === "" || id === "0";
  return noPerson && config.failedAuthMinors.includes(Number(raw.minor));
}

function parseTime(raw) {
  const t = Date.parse(raw.time);
  return Number.isFinite(t) ? t : null;
}

// Find the worst sliding window of denied attempts. Returns an alarm or null.
function detectFailedAuthBurst(rawEvents) {
  const windowMs = config.failedAuthWindowSeconds * 1000;
  const threshold = config.failedAuthThreshold;

  const denied = rawEvents
    .map((raw) => ({ t: parseTime(raw), raw }))
    .filter((e) => e.t !== null && isDeniedAttempt(e.raw))
    .sort((a, b) => a.t - b.t);

  let best = null;
  for (let i = 0; i < denied.length; i += 1) {
    const windowItems = [];
    for (let j = i; j < denied.length && denied[j].t <= denied[i].t + windowMs; j += 1) {
      windowItems.push(denied[j]);
    }
    if (windowItems.length >= threshold && (!best || windowItems.length > best.count)) {
      best = {
        count: windowItems.length,
        firstAt: new Date(windowItems[0].t),
        lastAt: new Date(windowItems[windowItems.length - 1].t),
      };
    }
  }

  if (!best) return null;
  return {
    // Key by the last attempt's minute so a sustained burst collapses to one alarm.
    key: `burst-${Math.floor(best.lastAt.getTime() / 60000)}`,
    type: "failed_auth_burst",
    severity: "warning",
    message: `${best.count} failed/unknown scans within ${config.failedAuthWindowSeconds}s — possible tampering or forced entry`,
    count: best.count,
    at: best.lastAt,
  };
}

// Events whose minor code is configured as a tamper/case alarm.
function detectTamperEvents(rawEvents) {
  if (config.tamperMinors.length === 0) return [];
  const set = new Set(config.tamperMinors);
  return rawEvents
    .filter((raw) => set.has(Number(raw.minor)))
    .map((raw) => {
      const at = parseTime(raw);
      return {
        key: `tamper-${raw.serialNo ?? at}-${raw.minor}`,
        type: "device_tamper",
        severity: "critical",
        message: `Device tamper/case alarm (minor ${raw.minor})`,
        at: at ? new Date(at) : new Date(),
      };
    });
}

// Run all detectors over a batch of raw events. Returns a de-duplicated list of
// alarms not seen before (tracked in `seenKeys`, which the caller persists).
function analyze(rawEvents, seenKeys) {
  const alarms = [];
  const burst = detectFailedAuthBurst(rawEvents);
  if (burst) alarms.push(burst);
  alarms.push(...detectTamperEvents(rawEvents));

  return alarms.filter((a) => {
    if (seenKeys.has(a.key)) return false;
    seenKeys.add(a.key);
    return true;
  });
}

module.exports = { analyze, isDeniedAttempt };
