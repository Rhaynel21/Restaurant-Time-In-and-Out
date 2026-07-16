import { LeaveRequest } from "@/lib/leaves";

// DOLE Service Incentive Leave (SIL): an employee who has rendered at least one
// year of service is entitled to 5 days of paid leave per year. SIL is consumed
// by any PAID leave taken (vacation / sick / emergency — not unpaid); the unused
// balance is convertible to cash (typically at year-end or on separation).
//
// ⚠️  Simplified accrual for computation — company policy may grant more (e.g.
// separate VL/SL). Verify against your CBA / handbook.

export const SIL_ANNUAL_DAYS = 5;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Fractional years of service as of a date (0 if no/'future' hire date).
export function tenureYears(hireDate: string | null, asOf: Date = new Date()): number {
  if (!hireDate) return 0;
  const [y, m, d] = hireDate.split("-").map(Number);
  if (!y) return 0;
  const start = new Date(y, (m || 1) - 1, d || 1).getTime();
  const ms = asOf.getTime() - start;
  return ms <= 0 ? 0 : ms / (365.25 * 86400000);
}

// SIL entitlement earned WITHIN a calendar year. None in the first year of
// service; a full 5 days once the 1-year mark predates the year; prorated in the
// year the employee crosses one year of tenure.
export function silEntitlement(hireDate: string | null, year: number): number {
  if (!hireDate) return 0;
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  if (!hy) return 0;
  const entitledFrom = new Date(hy + 1, (hm || 1) - 1, hd || 1); // 1st anniversary
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  if (entitledFrom > yearEnd) return 0; // not yet entitled this year
  if (entitledFrom <= yearStart) return SIL_ANNUAL_DAYS; // entitled all year
  const daysEntitled = (yearEnd.getTime() - entitledFrom.getTime()) / 86400000 + 1;
  return round2((SIL_ANNUAL_DAYS * daysEntitled) / 365);
}

// Paid leave days an employee used in a year (approved, non-unpaid).
export function silUsedDays(leaves: LeaveRequest[], employeeId: string, year: number): number {
  return leaves
    .filter(
      (l) =>
        l.employeeId === employeeId &&
        l.status === "approved" &&
        l.type !== "unpaid" &&
        Number(l.startDate.slice(0, 4)) === year,
    )
    .reduce((s, l) => s + (l.days || 0), 0);
}

export type SilBalance = { entitled: number; used: number; remaining: number };

export function silBalance(
  hireDate: string | null,
  leaves: LeaveRequest[],
  employeeId: string,
  year: number,
): SilBalance {
  const entitled = silEntitlement(hireDate, year);
  const used = silUsedDays(leaves, employeeId, year);
  return { entitled, used, remaining: Math.max(0, round2(entitled - used)) };
}
