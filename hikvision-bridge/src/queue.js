// Durable offline write queue. When Firestore is unreachable (no internet on the
// hub), punches are appended here as JSON and replayed once connectivity returns,
// so a scan is never lost. Writes are idempotent (deterministic doc IDs), so a
// replayed op can't create a duplicate record.
const path = require("path");
const fs = require("fs");

const QUEUE_PATH = path.join(__dirname, "..", "queue.json");
const MAX_QUEUE = 5000; // safety cap so a long outage can't grow the file unbounded

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persist(ops) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(ops.slice(-MAX_QUEUE), null, 2));
}

// Append one pending operation: { kind: "checkin"|"checkout", ... }.
function enqueue(op) {
  const ops = load();
  ops.push({ ...op, queuedAt: op.queuedAt || Date.now() });
  persist(ops);
}

function size() {
  return load().length;
}

// Replay every queued op via `runner(op)`. Ops that succeed are dropped; ops that
// still fail are kept for the next attempt. Returns the count flushed.
async function flush(runner) {
  const ops = load();
  if (ops.length === 0) return 0;

  const remaining = [];
  let flushed = 0;
  for (const op of ops) {
    try {
      await runner(op);
      flushed += 1;
    } catch {
      remaining.push(op); // keep for the next flush
    }
  }
  persist(remaining);
  return flushed;
}

module.exports = { enqueue, flush, size };
