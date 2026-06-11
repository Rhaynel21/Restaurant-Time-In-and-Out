// Quick diagnostic: verifies the bridge can reach + authenticate to the device
// and pull recent events. Run with `npm run test:connect`.
const { ping, fetchEvents, normalizeEvent } = require("./hikvision");

(async () => {
  try {
    console.log("Pinging device...");
    const info = await ping();
    const d = info.DeviceInfo || {};
    console.log(`✓ Connected: ${d.deviceName || "device"} (model ${d.model || "?"}, fw ${d.firmwareVersion || "?"})`);

    const now = new Date();
    const start = new Date(now.getTime() - 24 * 3600 * 1000);
    console.log("\nFetching last 24h of access events...");
    const raw = await fetchEvents(start, now);
    const events = raw.map(normalizeEvent).filter(Boolean);
    console.log(`✓ ${raw.length} raw events, ${events.length} person punches.`);
    events.slice(-10).forEach((e) => {
      console.log(`  ${e.time.toISOString()}  emp=${e.employeeNo}  ${e.name || ""}  status=${e.attendanceStatus || "(none)"}`);
    });
    console.log("\nLooks good. Fill in employee-map.json if device IDs differ from app IDs.");
  } catch (err) {
    console.error("✗ Failed:", err.message);
    process.exit(1);
  }
})();
