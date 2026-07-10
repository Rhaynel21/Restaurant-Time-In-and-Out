// Qui — Hikvision attendance bridge.
//
//   [Hikvision device]  --ISAPI poll-->  [this bridge]  --writes-->  [Firestore]
//                                                                        |
//                                                            app onSnapshot listener
//
// Every poll we ask the device for new access-control events, decide whether
// each scan is a clock-IN or clock-OUT (based on the employee's open record),
// and mirror it into the `attendance` collection the app already reads.
const config = require("./config");
const { fetchEvents, normalizeEvent } = require("./hikvision");
const store = require("./firestore");
const state = require("./state");
const tamper = require("./tamper");

const seenSet = new Set();
let lastTimeMs = null;
// Per-employee timestamp of the last punch we wrote, for debouncing.
const lastPunchByEmployee = new Map();
// Alarm keys already reported, so a sustained incident isn't re-logged each poll.
const tamperSeen = new Set();
// Health tracking for the device heartbeat / offline detection.
let consecutiveFails = 0;
let lastHeartbeatMs = 0;
let lastOnline = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// Minutes-since-midnight for a punch, in the device's local wall clock.
function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Is this punch inside (or near) the scheduled break window? Break-out happens
// around breakStart; we allow a 30-min lead and let it run to breakEnd + 30 so a
// slightly-early or slightly-late lunch scan still reads as a break, while an
// end-of-day scan (well past the window) correctly reads as a clock-out.
function inBreakWindow(time, brk) {
  if (!brk.breakStart || !brk.breakEnd) return false;
  const [sh, sm] = brk.breakStart.split(":").map(Number);
  const [eh, em] = brk.breakEnd.split(":").map(Number);
  const t = minutesOfDay(time);
  return t >= sh * 60 + sm - 30 && t <= eh * 60 + em + 30;
}

// Classify one punch into a state transition. Break in/out is INFERRED from scan
// order + the scheduled break window (Option B), since this device reports
// "checkIn" on every scan and can't tell us the punch type itself.
//
//   no open record            → IN         (open a new shift)
//   open, no break yet:
//        in break window       → BREAK-OUT  (start lunch)
//        else                  → OUT        (end of shift)
//   open, on break (out set, in unset) → BREAK-IN  (back from lunch)
//   open, break done          → OUT        (end of shift)
async function processEvent(evt) {
  const emp = await store.resolveEmployee(evt.employeeNo, evt.name);

  // Debounce repeated scans of the same badge within the configured window.
  const lastPunch = lastPunchByEmployee.get(emp.employeeId);
  if (lastPunch && Math.abs(evt.time.getTime() - lastPunch) < config.debounceSeconds * 1000) {
    log(`· debounced ${emp.employeeId} (${emp.name})`);
    return;
  }

  const open = await store.findOpenRecord(emp.employeeId);

  if (!open) {
    const id = await store.writeCheckIn(emp, evt.time);
    log(`▸ IN  ${emp.employeeId} (${emp.name}) → ${id}`);
  } else {
    const onBreak = open.breakOutAt && !open.breakInAt;
    const breakDone = open.breakOutAt && open.breakInAt;

    if (onBreak) {
      await store.writeBreakIn(open, evt.time);
      log(`↩ BRK-IN  ${emp.employeeId} (${emp.name}) → ${open.id}`);
    } else if (!breakDone && inBreakWindow(evt.time, await store.getScheduleBreak(emp.employeeId))) {
      await store.writeBreakOut(open, evt.time);
      log(`↪ BRK-OUT ${emp.employeeId} (${emp.name}) → ${open.id}`);
    } else {
      const { totalMinutes } = await store.writeCheckOut(open, evt.time);
      log(`◂ OUT ${emp.employeeId} (${emp.name}) → ${open.id} (${totalMinutes} min worked)`);
    }
  }

  lastPunchByEmployee.set(emp.employeeId, evt.time.getTime());
}

async function poll() {
  // Start a little before the last seen event to tolerate clock skew; the seen
  // set prevents double-processing the overlap.
  const now = new Date();
  const start = lastTimeMs
    ? new Date(lastTimeMs - 60000)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00 on first run

  const raw = await fetchEvents(start, now);

  // Anti-fraud / tamper pass over the full raw stream (includes denied/unknown
  // scans that aren't real punches). Detected alarms are mirrored to Firestore.
  for (const alarm of tamper.analyze(raw, tamperSeen)) {
    log(`⚠ ALARM [${alarm.severity}] ${alarm.type}: ${alarm.message}`);
    await store.recordAlarm(alarm);
  }

  const events = raw
    .map(normalizeEvent)
    .filter(Boolean)
    .filter((e) => !seenSet.has(e.key))
    .sort((a, b) => a.time - b.time);

  if (events.length === 0) return;

  for (const evt of events) {
    try {
      await processEvent(evt);
      seenSet.add(evt.key);
      lastTimeMs = Math.max(lastTimeMs || 0, evt.time.getTime());
    } catch (err) {
      log(`! failed to process event ${evt.key}: ${err.message}`);
    }
  }

  state.save({ lastTimeMs, seen: Array.from(seenSet) });
}

async function main() {
  const persisted = state.load();
  lastTimeMs = persisted.lastTimeMs;
  persisted.seen.forEach((k) => seenSet.add(k));

  log("Qui · Hikvision bridge starting");
  log(`Device:   ${config.deviceBaseUrl}`);
  log(`Interval: ${config.pollIntervalMs}ms`);
  log(lastTimeMs ? `Resuming from ${new Date(lastTimeMs).toISOString()}` : "Fresh start (today)");

  let polling = false;
  const tick = async () => {
    if (polling) return; // never overlap polls
    polling = true;
    try {
      await poll();
      consecutiveFails = 0;
      // Replay anything captured while offline, then mark the device healthy.
      const flushed = await store.flushQueue();
      if (flushed) log(`↻ flushed ${flushed} queued punch(es) to Firestore`);
      await reportHealth(true);
    } catch (err) {
      consecutiveFails += 1;
      log(`! poll error: ${err.message}`);
      // Only declare the terminal offline after a few misses, to ride out blips.
      if (consecutiveFails >= config.offlineAfterFails) {
        await reportHealth(false, { lastError: String(err.message).slice(0, 200) });
      }
    } finally {
      polling = false;
    }
  };

  await tick();
  setInterval(tick, config.pollIntervalMs);
}

// Throttled heartbeat: write at most once a minute, or immediately whenever the
// online/offline state flips (so an outage shows up right away).
async function reportHealth(online, meta = {}) {
  const now = Date.now();
  const changed = online !== lastOnline;
  if (!changed && now - lastHeartbeatMs < 60000) return;
  lastOnline = online;
  lastHeartbeatMs = now;
  await store.heartbeat(online, meta);
  if (changed) log(online ? "● device ONLINE" : "○ device OFFLINE");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
