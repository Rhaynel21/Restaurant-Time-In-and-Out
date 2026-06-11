// Thin wrapper over the Hikvision ISAPI AcsEvent (access-control event) search
// endpoint. We POLL this endpoint instead of relying on the device pushing
// events, so it works behind NAT/firewalls with zero device-side config.
const { digestFetch } = require("./digest");
const config = require("./config");

// Format a JS Date as the local ISO8601 string Hikvision expects, e.g.
// "2026-06-11T08:30:00+08:00". We keep wall-clock components and append the
// configured offset (the device clock is assumed to be in that same zone).
function toDeviceTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  // Shift the UTC value by the configured offset so the printed wall-clock
  // matches the device's local time.
  const sign = config.tzOffset.startsWith("-") ? -1 : 1;
  const [oh, om] = config.tzOffset.replace(/[+-]/, "").split(":").map(Number);
  const shifted = new Date(date.getTime() + sign * (oh * 60 + om) * 60000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${config.tzOffset}`
  );
}

// Parse a device event time (with offset) back into a real Date.
function parseDeviceTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Fetch all access events in [start, end], following pagination.
async function fetchEvents(start, end) {
  const url = `${config.deviceBaseUrl}/ISAPI/AccessControl/AcsEvent?format=json`;
  const startTime = toDeviceTime(start);
  const endTime = toDeviceTime(end);

  const collected = [];
  let position = 0;

  // Safety cap so a misconfigured window can't loop forever.
  for (let page = 0; page < 200; page += 1) {
    const body = JSON.stringify({
      AcsEventCond: {
        searchID: "thymein-bridge",
        searchResultPosition: position,
        maxResults: 30,
        major: config.eventMajor,
        minor: config.eventMinor,
        startTime,
        endTime,
      },
    });

    const res = await digestFetch(url, {
      method: "POST",
      body,
      username: config.username,
      password: config.password,
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AcsEvent HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const info = json.AcsEvent || {};
    const list = Array.isArray(info.InfoList) ? info.InfoList : [];
    collected.push(...list);

    const total = Number(info.totalMatches || 0);
    position += list.length;

    const status = info.responseStatusStrg; // "OK" | "MORE" | "NO MATCH"
    if (list.length === 0 || status === "NO MATCH" || status === "OK") break;
    if (total && position >= total) break;
  }

  return collected;
}

// Normalize a raw device event into the fields the bridge cares about. Returns
// null for events that don't represent a person authenticating.
function normalizeEvent(raw) {
  const employeeNo =
    raw.employeeNoString != null
      ? String(raw.employeeNoString).trim()
      : raw.employeeNo != null
        ? String(raw.employeeNo).trim()
        : "";

  if (!employeeNo || employeeNo === "0") return null; // not a person event

  const time = parseDeviceTime(raw.time);
  if (!time) return null;

  return {
    employeeNo,
    name: typeof raw.name === "string" ? raw.name : "",
    time,
    // Hikvision sets attendanceStatus when the device is in T&A mode:
    // "checkIn" | "checkOut" | "breakIn" | "breakOut" | "overtimeIn" ...
    attendanceStatus: typeof raw.attendanceStatus === "string" ? raw.attendanceStatus : "",
    major: raw.major,
    minor: raw.minor,
    serialNo: raw.serialNo,
    // Stable de-dup key across overlapping poll windows.
    key: `${raw.serialNo ?? raw.time}-${employeeNo}-${raw.major}-${raw.minor}`,
  };
}

// Quick reachability / auth check used by `npm run test:connect`.
async function ping() {
  const url = `${config.deviceBaseUrl}/ISAPI/System/deviceInfo?format=json`;
  const res = await digestFetch(url, {
    method: "GET",
    username: config.username,
    password: config.password,
  });
  if (!res.ok) throw new Error(`deviceInfo HTTP ${res.status}`);
  return res.json();
}

module.exports = { fetchEvents, normalizeEvent, ping, toDeviceTime };
