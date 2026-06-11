// Thyme In — Hikvision attendance bridge.
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

const seenSet = new Set();
let lastTimeMs = null;
// Per-employee timestamp of the last punch we wrote, for debouncing.
const lastPunchByEmployee = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function processEvent(evt) {
  const emp = await store.resolveEmployee(evt.employeeNo, evt.name);

  // Debounce repeated scans of the same badge within the configured window.
  const lastPunch = lastPunchByEmployee.get(emp.employeeId);
  if (lastPunch && Math.abs(evt.time.getTime() - lastPunch) < config.debounceSeconds * 1000) {
    log(`· debounced ${emp.employeeId} (${emp.name})`);
    return;
  }

  const open = await store.findOpenRecord(emp.employeeId);

  // Direction: respect the device's T&A status if it sends one, otherwise infer
  // from whether the employee currently has an open (un-checked-out) record.
  let direction;
  if (evt.attendanceStatus === "checkIn") direction = "in";
  else if (evt.attendanceStatus === "checkOut") direction = "out";
  else direction = open ? "out" : "in";

  if (direction === "out") {
    if (!open) {
      // Device said check-out but there's nothing open — treat as a fresh in
      // so we never silently drop a punch.
      const id = await store.writeCheckIn(emp, evt.time);
      log(`▸ IN  ${emp.employeeId} (${emp.name}) [no open record, coerced] → ${id}`);
    } else {
      const { totalMinutes } = await store.writeCheckOut(open, evt.time);
      log(`◂ OUT ${emp.employeeId} (${emp.name}) → ${open.id} (${totalMinutes} min)`);
    }
  } else {
    if (open) {
      // Already clocked in — a second "in" usually means a missed checkout.
      // Close the old shift first, then open a new one.
      await store.writeCheckOut(open, evt.time);
      log(`  (auto-closed stale open shift ${open.id} for ${emp.employeeId})`);
    }
    const id = await store.writeCheckIn(emp, evt.time);
    log(`▸ IN  ${emp.employeeId} (${emp.name}) → ${id}`);
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

  log("Thyme In · Hikvision bridge starting");
  log(`Device:   ${config.deviceBaseUrl}`);
  log(`Interval: ${config.pollIntervalMs}ms`);
  log(lastTimeMs ? `Resuming from ${new Date(lastTimeMs).toISOString()}` : "Fresh start (today)");

  let polling = false;
  const tick = async () => {
    if (polling) return; // never overlap polls
    polling = true;
    try {
      await poll();
    } catch (err) {
      log(`! poll error: ${err.message}`);
    } finally {
      polling = false;
    }
  };

  await tick();
  setInterval(tick, config.pollIntervalMs);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
