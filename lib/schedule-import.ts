// Bulk schedule import from an Excel/CSV workbook (web only).
//
// Expected sheet layout — one row per employee, a header row on top:
//
//   Employee ID | Name        | Sun  | Mon         | ... | Sat
//   EMP-001     | Maria Santos| OFF  | 09:00-18:00 | ... | 09:00-18:00
//
// Each weekday cell is either a rest marker ("OFF", "REST", "-", blank) or a
// time range ("09:00-18:00", "9:00 AM - 6:00 PM"). The parsed weekly grid maps
// onto Schedule.weekly (index 0 = Sunday … 6 = Saturday).

import type { Shift, ShiftBlock } from "@/lib/schedules";
import { WEEKDAY_LABELS, WEEKDAY_SHORT, formatShift, makeShift, shiftBlocks } from "@/lib/schedules";

export type ImportRow = {
  employeeId: string | null;
  employeeName: string | null;
  weekly: Shift[];
  breakStart: string | null;
  breakEnd: string | null;
};

const REST_TOKENS = ["", "off", "rest", "rest day", "restday", "-", "–", "—", "x", "n/a", "na", "day off", "dayoff"];

// "9", "9:00", "9:00 am", "6pm", "18:00" → "HH:MM" (24h). Best-effort, never throws.
function normalizeTime(raw: string): string {
  let str = String(raw).trim().toLowerCase();
  const ampm = /(am|pm)/.exec(str)?.[1];
  str = str.replace(/am|pm/g, "").trim();
  const [hPart, mPart] = str.split(":");
  let hh = parseInt(hPart, 10);
  if (Number.isNaN(hh)) hh = 0;
  let mm = mPart != null ? parseInt(mPart, 10) : 0;
  if (Number.isNaN(mm)) mm = 0;
  if (ampm === "pm" && hh < 12) hh += 12;
  if (ampm === "am" && hh === 12) hh = 0;
  hh = Math.max(0, Math.min(23, hh));
  mm = Math.max(0, Math.min(59, mm));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Turn one spreadsheet cell into a Shift. Supports split shifts: multiple ranges
// separated by comma / "&" / "+" / ";" (e.g. "09:00-14:00, 17:00-21:00").
export function parseShiftCell(raw: unknown): Shift {
  const s = String(raw ?? "").trim().toLowerCase();
  if (REST_TOKENS.includes(s)) return { off: true, start: "09:00", end: "18:00" };
  const blocks: ShiftBlock[] = [];
  for (const range of s.split(/\s*(?:,|&|\+|;)\s*/).filter(Boolean)) {
    const parts = range.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
    if (parts.length >= 2) blocks.push({ start: normalizeTime(parts[0]), end: normalizeTime(parts[1]) });
  }
  // No parseable range → treat as a rest day rather than guess.
  if (blocks.length === 0) return { off: true, start: "09:00", end: "18:00" };
  return makeShift(false, blocks);
}

// Parse the meal-break cell ("12:00-13:00", "none", blank) into a window or null.
function parseBreakCell(raw: unknown): { breakStart: string | null; breakEnd: string | null } {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || ["none", "no break", "off", "-", "x", "n/a", "na"].includes(s)) {
    return { breakStart: null, breakEnd: null };
  }
  const parts = s.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  if (parts.length >= 2) return { breakStart: normalizeTime(parts[0]), breakEnd: normalizeTime(parts[1]) };
  return { breakStart: null, breakEnd: null };
}

function matchColumn(headers: string[], test: RegExp): number {
  return headers.findIndex((h) => test.test(h));
}

// Parse a workbook ArrayBuffer into per-employee weekly schedules.
export async function parseScheduleWorkbook(data: ArrayBuffer): Promise<ImportRow[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const grid: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (grid.length < 2) return [];

  const headers = grid[0].map((h) => String(h ?? "").trim());
  const lower = headers.map((h) => h.toLowerCase());

  const idCol = matchColumn(lower, /employee\s*id|emp\s*id|^id$|^employeeid$/);
  const nameCol = matchColumn(lower, /^name$|full\s*name|employee\s*name/);
  const breakCol = matchColumn(lower, /break/);
  const dayCols = WEEKDAY_SHORT.map((short, d) =>
    lower.findIndex((h) => h === short.toLowerCase() || h === WEEKDAY_LABELS[d].toLowerCase() || h.startsWith(short.toLowerCase())),
  );

  const rows: ImportRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const employeeId = idCol >= 0 ? String(cells[idCol] ?? "").trim() || null : null;
    const employeeName = nameCol >= 0 ? String(cells[nameCol] ?? "").trim() || null : null;
    if (!employeeId && !employeeName) continue; // skip blank rows

    const weekly = dayCols.map((col) =>
      col >= 0 ? parseShiftCell(cells[col]) : ({ off: true, start: "09:00", end: "18:00" } as Shift),
    );
    const { breakStart, breakEnd } = breakCol >= 0 ? parseBreakCell(cells[breakCol]) : { breakStart: null, breakEnd: null };
    rows.push({ employeeId, employeeName, weekly, breakStart, breakEnd });
  }
  return rows;
}

// Export employee schedules to an .xlsx in the same layout the upload expects,
// so a downloaded file round-trips straight back through "Upload Schedule".
// Rows without a saved `weekly` fall back to a sensible Mon–Sat default.
export async function downloadSchedules(
  employees: { employeeId: string; fullName: string; weekly?: Shift[]; breakStart?: string | null; breakEnd?: string | null }[],
  filename = "schedules.xlsx",
) {
  const XLSX = await import("xlsx");
  const header = ["Employee ID", "Name", ...WEEKDAY_SHORT, "Break"];
  const body = employees.map((e) => {
    const weekly = e.weekly ?? WEEKDAY_LABELS.map((_, d) => ({ off: d === 0, start: "09:00", end: "18:00" }));
    const brk = e.breakStart && e.breakEnd ? `${e.breakStart}-${e.breakEnd}` : "none";
    return [
      e.employeeId,
      e.fullName,
      ...weekly.map((s) => (s.off ? "OFF" : shiftBlocks(s).map((b) => `${b.start}-${b.end}`).join(", "))),
      brk,
    ];
  });
  // Fallback example row when the roster is empty, so the file still shows the format.
  if (body.length === 0) {
    body.push(["EMP-001", "Juan Dela Cruz", "OFF", "09:00-18:00", "09:00-18:00", "09:00-18:00", "09:00-18:00", "09:00-18:00", "09:00-18:00", "12:00-13:00"]);
  }
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedules");
  XLSX.writeFile(wb, filename);
}

// Human-readable one-line preview of a parsed row's week.
export function summarizeWeekly(weekly: Shift[]): string {
  return weekly.map((s, d) => `${WEEKDAY_SHORT[d]} ${s.off ? "Rest" : formatShift(s)}`).join(" · ");
}
