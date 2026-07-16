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
const { fetchEvents, normalizeEvent, ping } = require("./hikvision");
const store = require("./firestore");
const state = require("./state");
const tamper = require("./tamper");
const simulate = require("./simulate");

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
let lastRolloverYmd = null; // guards the once-a-day midnight roll-over

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// Classify one punch into a state transition. This device reports "checkIn" on
// every scan and can't tell us the punch type, so the type is inferred from the
// ORDER of scans within the day (positional), schedule-aware:
//
//   no open record                         → IN         (open a new shift)
//   open, schedule has a break:
//        no break-out yet                  → BREAK-OUT  (leave for break)
//        break-out set, no break-in        → BREAK-IN   (back from break)
//        break already done                → OUT        (end of shift)
//   open, schedule has NO break            → OUT        (2-punch day: in/out)
//
// So a shift WITH a break is a clean 4-punch sequence (In → Break Out → Break In
// → Out); a shift without a configured break is just In → Out. The clock time of
// the scan no longer decides the type — only its position in the sequence does.
async function processEvent(evt) {
  const emp = await store.resolveEmployee(evt.employeeNo, evt.name);

  // Debounce repeated scans of the same badge within the configured window.
  const lastPunch = lastPunchByEmployee.get(emp.employeeId);
  if (lastPunch && Math.abs(evt.time.getTime() - lastPunch) < config.debounceSeconds * 1000) {
    log(`· debounced ${emp.employeeId} (${emp.name})`);
    return;
  }

  const open = await store.findOpenRecord(emp.employeeId);

  if (open && store.isStaleOpen(open, evt.time)) {
    // The previous shift was never timed out — auto-close it (capped) instead of
    // letting this punch balloon it into a multi-day record, then start fresh.
    await store.closeStaleRecord(open);
    const id = await store.writeCheckIn(emp, evt.time);
    log(`⤺ auto-closed stale shift ${open.id}; ▸ IN ${emp.employeeId} (${emp.name}) → ${id}`);
  } else if (!open) {
    const id = await store.writeCheckIn(emp, evt.time);
    log(`▸ IN  ${emp.employeeId} (${emp.name}) → ${id}`);
  } else {
    // Does this employee's schedule define a break? If so we expect the two
    // break scans between clock-in and clock-out; if not, the next scan is OUT.
    const brk = await store.getScheduleBreak(emp.employeeId);
    const hasBreak = !!(brk && brk.breakStart && brk.breakEnd);
    const breakStarted = !!open.breakOutAt;
    const breakEnded = !!open.breakInAt;

    if (hasBreak && !breakStarted) {
      await store.writeBreakOut(open, evt.time);
      log(`↪ BRK-OUT ${emp.employeeId} (${emp.name}) → ${open.id}`);
    } else if (hasBreak && breakStarted && !breakEnded) {
      await store.writeBreakIn(open, evt.time);
      log(`↩ BRK-IN  ${emp.employeeId} (${emp.name}) → ${open.id}`);
    } else {
      const { totalMinutes } = await store.writeCheckOut(open, evt.time);
      log(`◂ OUT ${emp.employeeId} (${emp.name}) → ${open.id} (${totalMinutes} min worked)`);
    }
  }

  lastPunchByEmployee.set(emp.employeeId, evt.time.getTime());
}

// Run the midnight roll-over once per day, around 23:59, so open shifts are
// closed for the day and overnight shifts get their 00:00 continuation.
async function maybeRollover(now) {
  const ymd = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (lastRolloverYmd === ymd) return;
  if (now.getHours() === 23 && now.getMinutes() >= 58) {
    lastRolloverYmd = ymd;
    try {
      const res = await store.midnightRollover(now);
      log(`⤺ midnight roll-over: closed ${res.closed}, re-opened ${res.reopened} overnight shift(s)`);
    } catch (err) {
      log(`! midnight roll-over failed: ${err.message}`);
    }
  }
}

async function poll() {
  // Start a little before the last seen event to tolerate clock skew; the seen
  // set prevents double-processing the overlap.
  const now = new Date();
  await maybeRollover(now);
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

const deviceConfigured = !!(config.deviceBaseUrl && config.username && config.password);

// Live device polling loop (the real Hikvision terminal).
async function startDeviceMode() {
  const persisted = state.load();
  lastTimeMs = persisted.lastTimeMs;
  persisted.seen.forEach((k) => seenSet.add(k));

  log("● Mode:    DEVICE (live polling)");
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

// Live simulation loop (no device needed) — keeps the app moving.
async function startSimulateMode(reason) {
  log("◆ Mode:    SIMULATE (no device — generating live punches)");
  if (reason) log(`Reason:   ${reason}`);
  await simulate.run(store, log, config);
}

// Decide which mode to run. SIMULATE=on/off forces it; otherwise we probe the
// device and fall back to simulation when it isn't reachable — so `npm run start`
// brings the system live either way.
async function main() {
  log("Qui · attendance bridge starting");

  if (config.simulate === "on") {
    return startSimulateMode("SIMULATE=1 (forced)");
  }

  if (config.simulate === "off") {
    if (!deviceConfigured) {
      log("! SIMULATE=0 but no device configured (set HIK_HOST/HIK_USER/HIK_PASS in .env).");
      process.exit(1);
    }
    return startDeviceMode();
  }

  // auto
  if (!deviceConfigured) {
    return startSimulateMode("no device configured in .env");
  }
  try {
    log(`Probing device at ${config.deviceBaseUrl} …`);
    await ping();
    return startDeviceMode();
  } catch (err) {
    return startSimulateMode(`device unreachable (${String(err.message).slice(0, 80)})`);
  }
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
