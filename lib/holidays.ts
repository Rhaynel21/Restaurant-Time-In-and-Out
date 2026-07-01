// Philippine public holidays, keyed by YYYY-MM-DD. Used to mark non-working days
// on the attendance calendar so an "absent" cell on a holiday isn't penalised.
//
// Dates follow the official Malacañang proclamations. Movable feasts (Holy Week,
// Eid'l Fitr, Eid'l Adha) shift yearly and are proclaimed ~a year ahead — update
// the table when the new proclamation comes out. To add a year, append its block.

export type HolidayType = "regular" | "special";

export type Holiday = {
  date: string; // YYYY-MM-DD
  name: string;
  type: HolidayType; // "regular" (paid 200%) vs "special" non-working (no-work-no-pay)
};

// ── Holiday table ────────────────────────────────────────────────────────────
// Sourced from the annual Philippine holiday proclamations. Islamic holidays are
// approximate (subject to moon sighting / later proclamation).
const HOLIDAYS: Holiday[] = [
  // ===== 2026 =====
  { date: "2026-01-01", name: "New Year's Day", type: "regular" },
  { date: "2026-02-17", name: "Chinese New Year", type: "special" },
  { date: "2026-02-25", name: "EDSA People Power Anniversary", type: "special" },
  { date: "2026-04-02", name: "Maundy Thursday", type: "regular" },
  { date: "2026-04-03", name: "Good Friday", type: "regular" },
  { date: "2026-04-04", name: "Black Saturday", type: "special" },
  { date: "2026-04-09", name: "Araw ng Kagitingan", type: "regular" },
  { date: "2026-05-01", name: "Labor Day", type: "regular" },
  { date: "2026-06-12", name: "Independence Day", type: "regular" },
  { date: "2026-08-21", name: "Ninoy Aquino Day", type: "special" },
  { date: "2026-08-31", name: "National Heroes Day", type: "regular" },
  { date: "2026-11-01", name: "All Saints' Day", type: "special" },
  { date: "2026-11-30", name: "Bonifacio Day", type: "regular" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception", type: "special" },
  { date: "2026-12-24", name: "Christmas Eve", type: "special" },
  { date: "2026-12-25", name: "Christmas Day", type: "regular" },
  { date: "2026-12-30", name: "Rizal Day", type: "regular" },
  { date: "2026-12-31", name: "Last Day of the Year", type: "special" },

  // ===== 2025 (kept for viewing past months) =====
  { date: "2025-01-01", name: "New Year's Day", type: "regular" },
  { date: "2025-01-29", name: "Chinese New Year", type: "special" },
  { date: "2025-04-09", name: "Araw ng Kagitingan", type: "regular" },
  { date: "2025-04-17", name: "Maundy Thursday", type: "regular" },
  { date: "2025-04-18", name: "Good Friday", type: "regular" },
  { date: "2025-04-19", name: "Black Saturday", type: "special" },
  { date: "2025-05-01", name: "Labor Day", type: "regular" },
  { date: "2025-06-12", name: "Independence Day", type: "regular" },
  { date: "2025-08-25", name: "National Heroes Day", type: "regular" },
  { date: "2025-11-01", name: "All Saints' Day", type: "special" },
  { date: "2025-11-30", name: "Bonifacio Day", type: "regular" },
  { date: "2025-12-08", name: "Feast of the Immaculate Conception", type: "special" },
  { date: "2025-12-25", name: "Christmas Day", type: "regular" },
  { date: "2025-12-30", name: "Rizal Day", type: "regular" },
];

// Fast lookup by date string.
const BY_DATE = new Map<string, Holiday>(HOLIDAYS.map((h) => [h.date, h]));

// The holiday on a given YYYY-MM-DD, or null if it's an ordinary day.
export function getHoliday(ymd: string): Holiday | null {
  return BY_DATE.get(ymd) ?? null;
}

export function isHoliday(ymd: string): boolean {
  return BY_DATE.has(ymd);
}

// All holidays in a given month (month is 0-indexed, matching JS Date).
export function holidaysInMonth(year: number, month: number): Holiday[] {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  return HOLIDAYS.filter((h) => h.date.startsWith(prefix)).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

// Display colour for each holiday type (violet = regular, amber = special).
export function holidayColor(type: HolidayType): string {
  return type === "regular" ? "#7C3AED" : "#D97706";
}
