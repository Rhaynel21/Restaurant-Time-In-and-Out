import { AttendanceRecord } from "@/lib/attendance";
import { Holiday, getHoliday } from "@/lib/holidays";
import { Schedule, Shift, effectiveShift, formatShift, scheduleBreakMinutes, shiftMinutes } from "@/lib/schedules";

// Pure DTR (Daily Time Record) computation: combine a month's attendance with the
// employee's schedule + Philippine holidays into one row per calendar day. Shared
// by the manager portal (and reusable anywhere a DTR is needed).

export type DtrStatus = "present" | "rest" | "holiday" | "absent" | "leave" | "upcoming";

// Approved requests folded into the DTR: paid leaves, DTR corrections (override
// a day's in/out), and filed overtime (a floor on that day's OT). Structural
// shapes so callers can pass their leave / attendance-request records directly.
export type DtrApprovals = {
  leaves?: { startDate: string; endDate: string; type: string; status?: string }[];
  requests?: { kind: string; date: string; hours?: number | null; correctIn?: string | null; correctOut?: string | null; status?: string }[];
};

export type DtrRow = {
  day: number;
  ymd: string;
  weekdayShort: string;
  scheduleLabel: string;
  shift: Shift;
  timeIn: Date | null;
  timeOut: Date | null;
  breakOut: Date | null;
  breakIn: Date | null;
  breakMinutes: number;
  workedMinutes: number;
  lateMinutes: number; // minutes past scheduled start (0 within grace / on rest days)
  otMinutes: number; // overtime: worked beyond the scheduled paid shift (all hours on a rest day)
  underMinutes: number; // undertime: scheduled paid shift not met (working days with a full punch)
  nightMinutes: number; // hours worked within the 10 PM–6 AM night-differential window
  late: boolean;
  anomaly: boolean; // punch pair exceeds the max sane shift (forgotten time-out) → capped
  holiday: Holiday | null;
  status: DtrStatus;
  leaveType: string | null; // set when status === "leave"
};

export type DtrSummary = {
  totalMinutes: number;
  breakMinutes: number;
  otMinutes: number;
  underMinutes: number;
  nightMinutes: number;
  present: number;
  paidLeaveDays: number; // approved paid-leave days (paid but not "worked")
  late: number;
  absent: number;
  restDays: number;
  anomalies: number; // days with a capped/forgotten-time-out punch pair (need review)
};

export type Dtr = { rows: DtrRow[]; summary: DtrSummary };

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LATE_GRACE_MIN = 5;

// A single punch pair longer than this is treated as a data anomaly — almost
// always a forgotten time-out (or a stale open record that got closed days
// later). We cap it so one missed punch can't inject hundreds of overtime hours
// into payroll. The bridge's midnight roll-over prevents most of these; this is
// the payroll-side safety net for any that slip through or already exist.
export const MAX_SHIFT_MINUTES = 16 * 60; // 16 hours

// Philippine night-differential window: 10:00 PM → 6:00 AM.
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// "HH:MM" on a given date → Date.
function hhmm(date: Date, s: string): Date {
  const [h, m] = s.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0, 0, 0);
}

// Expand an inclusive YYYY-MM-DD range into its list of day strings.
function expandRange(startYMD: string, endYMD: string): string[] {
  const [sy, sm, sd] = startYMD.split("-").map(Number);
  const [ey, em, ed] = endYMD.split("-").map(Number);
  if (!sy || !ey) return [];
  const out: string[] = [];
  const d = new Date(sy, (sm || 1) - 1, sd || 1);
  const end = new Date(ey, (em || 1) - 1, ed || 1);
  let guard = 0;
  while (d <= end && guard < 400) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
    guard += 1;
  }
  return out;
}

// Minutes of overlap between two [start, end] millisecond ranges.
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? Math.round((e - s) / 60000) : 0;
}

