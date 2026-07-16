import { AttendanceRecord } from "@/lib/attendance";
import { Holiday, getHoliday } from "@/lib/holidays";
import { Schedule, Shift, effectiveShift, formatShift, scheduleBreakMinutes, shiftMinutes } from "@/lib/schedules";

// Pure DTR (Daily Time Record) computation: combine a month's attendance with the
// employee's schedule + Philippine holidays into one row per calendar day. Shared
// by the manager portal (and reusable anywhere a DTR is needed).

export type DtrStatus = "present" | "rest" | "holiday" | "absent" | "upcoming";

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
  holiday: Holiday | null;
  status: DtrStatus;
};

export type DtrSummary = {
  totalMinutes: number;
  breakMinutes: number;
  otMinutes: number;
  underMinutes: number;
  nightMinutes: number;
  present: number;
  late: number;
  absent: number;
  restDays: number;
};

export type Dtr = { rows: DtrRow[]; summary: DtrSummary };

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LATE_GRACE_MIN = 5;

// Philippine night-differential window: 10:00 PM → 6:00 AM.
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;

function pad(n: number) {
  return String(n).padStart(2, "0");
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
): Dtr {
  // Collapse multiple punches per day into earliest-in / latest-out, keeping the
  // day's break window (break-out / break-in) if the bridge recorded one.
  const byDay = new Map<number, { in: Date; out: Date | null; breakOut: Date | null; breakIn: Date | null }>();
  for (const r of records) {
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
    late: 0,
    absent: 0,
    restDays: 0,
  };

  // Scheduled meal break is unpaid, so the paid target for a working day is the
  // shift span minus that break.
  const scheduledBreak = scheduleBreakMinutes(schedule);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const ymd = `${year}-${pad(month + 1)}-${pad(day)}`;
    const date = new Date(year, month, day);
    const shift = effectiveShift(schedule, ymd);
    const holiday = getHoliday(ymd);
    const att = byDay.get(day);

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

    if (att) {
      status = "present";
      summary.present += 1;
      // A recorded break (break-out → break-in) is unpaid and comes off the total.
      if (att.breakOut && att.breakIn && att.breakIn > att.breakOut) {
        breakMinutes = Math.round((att.breakIn.getTime() - att.breakOut.getTime()) / 60000);
      }
      if (att.out) {
        const gross = Math.max(0, Math.round((att.out.getTime() - att.in.getTime()) / 60000));
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
    } else if (date.getTime() < today.getTime()) {
      status = "absent";
      summary.absent += 1;
    } else {
      status = "upcoming";
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
      holiday,
      status,
    });
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
  if (row.status === "absent") return "Absent";
  return "";
}
