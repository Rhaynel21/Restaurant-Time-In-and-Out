// Tiny JSON file that survives restarts so the bridge doesn't re-process or miss
// events. Tracks the last processed event time and a bounded set of seen keys.
const path = require("path");
const fs = require("fs");

const STATE_PATH = path.join(__dirname, "..", "state.json");
const MAX_SEEN = 500;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return {
      lastTimeMs: typeof raw.lastTimeMs === "number" ? raw.lastTimeMs : null,
      seen: Array.isArray(raw.seen) ? raw.seen : [],
    };
  } catch {
    return { lastTimeMs: null, seen: [] };
  }
}

function save(state) {
  const trimmed = {
    lastTimeMs: state.lastTimeMs,
    seen: state.seen.slice(-MAX_SEEN),
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(trimmed, null, 2));
}

module.exports = { load, save };
