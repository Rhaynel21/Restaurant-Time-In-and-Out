import { AttendanceRecord } from "@/lib/attendance";
import { Holiday, getHoliday } from "@/lib/holidays";
import { Schedule, Shift, effectiveShift, formatShift } from "@/lib/schedules";

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
  workedMinutes: number;
  late: boolean;
  holiday: Holiday | null;
  status: DtrStatus;
};

export type DtrSummary = {
  totalMinutes: number;
  present: number;
  late: number;
  absent: number;
  restDays: number;
};

export type Dtr = { rows: DtrRow[]; summary: DtrSummary };

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LATE_GRACE_MIN = 5;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Build the DTR for one employee for a given year/month (month is 0-indexed).
// `records` are that employee's attendance rows for the month (any order).
export function buildDtr(
  year: number,
  month: number,
  schedule: Schedule,
  records: AttendanceRecord[],
): Dtr {
  // Collapse multiple punches per day into earliest-in / latest-out.
  const byDay = new Map<number, { in: Date; out: Date | null }>();
  for (const r of records) {
    if (r.checkInAt.getFullYear() !== year || r.checkInAt.getMonth() !== month) continue;
    const day = r.checkInAt.getDate();
    const cur = byDay.get(day);
    if (!cur) {
      byDay.set(day, { in: r.checkInAt, out: r.checkOutAt });
    } else {
      if (r.checkInAt < cur.in) cur.in = r.checkInAt;
      if (r.checkOutAt && (!cur.out || r.checkOutAt > cur.out)) cur.out = r.checkOutAt;
    }
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: DtrRow[] = [];
  const summary: DtrSummary = { totalMinutes: 0, present: 0, late: 0, absent: 0, restDays: 0 };

  for (let day = 1; day <= daysInMonth; day += 1) {
    const ymd = `${year}-${pad(month + 1)}-${pad(day)}`;
    const date = new Date(year, month, day);
    const shift = effectiveShift(schedule, ymd);
    const holiday = getHoliday(ymd);
    const att = byDay.get(day);

    let status: DtrStatus = "upcoming";
    let workedMinutes = 0;
    let late = false;

    if (att) {
      status = "present";
      summary.present += 1;
      if (att.out) {
        workedMinutes = Math.max(0, Math.round((att.out.getTime() - att.in.getTime()) / 60000));
        summary.totalMinutes += workedMinutes;
      }
      if (!shift.off) {
        const [sh, sm] = shift.start.split(":").map(Number);
        const schedStart = new Date(att.in);
        schedStart.setHours(sh, sm, 0, 0);
        if (att.in.getTime() > schedStart.getTime() + LATE_GRACE_MIN * 60000) {
          late = true;
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
      workedMinutes,
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
