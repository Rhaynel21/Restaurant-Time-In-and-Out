// Employee loans / amortizing deductions. Stored as an array on the employee's
// master doc (companies-doc pattern — no extra Firestore rule needed). The
// running balance is DERIVED from the start month + amortization, so a payroll
// re-run can never double-deduct: the deduction for a given month is
// deterministic, and the loan simply stops once fully paid.

export type LoanType = "sss" | "pagibig" | "company" | "cash-advance";

export type Loan = {
  type: LoanType;
  label: string;
  principal: number;
  monthlyAmortization: number;
  startMonth: string; // YYYY-MM of the first deduction
};

export const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: "sss", label: "SSS Loan" },
  { value: "pagibig", label: "Pag-IBIG Loan" },
  { value: "company", label: "Company Loan" },
  { value: "cash-advance", label: "Cash Advance" },
];

function monthsFromStart(startMonth: string, ym: string): number {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [y, m] = ym.split("-").map(Number);
  if (!sy || !y) return -1;
  return (y - sy) * 12 + (m - sm);
}

// Amount to deduct for a loan in a given YYYY-MM (0 before it starts / once paid).
export function loanDeductionForMonth(loan: Loan, ym: string): number {
  const n = monthsFromStart(loan.startMonth, ym);
  if (n < 0) return 0;
  const remainingBefore = loan.principal - loan.monthlyAmortization * n;
  if (remainingBefore <= 0) return 0;
  return Math.round(Math.min(loan.monthlyAmortization, remainingBefore) * 100) / 100;
}

// Outstanding balance AFTER the given month's deduction.
export function loanBalanceAfter(loan: Loan, ym: string): number {
  const n = monthsFromStart(loan.startMonth, ym);
  const paidThrough = Math.max(0, n) + (n >= 0 ? 1 : 0);
  return Math.max(0, Math.round((loan.principal - loan.monthlyAmortization * paidThrough) * 100) / 100);
}

export function loanTypeLabel(t: LoanType): string {
  return LOAN_TYPES.find((x) => x.value === t)?.label ?? "Loan";
}

// Coerce raw Firestore data into a clean Loan[].
export function coerceLoans(value: unknown): Loan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const type = (["sss", "pagibig", "company", "cash-advance"].includes(d.type as string) ? d.type : "company") as LoanType;
      return {
        type,
        label: typeof d.label === "string" && d.label ? d.label : loanTypeLabel(type),
        principal: typeof d.principal === "number" ? d.principal : 0,
        monthlyAmortization: typeof d.monthlyAmortization === "number" ? d.monthlyAmortization : 0,
        startMonth: typeof d.startMonth === "string" ? d.startMonth : "",
      } as Loan;
    })
    .filter((l) => l.monthlyAmortization > 0 && /^\d{4}-\d{2}$/.test(l.startMonth));
}
