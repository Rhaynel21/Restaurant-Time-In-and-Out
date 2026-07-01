import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

// Mirrors what the Hikvision bridge writes to Firestore (see hikvision-bridge/
// src/firestore.js: heartbeat + recordAlarm).

export type DeviceStatus = {
  deviceId: string;
  deviceName: string;
  online: boolean;
  lastSeenAt: Date | null;
  queueDepth: number;
  lastError: string | null;
};

export type DeviceAlarm = {
  id: string;
  deviceId: string;
  deviceName: string;
  type: string;
  severity: "warning" | "critical";
  message: string;
  count: number | null;
  at: Date | null;
  acknowledged: boolean;
};

function tsToDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "seconds" in value) {
    return new Timestamp((value as { seconds: number }).seconds, 0).toDate();
  }
  return null;
}

// A device counts as offline if it says so, or if its heartbeat is stale (>2 min).
export function isDeviceOnline(d: DeviceStatus): boolean {
  if (!d.online) return false;
  if (!d.lastSeenAt) return false;
  return Date.now() - d.lastSeenAt.getTime() <= 120000;
}

export function subscribeDevices(
  onChange: (devices: DeviceStatus[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    query(collection(db, "deviceStatus")),
    (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          deviceId: d.id,
          deviceName: typeof data.deviceName === "string" ? data.deviceName : d.id,
          online: data.online === true,
          lastSeenAt: tsToDate(data.lastSeenAt),
          queueDepth: typeof data.queueDepth === "number" ? data.queueDepth : 0,
          lastError: typeof data.lastError === "string" ? data.lastError : null,
        } satisfies DeviceStatus;
      });
      items.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}

export function subscribeAlarms(
  onChange: (alarms: DeviceAlarm[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    query(collection(db, "deviceAlarms")),
    (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          deviceId: typeof data.deviceId === "string" ? data.deviceId : "",
          deviceName: typeof data.deviceName === "string" ? data.deviceName : "",
          type: typeof data.type === "string" ? data.type : "alarm",
          severity: data.severity === "critical" ? "critical" : "warning",
          message: typeof data.message === "string" ? data.message : "",
          count: typeof data.count === "number" ? data.count : null,
          at: tsToDate(data.at),
          acknowledged: data.acknowledged === true,
        } satisfies DeviceAlarm;
      });
      items.sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}

export async function acknowledgeAlarm(alarmId: string) {
  await updateDoc(doc(db, "deviceAlarms", alarmId), {
    acknowledged: true,
    updatedAt: serverTimestamp(),
  });
}
