# Qui · Hikvision Attendance Bridge

Mirrors clock in/out punches from a Hikvision access-control / biometric device
into the Qui Firestore `attendance` collection. The mobile app listens to
Firestore in real time, so a scan on the device shows up in the app
automatically — no button to press.

```
[Hikvision device]  --ISAPI poll-->  [bridge]  --writes-->  [Firestore]  --onSnapshot-->  [app]
```

## Why a bridge is needed

A biometric device on the LAN cannot talk to a phone app directly. This small
Node.js service sits on a machine on the **same network as the device**, polls
its event API, and writes to the cloud database the app reads.

## Requirements

- Node.js 18+ (uses the built-in `fetch`).
- A machine on the same LAN as the device, **always on**.
- The device's IP, an account with permission to read events (admin or an
  operator), and its event/T&A features enabled.

## Setup

1. **Install deps**
   ```
   cd hikvision-bridge
   npm install
   ```

2. **Service account key** — already placed here as `serviceAccountKey.json`
   (git-ignored). If you ever regenerate it: Firebase Console → Project Settings
   → Service accounts → *Generate new private key*, save as
   `hikvision-bridge/serviceAccountKey.json`.

3. **Configure the device** — copy and edit:
   ```
   copy .env.example .env
   ```
   Set `HIK_HOST`, `HIK_USER`, `HIK_PASS` to your device.

4. **(Optional) map IDs** — if the person IDs enrolled on the device differ from
   the app's `employeeId`s, copy `employee-map.example.json` to
   `employee-map.json` and fill it in. Otherwise the device ID is used directly.

5. **Test the connection**
   ```
   npm run test:connect
   ```
   You should see device info and recent punches.

6. **Run**
   ```
   npm start
   ```
   Leave it running. Each scan is logged and written to Firestore.

## Keeping it running 24/7 (Windows)

Use [PM2](https://pm2.keymetrics.io/) or NSSM to run it as a background service:

```
npm i -g pm2
pm2 start src/index.js --name qui-bridge
pm2 save
pm2 startup   # follow the printed instructions to auto-start on boot
```

## How direction (in vs out) is decided

1. If the device sends a Time & Attendance `attendanceStatus` (`checkIn` /
   `checkOut`), that wins.
2. Otherwise the bridge infers it: if the employee has an **open** record (no
   checkout yet) the scan is a **check-out**, else it's a **check-in**.

Repeat scans within `DEBOUNCE_SECONDS` are ignored to avoid double punches.

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main poll loop + in/out decision |
| `src/hikvision.js` | ISAPI AcsEvent client |
| `src/digest.js` | HTTP Digest auth |
| `src/firestore.js` | Firestore writes (matches app schema) |
| `src/state.js` | Restart-safe cursor (`state.json`) |
| `src/config.js` | Loads `.env` + `employee-map.json` |
| `src/test-connect.js` | Connectivity diagnostic |