// Minutes of the interval [inAt, outAt] that fall inside the night-differential
// window (22:00–06:00). Handles shifts that cross midnight by walking each day
// the interval touches and summing its early-morning and late-night slices.
export function nightMinutes(inAt: Date | null, outAt: Date | null): number {
  if (!inAt || !outAt || outAt <= inAt) return 0;
  const from = inAt.getTime();
  const to = outAt.getTime();
  let total = 0;
  const cursor = new Date(inAt);
  cursor.setHours(0, 0, 0, 0);
  const guard = new Date(outAt);
  guard.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= guard.getTime()) {
    const dayStart = cursor.getTime();
    total += overlapMinutes(from, to, dayStart, dayStart + NIGHT_END_HOUR * 3600000); // 00:00–06:00
    total += overlapMinutes(from, to, dayStart + NIGHT_START_HOUR * 3600000, dayStart + 24 * 3600000); // 22:00–24:00
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

// Build the DTR for one employee for a given year/month (month is 0-indexed).
// `records` are that employee's attendance rows for the month (any order).
export function buildDtr(
  year: number,
  month: number,
  schedule: Schedule,
  records: AttendanceRecord[],
  approvals?: DtrApprovals,
): Dtr {
  // Index approved requests/leaves by day so they can be folded into the DTR.
  const correctionByYmd = new Map<string, { correctIn?: string | null; correctOut?: string | null }>();
  const otHoursByYmd = new Map<string, number>();
  for (const r of approvals?.requests ?? []) {
    if (r.status && r.status !== "approved") continue;
    if (r.kind === "correction") correctionByYmd.set(r.date, { correctIn: r.correctIn, correctOut: r.correctOut });
    else if (r.kind === "overtime") otHoursByYmd.set(r.date, (otHoursByYmd.get(r.date) ?? 0) + (r.hours ?? 0));
  }
  const leaveByYmd = new Map<string, string>();
  for (const l of approvals?.leaves ?? []) {
    if (l.status && l.status !== "approved") continue;
    for (const dstr of expandRange(l.startDate, l.endDate)) leaveByYmd.set(dstr, l.type);
  }
  // Midnight roll-over recombination: an overnight shift split at 00:00 into a
  // parent (…→23:59, autoClosed) and a continuation (00:00→real-out, autoOpened)
  // is stitched back into ONE shift on the parent's start day, so the hours land
  // on the day the shift began — exactly as an un-split overnight shift would.
  const working = records.map((r) => ({ ...r }));
  const byId = new Map(working.map((r) => [r.id, r]));
  const skip = new Set<string>();
  for (const r of working) {
    if (!r.autoOpened || !r.continuedFrom) continue;
    const parent = byId.get(r.continuedFrom);
    if (!parent) continue;
    // Extend the parent shift to the continuation's real time-out (null = still open).
    parent.checkOutAt = r.checkOutAt;
    if (!parent.breakOutAt && r.breakOutAt) parent.breakOutAt = r.breakOutAt;
    if (!parent.breakInAt && r.breakInAt) parent.breakInAt = r.breakInAt;
    skip.add(r.id);
  }
  const effectiveRecords = working.filter((r) => !skip.has(r.id));

  // Collapse multiple punches per day into earliest-in / latest-out, keeping the
  // day's break window (break-out / break-in) if the bridge recorded one.
  const byDay = new Map<number, { in: Date; out: Date | null; breakOut: Date | null; breakIn: Date | null }>();
  for (const r of effectiveRecords) {
    if (r.checkInAt.getFullYear() !== year || r.checkInAt.getMonth() !== month) continue;
    const day = r.checkInAt.getDate();
    const cur = byDay.get(day);
    if (!cur) {
      byDay.set(day, { in: r.checkInAt, out: r.checkOutAt, breakOut: r.breakOutAt, breakIn: r.breakInAt });
    } else {
      if (r.checkInAt < cur.in) cur.in = r.checkInAt;
      if (r.checkOutAt && (!cur.out || r.checkOutAt > cur.out)) cur.out = r.checkOutAt;
      if (r.breakOutAt && !cur.breakOut) cur.breakOut = r.breakOutAt;
      if (r.breakInAt && !cur.breakIn) cur.breakIn = r.breakInAt;
    }
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: DtrRow[] = [];
  const summary: DtrSummary = {
    totalMinutes: 0,
    breakMinutes: 0,
    otMinutes: 0,
    underMinutes: 0,
    nightMinutes: 0,
    present: 0,
    paidLeaveDays: 0,
    late: 0,
    absent: 0,
    restDays: 0,
    anomalies: 0,
  };

  // Scheduled meal break is unpaid, so the paid target for a working day is the
  // shift span minus that break.
  const scheduledBreak = scheduleBreakMinutes(schedule);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const ymd = `${year}-${pad(month + 1)}-${pad(day)}`;
    const date = new Date(year, month, day);
    const shift = effectiveShift(schedule, ymd);
    const holiday = getHoliday(ymd);
    let att = byDay.get(day);

    // Approved DTR correction: override this day's in/out (fills a missed punch).
    const corr = correctionByYmd.get(ymd);
    if (corr && (corr.correctIn || corr.correctOut)) {
      const cin = corr.correctIn ? hhmm(date, corr.correctIn) : att?.in ?? null;
      let cout = corr.correctOut ? hhmm(date, corr.correctOut) : att?.out ?? null;
      if (cin && cout && cout.getTime() <= cin.getTime()) cout = new Date(cout.getTime() + 24 * 3600000);
      if (cin) att = { in: cin, out: cout, breakOut: att?.breakOut ?? null, breakIn: att?.breakIn ?? null };
    }

    // Paid minutes the schedule expects on this day (0 on rest days).
    const scheduledPaid = shift.off ? 0 : Math.max(0, shiftMinutes(shift) - scheduledBreak);

    let status: DtrStatus = "upcoming";
    let workedMinutes = 0;
    let breakMinutes = 0;
    let lateMinutes = 0;
    let otMinutes = 0;
    let underMinutes = 0;
    let nightMins = 0;
    let late = false;
    let anomaly = false;
    let leaveType: string | null = null;

    if (att) {
      status = "present";
      summary.present += 1;
      // A recorded break (break-out → break-in) is unpaid and comes off the total.
      if (att.breakOut && att.breakIn && att.breakIn > att.breakOut) {
        breakMinutes = Math.round((att.breakIn.getTime() - att.breakOut.getTime()) / 60000);
      }
      if (att.out) {
        let gross = Math.max(0, Math.round((att.out.getTime() - att.in.getTime()) / 60000));
        // Forgotten time-out / stale open record: a shift longer than the sane
        // maximum is capped so it can't inject phantom overtime. Fall back to the
        // scheduled paid target (a normal shift, no OT); with no schedule, cap at
        // the max. The day is flagged so a manager can correct the punch.
        if (gross > MAX_SHIFT_MINUTES) {
          anomaly = true;
          summary.anomalies += 1;
          gross = scheduledPaid > 0 ? scheduledPaid + breakMinutes : MAX_SHIFT_MINUTES;
        }
        workedMinutes = Math.max(0, gross - breakMinutes);
        summary.totalMinutes += workedMinutes;
        summary.breakMinutes += breakMinutes;

        // Overtime vs. undertime measured against the scheduled paid target.
        // Every paid hour on a rest day counts as overtime.
        if (shift.off) {
          otMinutes = workedMinutes;
        } else if (workedMinutes > scheduledPaid) {
          otMinutes = workedMinutes - scheduledPaid;
        } else if (workedMinutes < scheduledPaid) {
          underMinutes = scheduledPaid - workedMinutes;
        }

        // Night differential: worked time in 22:00–06:00, excluding any break.
        nightMins = Math.max(0, nightMinutes(att.in, att.out) - nightMinutes(att.breakOut, att.breakIn));

        summary.otMinutes += otMinutes;
        summary.underMinutes += underMinutes;
        summary.nightMinutes += nightMins;
      }
      if (!shift.off) {
        const [sh, sm] = shift.start.split(":").map(Number);
        const schedStart = new Date(att.in);
        schedStart.setHours(sh, sm, 0, 0);
        const lateBy = Math.round((att.in.getTime() - schedStart.getTime()) / 60000);
        if (lateBy > LATE_GRACE_MIN) {
          late = true;
          lateMinutes = lateBy;
          summary.late += 1;
        }
      }
    } else if (shift.off) {
      status = "rest";
      summary.restDays += 1;
    } else if (holiday) {
      status = "holiday";
    } else if (leaveByYmd.has(ymd)) {
      status = "leave";
      leaveType = leaveByYmd.get(ymd) ?? null;
      if (leaveType !== "unpaid") summary.paidLeaveDays += 1;
    } else if (date.getTime() < today.getTime()) {
      status = "absent";
      summary.absent += 1;
    } else {
      status = "upcoming";
    }

    // Approved filed overtime sets a floor on this day's OT (present days).
    if (status === "present") {
      const otFloor = Math.round((otHoursByYmd.get(ymd) ?? 0) * 60);
      if (otFloor > otMinutes) {
        summary.otMinutes += otFloor - otMinutes;
        otMinutes = otFloor;
      }
    }

    rows.push({
      day,
      ymd,
      weekdayShort: WD_SHORT[date.getDay()],
      scheduleLabel: formatShift(shift),
      shift,
      timeIn: att ? att.in : null,
      timeOut: att?.out ?? null,
      breakOut: att?.breakOut ?? null,
      breakIn: att?.breakIn ?? null,
      breakMinutes,
      workedMinutes,
      lateMinutes,
      otMinutes,
      underMinutes,
      nightMinutes: nightMins,
      late,
      anomaly,
      holiday,
      status,
      leaveType,
    });
  }

  return { rows, summary };
}

// Slice a month's DTR to a day range [fromDay, toDay] (inclusive) and recompute
// its summary — used for semi-monthly / weekly pay periods.
export function sliceDtr(dtr: Dtr, fromDay: number, toDay: number): Dtr {
  const rows = dtr.rows.filter((r) => r.day >= fromDay && r.day <= toDay);
  const summary: DtrSummary = {
    totalMinutes: 0, breakMinutes: 0, otMinutes: 0, underMinutes: 0, nightMinutes: 0,
    present: 0, paidLeaveDays: 0, late: 0, absent: 0, restDays: 0, anomalies: 0,
  };
  for (const r of rows) {
    summary.totalMinutes += r.workedMinutes;
    summary.breakMinutes += r.breakMinutes;
    summary.otMinutes += r.otMinutes;
    summary.underMinutes += r.underMinutes;
    summary.nightMinutes += r.nightMinutes;
    if (r.status === "present") summary.present += 1;
    if (r.status === "leave" && r.leaveType !== "unpaid") summary.paidLeaveDays += 1;
    if (r.late) summary.late += 1;
    if (r.status === "absent") summary.absent += 1;
    if (r.status === "rest") summary.restDays += 1;
    if (r.anomaly) summary.anomalies += 1;
  }
  return { rows, summary };
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function formatClock(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// Plain-text status label for a row (used in CSV export + table cells).
export function statusLabel(row: DtrRow): string {
  if (row.status === "present") return row.late ? "Present (Late)" : "Present";
  if (row.status === "rest") return "Rest day";
  if (row.status === "holiday") return row.holiday ? row.holiday.name : "Holiday";
  if (row.status === "leave") return row.leaveType ? `Leave (${row.leaveType})` : "Leave";
  if (row.status === "absent") return "Absent";
  return "";
}
