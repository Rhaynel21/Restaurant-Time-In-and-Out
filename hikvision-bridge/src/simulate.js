// Live attendance SIMULATOR.
//
// When no physical Hikvision terminal is reachable, this keeps the app "live":
// every tick it advances one employee through a realistic punch cycle
//   (no record) → IN → BREAK-OUT → BREAK-IN → OUT → (cycles again next day)
// writing through the very same store used by the real device, so simulated
// punches are indistinguishable from biometric ones and drive the live
// per-branch dashboard in real time.
//
// Enable explicitly with SIMULATE=1, or let the bridge fall back to it
// automatically when the device can't be reached. Set SIMULATE=0 to forbid it.

// Deterministic-ish pick without polluting global RNG expectations — plain
// Math.random is fine here since simulation is inherently non-reproducible.
function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// A fresh check-in is backdated a few hours (clamped to today 00:00) so the
// person already reads as "on shift for a while" and their eventual checkout
// yields a realistic worked total instead of a few seconds.
function backdatedCheckIn(now) {
  const hoursAgo = 1 + Math.floor(Math.random() * 5); // 1–5h
  const t = new Date(now.getTime() - hoursAgo * 3600000);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return t < midnight ? midnight : t;
}

// Advance one employee by one step of the punch cycle. Returns a short label.
async function stepEmployee(store, emp, now) {
  const open = await store.findOpenRecord(emp.employeeId);

  if (!open) {
    await store.writeCheckIn(emp, backdatedCheckIn(now));
    return `IN      ${emp.employeeId} (${emp.name})`;
  }

  const onBreak = open.breakOutAt && !open.breakInAt;
  const breakDone = open.breakOutAt && open.breakInAt;

  if (onBreak) {
    await store.writeBreakIn(open, now);
    return `BRK-IN  ${emp.employeeId} (${emp.name})`;
  }

  // With an open record and no break yet, sometimes take lunch, otherwise clock
  // out. Once break is done, the only remaining step is clock-out.
  if (!breakDone && Math.random() < 0.5) {
    await store.writeBreakOut(open, now);
    return `BRK-OUT ${emp.employeeId} (${emp.name})`;
  }

  const { totalMinutes } = await store.writeCheckOut(open, now);
  return `OUT     ${emp.employeeId} (${emp.name}) — ${totalMinutes} min`;
}

// Start the simulation loop. Returns a stop() function.
async function run(store, log, config) {
  let roster = (await store.listEmployees()).filter((e) => e.status !== "inactive");
  if (roster.length === 0) {
    log("! simulator: no employees found — run `npm run seed` first. Idling.");
  } else {
    log(`◆ SIMULATOR live — ${roster.length} employee(s), tick ${config.simulateTickMs}ms`);
  }

  // Refresh the roster occasionally so newly-added employees join the sim.
  let sinceRefresh = 0;

  let busy = false;
  const tick = async () => {
    if (busy || roster.length === 0) return;
    busy = true;
    try {
      // Punch a small random burst each tick so the board visibly moves.
      const now = new Date();
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i += 1) {
        const emp = choice(roster);
        try {
          const label = await stepEmployee(store, emp, now);
          log(`~ sim ${label}`);
        } catch (err) {
          log(`! sim step failed for ${emp.employeeId}: ${err.message}`);
        }
      }
      await store.heartbeat(true, { mode: "simulate" });

      sinceRefresh += config.simulateTickMs;
      if (sinceRefresh >= 5 * 60 * 1000) {
        sinceRefresh = 0;
        roster = (await store.listEmployees()).filter((e) => e.status !== "inactive");
      }
    } finally {
      busy = false;
    }
  };

  await tick();
  const handle = setInterval(tick, config.simulateTickMs);
  return () => clearInterval(handle);
}

module.exports = { run };
