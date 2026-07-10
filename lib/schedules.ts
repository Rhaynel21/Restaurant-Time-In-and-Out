import { doc, onSnapshot, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";

// Work schedules, one document per employee at `schedules/{employeeId}`.
//
// Hybrid model:
//   • `weekly`  — the default shift for each weekday (Sun..Sat), used every week.
//   • `overrides` — exceptions keyed by YYYY-MM-DD that win over the weekly shift
//     for that single day (e.g. a one-off rest day, a swapped shift, OT).
//
// The effective shift for any date = override(date) ?? weekly[weekday].

export type Shift = {
  off: boolean; // true = rest day (start/end ignored)
  start: string; // "HH:MM" 24h
  end: string; // "HH:MM" 24h
};

export type Schedule = {
  employeeId: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  weekly: Shift[]; // length 7, index 0 = Sunday … 6 = Saturday
  overrides: Record<string, Shift>; // YYYY-MM-DD -> shift
  // One unpaid meal break window (HH:MM), applied to every working day. The
  // biometric bridge uses this window to classify break-out / break-in punches,
  // and the DTR deducts the break from worked hours. null = no scheduled break.
  breakStart: string | null;
  breakEnd: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A sensible restaurant default: Mon–Sat 9:00–18:00, Sunday off.
export function defaultWeekly(): Shift[] {
  return WEEKDAY_LABELS.map((_, day) =>
    day === 0 ? { off: true, start: "09:00", end: "18:00" } : { off: false, start: "09:00", end: "18:00" },
  );
}

function toShift(value: unknown): Shift {
  const v = (value ?? {}) as Partial<Shift>;
  return {
    off: typeof v.off === "boolean" ? v.off : false,
    start: typeof v.start === "string" ? v.start : "09:00",
    end: typeof v.end === "string" ? v.end : "18:00",
  };
}

function timestampToDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value && typeof value === "object" && "seconds" in value) {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return null;
}

function toSchedule(employeeId: string, data: Record<string, unknown>): Schedule {
  const weeklyRaw = Array.isArray(data.weekly) ? data.weekly : [];
  const weekly = WEEKDAY_LABELS.map((_, i) => toShift(weeklyRaw[i]));

  const overrides: Record<string, Shift> = {};
  if (data.overrides && typeof data.overrides === "object") {
    for (const [ymd, shift] of Object.entries(data.overrides as Record<string, unknown>)) {
      overrides[ymd] = toShift(shift);
    }
  }

  return {
    employeeId,
    employeeName: typeof data.employeeName === "string" ? data.employeeName : employeeId,
    branchId: typeof data.branchId === "string" ? data.branchId : null,
    branchName: typeof data.branchName === "string" ? data.branchName : null,
    weekly,
    overrides,
    breakStart: typeof data.breakStart === "string" ? data.breakStart : null,
    breakEnd: typeof data.breakEnd === "string" ? data.breakEnd : null,
    updatedAt: timestampToDate(data.updatedAt),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
  };
}

// An empty/default schedule for an employee who has none saved yet. Defaults to
// a 12:00–13:00 unpaid meal break, the common restaurant lunch window.
export function emptySchedule(employeeId: string, employeeName = employeeId): Schedule {
  return {
    employeeId,
    employeeName,
    branchId: null,
    branchName: null,
    weekly: defaultWeekly(),
    overrides: {},
    breakStart: "12:00",
    breakEnd: "13:00",
    updatedAt: null,
    updatedBy: null,
  };
}

// Length of the scheduled meal break in minutes (0 when no break is set).
export function scheduleBreakMinutes(schedule: Pick<Schedule, "breakStart" | "breakEnd">): number {
  if (!schedule.breakStart || !schedule.breakEnd) return 0;
  const [sh, sm] = schedule.breakStart.split(":").map(Number);
  const [eh, em] = schedule.breakEnd.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? mins : 0;
}

// "12:00 PM – 1:00 PM" or "No break".
export function formatBreak(schedule: Pick<Schedule, "breakStart" | "breakEnd">): string {
  if (!schedule.breakStart || !schedule.breakEnd) return "No break";
  return `${formatTime12(schedule.breakStart)} – ${formatTime12(schedule.breakEnd)}`;
}

// The shift that actually applies on a given date: an override wins, otherwise
// the weekly default for that weekday.
export function effectiveShift(schedule: Schedule, ymd: string): Shift {
  if (schedule.overrides[ymd]) return schedule.overrides[ymd];
  const [y, m, d] = ymd.split("-").map(Number);
  const weekday = new Date(y, (m || 1) - 1, d || 1).getDay();
  return schedule.weekly[weekday] ?? { off: true, start: "09:00", end: "18:00" };
}

// Parse a YYYY-MM-DD string into a local Date (safe against bad input).
export function fromYMDsafe(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

// "9:00 AM" from "09:00".
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// "9:00 AM – 6:00 PM" or "Rest day".
export function formatShift(shift: Shift): string {
  if (shift.off) return "Rest day";
  return `${formatTime12(shift.start)} – ${formatTime12(shift.end)}`;
}

// Scheduled shift length in minutes (0 for rest days / invalid ranges).
export function shiftMinutes(shift: Shift): number {
  if (shift.off) return 0;
  const [sh, sm] = shift.start.split(":").map(Number);
  const [eh, em] = shift.end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? mins : 0;
}

// Real-time stream of one employee's schedule. Fires with the default schedule
// (not null) when none is saved yet, so callers always have something to show.
export function subscribeSchedule(
  employeeId: string,
  onChange: (schedule: Schedule) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, "schedules", employeeId),
    (snap) => {
      if (!snap.exists()) {
        onChange(emptySchedule(employeeId));
        return;
      }
      onChange(toSchedule(employeeId, snap.data() as Record<string, unknown>));
    },
    (error) => onError?.(error as Error),
  );
}

// One-shot read.
export async function getSchedule(employeeId: string): Promise<Schedule> {
  const snap = await getDoc(doc(db, "schedules", employeeId));
  if (!snap.exists()) return emptySchedule(employeeId);
  return toSchedule(employeeId, snap.data() as Record<string, unknown>);
}

// Create or update a schedule (used by managers/admins).
export async function saveSchedule(
  schedule: Pick<
    Schedule,
    "employeeId" | "employeeName" | "branchId" | "branchName" | "weekly" | "overrides" | "breakStart" | "breakEnd"
  >,
  updatedBy: string,
) {
  await setDoc(
    doc(db, "schedules", schedule.employeeId),
    {
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      branchId: schedule.branchId,
      branchName: schedule.branchName,
      weekly: schedule.weekly,
      overrides: schedule.overrides,
      breakStart: schedule.breakStart ?? null,
      breakEnd: schedule.breakEnd ?? null,
      updatedBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
