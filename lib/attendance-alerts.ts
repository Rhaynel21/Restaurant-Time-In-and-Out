import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/lib/firebase";

export type AttendanceAlertSettings = {
  companyId: string;
  enabled: boolean;
  minPresentPerBranch: number;
  checkHour: number;
  recipientPhones: string[];
};

export const defaultAttendanceAlertSettings = (companyId: string): AttendanceAlertSettings => ({
  companyId, enabled: false, minPresentPerBranch: 3, checkHour: 10, recipientPhones: [],
});

function fromData(companyId: string, data: Record<string, unknown>): AttendanceAlertSettings {
  return {
    companyId,
    enabled: data.enabled === true,
    minPresentPerBranch: typeof data.minPresentPerBranch === "number" ? Math.max(1, Math.floor(data.minPresentPerBranch)) : 3,
    checkHour: typeof data.checkHour === "number" ? Math.min(23, Math.max(0, Math.floor(data.checkHour))) : 10,
    recipientPhones: Array.isArray(data.recipientPhones) ? data.recipientPhones.filter((x): x is string => typeof x === "string" && !!x.trim()) : [],
  };
}

export function subscribeAttendanceAlertSettings(companyId: string, onChange: (settings: AttendanceAlertSettings) => void) {
  return onSnapshot(doc(db, "attendance_alert_settings", companyId), (snap) =>
    onChange(snap.exists() ? fromData(companyId, snap.data() as Record<string, unknown>) : defaultAttendanceAlertSettings(companyId)),
  );
}

export async function saveAttendanceAlertSettings(settings: AttendanceAlertSettings, updatedBy: string) {
  await setDoc(doc(db, "attendance_alert_settings", settings.companyId), {
    ...settings,
    recipientPhones: settings.recipientPhones.map((p) => p.trim()).filter(Boolean),
    updatedBy,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function sendAttendanceAlertNow(companyId: string) {
  const call = httpsCallable<{ companyId: string }, { ok: boolean; abnormalBranches: number; sent: number }>(functions, "sendAttendanceAlertNow");
  return (await call({ companyId })).data;
}
