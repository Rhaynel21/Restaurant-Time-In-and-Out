# Device SDK & TCP/IP → Local Hub — evaluation

Scope: how the Hikvision terminal(s) get their scans to the **Local Hub** (this
bridge process) and on to Firestore, and whether to move off HTTP polling.

Status of the two sibling asks:

| Ask | State | Where |
| --- | --- | --- |
| **Offline queue** | ✅ Implemented | [`src/queue.js`](src/queue.js) — durable JSON queue, idempotent replay via deterministic doc IDs, 5000-op cap; wired through [`src/firestore.js`](src/firestore.js) (`enqueue` on network error, `flushQueue` on recovery) and [`src/index.js`](src/index.js) (`flushQueue` each successful poll). |
| **Tamper detection** | ✅ Implemented | [`src/tamper.js`](src/tamper.js) — failed-auth bursts + case/tamper minor codes, de-duped alarms mirrored to Firestore via `store.recordAlarm`. |
| **Device SDK eval + TCP/IP sync** | 📄 This document | Transport decision below. |

---

## 1. Current transport (baseline)

```
[Hikvision DS-K1T804AMF]  --ISAPI AcsEvent POLL (HTTP+digest, 5s)-->  [Local Hub / this bridge]
                                                                             |  offline queue (queue.json)
                                                                             v
                                                                        [Firestore] --onSnapshot--> app
```

- **Protocol:** ISAPI `POST /ISAPI/AccessControl/AcsEvent` with HTTP digest auth
  ([`src/hikvision.js`](src/hikvision.js)), paginated, polled every
  `POLL_INTERVAL_MS` (default 5000).
- **Pull, not push:** the hub reaches *out* to the device. Works behind NAT and
  with AP isolation off; zero device-side config; survives firmware quirks
  (some models answer `deviceInfo` in XML — already handled).
- **Latency:** up to one poll interval (~5 s) plus Firestore write.
- **Cost:** one small HTTP round-trip per device per interval.

Strengths: dead simple, firewall-friendly, no native deps, already ships with
offline queue + tamper + heartbeat. Weakness: polling latency and per-device
fan-out (N devices = N pollers), and denied/tamper events are only seen at poll
granularity.

---

## 2. Options considered

### A. Keep ISAPI polling *(baseline)*
No change. Best when latency ≤ a few seconds is acceptable and device count per
hub is small (≤ ~10). This is the current, working path.

### B. ISAPI real-time alert stream (HTTP push, still ISAPI)
`GET /ISAPI/Event/notification/alertStream` — device holds an HTTP connection
open and streams multipart events as they happen. **Sub-second latency, no SDK,
no native code** — just a long-lived `fetch`/socket the hub keeps open per
device, with reconnect + fall back to polling on drop.
- Pros: real-time; reuses digest auth; keeps the pull-with-persistent-connection
  model so NAT/firewall story is unchanged; tamper/denied events arrive live.
- Cons: must manage reconnect/backoff and dedupe against the poller if both run;
  multipart parsing; a few devices gate this behind "Notification → Listening".

### C. Hikvision HCNetSDK (native SDK, TCP alarm channel)
Bind the vendor `HCNetSDK` (`.dll`/`.so`) via `koffi`/`ffi-napi` and call
`NET_DVR_SetupAlarmChan_V41` for a real-time TCP alarm channel.
- Pros: vendor-blessed real-time push; richest event payloads; supports
  ISUP/EHome registration where the **device dials the hub** (true device→hub
  TCP, ideal when devices are on untrusted networks and the hub has a stable
  address).
- Cons: **heavy** — platform-specific native binaries, x64/arm builds, FFI
  marshalling, brittle across Node upgrades; large surface for a single-terminal
  restaurant. Only justified at fleet scale or when ISUP dial-in is a hard
  requirement.

### D. Device T&A push to a middleware, hub reads middleware
E.g. iVMS/HikCentral or an MQTT shim. Adds a whole extra system to run. Rejected
— more moving parts than the deployment warrants.

---

## 3. "TCP/IP sync to Local Hub" — what it means here

Two distinct meanings, both satisfied without option C:

1. **Device ↔ Hub link.** Today it's TCP/IP already (HTTP-over-TCP, hub→device
   pull). Option B upgrades it to a persistent TCP stream (device pushes over the
   held-open connection). Option C/ISUP flips the dial direction (device→hub).
2. **Hub → cloud sync.** Already implemented and durable: the offline queue
   ([`src/queue.js`](src/queue.js)) buffers to disk when Firestore is
   unreachable and replays idempotently on reconnect. A LAN-only outage never
   loses a scan.

---

## 4. Recommendation

**Adopt B (ISAPI alertStream) as an opt-in real-time mode; keep A (polling) as
the always-available fallback. Defer C (HCNetSDK) until multi-device / ISUP
dial-in is actually needed.**

Rationale: B gets sub-second latency and live tamper/denied events for
essentially the cost the bridge already pays (one held-open HTTP connection per
device, same digest auth, same NAT story), with **no native dependencies**. The
existing offline queue, tamper analyzer, heartbeat, debounce, and
event-normalizer all sit downstream of transport and are reused unchanged — only
the *event source* swaps from "poll result" to "stream frame."

### Suggested increment (not yet implemented)
- `src/alertStream.js`: open `alertStream`, parse multipart, emit normalized
  events into the **same** `processEvent` path used by the poller.
- Config: `TRANSPORT=poll|stream` (default `poll`), `STREAM_RECONNECT_MS`.
- Run the poller as a low-frequency safety net (e.g. every 60 s) even in stream
  mode to backfill anything missed during a reconnect; the `seenSet` +
  deterministic IDs already make this double-source-safe.
- Keep `flushQueue`, `tamper.analyze`, and `reportHealth` exactly as-is.

Migration is therefore additive and reversible — flip `TRANSPORT` back to `poll`
and nothing else changes.
