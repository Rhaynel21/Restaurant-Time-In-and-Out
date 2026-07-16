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

// One continuous work block within a day. A normal shift has one block; a split
// (broken) shift has two or more — e.g. 09:00–14:00 and 17:00–21:00.
export type ShiftBlock = {
  start: string; // "HH:MM" 24h
  end: string; // "HH:MM" 24h
};

export type Shift = {
  off: boolean; // true = rest day (start/end/segments ignored)
  start: string; // "HH:MM" 24h — mirrors the first block (earliest start)
  end: string; // "HH:MM" 24h — mirrors the last block (latest end)
  // Present only for split/broken shifts (length ≥ 2). When absent, the shift is
  // the single block [start, end]. Callers should read blocks via shiftBlocks().
  segments?: ShiftBlock[];
};

// A rotating rest-day pattern: instead of fixed weekly rest days, the employee
// works `workDays` in a row then rests `restDays`, cycling from `anchorDate`.
// This drives the classic "6 days on, 1 day off" rotation whose rest day drifts
// across the week. `shift` is the hours worked on the rotation's working days.
export type RestRotation = {
  enabled: boolean;
  anchorDate: string; // YYYY-MM-DD — cycle day 0
  workDays: number; // consecutive working days (≥ 1)
  restDays: number; // consecutive rest days (≥ 1)
  shift: Shift; // hours on a rotation working day
};

export type Schedule = {
  employeeId: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  weekly: Shift[]; // length 7, index 0 = Sunday … 6 = Saturday
  overrides: Record<string, Shift>; // YYYY-MM-DD -> shift
  // Optional rotating rest-day pattern. When enabled it decides rest vs. work for
  // every day (overriding the weekly rest flags); a date override still wins.
  restRotation: RestRotation | null;
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

function toBlock(value: unknown): ShiftBlock {
  const b = (value ?? {}) as Partial<ShiftBlock>;
  return {
    start: typeof b.start === "string" ? b.start : "09:00",
    end: typeof b.end === "string" ? b.end : "18:00",
  };
}

function toShift(value: unknown): Shift {
  const v = (value ?? {}) as Partial<Shift> & { segments?: unknown };
  const off = typeof v.off === "boolean" ? v.off : false;
  let start = typeof v.start === "string" ? v.start : "09:00";
  let end = typeof v.end === "string" ? v.end : "18:00";
  if (Array.isArray(v.segments) && v.segments.length >= 2) {
    const segments = v.segments.map(toBlock);
    // Keep start/end mirrored to the span so legacy readers stay correct.
    return { off, start: segments[0].start, end: segments[segments.length - 1].end, segments };
  }
  // A single-element segments array collapses back to a plain shift.
  if (Array.isArray(v.segments) && v.segments.length === 1) {
    const b = toBlock(v.segments[0]);
    start = b.start;
    end = b.end;
  }
  return { off, start, end };
}

// The work blocks that make up a shift: [] on a rest day, the single [start,end]
// for a normal shift, or the explicit list for a split shift.
export function shiftBlocks(shift: Shift): ShiftBlock[] {
  if (shift.off) return [];
  if (shift.segments && shift.segments.length >= 2) return shift.segments;
  return [{ start: shift.start, end: shift.end }];
}

// Build a normalized Shift from a set of blocks, collapsing to a plain shift when
// there is only one block. Rest days ignore the blocks.
export function makeShift(off: boolean, blocks: ShiftBlock[]): Shift {
  if (off || blocks.length === 0) return { off: true, start: "09:00", end: "18:00" };
  if (blocks.length === 1) return { off: false, start: blocks[0].start, end: blocks[0].end };
  return { off: false, start: blocks[0].start, end: blocks[blocks.length - 1].end, segments: blocks };
}

function toRestRotation(value: unknown): RestRotation | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.enabled !== true || typeof o.anchorDate !== "string") return null;
  const workDays = typeof o.workDays === "number" && o.workDays >= 1 ? Math.floor(o.workDays) : 6;
  const restDays = typeof o.restDays === "number" && o.restDays >= 1 ? Math.floor(o.restDays) : 1;
  return { enabled: true, anchorDate: o.anchorDate, workDays, restDays, shift: toShift(o.shift) };
}

// Whole days between two YYYY-MM-DD dates (b − a), in local time.
function daysBetween(aYMD: string, bYMD: string): number {
  const a = fromYMDsafe(aYMD);
  a.setHours(0, 0, 0, 0);
  const b = fromYMDsafe(bYMD);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
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
    restRotation: toRestRotation(data.restRotation),
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
    restRotation: null,
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

// The shift that actually applies on a given date. Precedence:
//   1. a one-off date override (always wins),
//   2. a rotating rest-day pattern, if enabled,
//   3. the weekly default for that weekday.
export function effectiveShift(schedule: Schedule, ymd: string): Shift {
  if (schedule.overrides[ymd]) return schedule.overrides[ymd];

  const rr = schedule.restRotation;
  if (rr && rr.enabled) {
    const cycle = rr.workDays + rr.restDays;
    if (cycle > 0) {
      const idx = ((daysBetween(rr.anchorDate, ymd) % cycle) + cycle) % cycle;
      if (idx >= rr.workDays) return { off: true, start: "09:00", end: "18:00" };
      return rr.shift.off ? { off: false, start: "09:00", end: "18:00" } : rr.shift;
    }
  }

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

// "9:00 AM – 6:00 PM", "9:00 AM – 2:00 PM, 5:00 PM – 9:00 PM" (split), or "Rest day".
export function formatShift(shift: Shift): string {
  if (shift.off) return "Rest day";
  return shiftBlocks(shift)
    .map((b) => `${formatTime12(b.start)} – ${formatTime12(b.end)}`)
    .join(", ");
}

// Total scheduled work length in minutes across all blocks (0 for rest days /
// invalid ranges). For a split shift this sums each block, excluding the gap.
export function shiftMinutes(shift: Shift): number {
  if (shift.off) return 0;
  return shiftBlocks(shift).reduce((sum, b) => {
    const [sh, sm] = b.start.split(":").map(Number);
    const [eh, em] = b.end.split(":").map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    // A block whose end is at/before its start crosses midnight (e.g. an
    // overnight 22:00→06:00 shift) — add a full day so its length is positive.
    if (mins <= 0) mins += 24 * 60;
    return sum + mins;
  }, 0);
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
    | "employeeId"
    | "employeeName"
    | "branchId"
    | "branchName"
    | "weekly"
    | "overrides"
    | "restRotation"
    | "breakStart"
    | "breakEnd"
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
      // Firestore rejects `undefined`; store an explicit null when no rotation.
      restRotation: schedule.restRotation ?? null,
      breakStart: schedule.breakStart ?? null,
      breakEnd: schedule.breakEnd ?? null,
      updatedBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
