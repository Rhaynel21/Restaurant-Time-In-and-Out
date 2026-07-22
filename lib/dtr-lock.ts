import { collection, deleteField, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

// Step 5 of the Klicc Staff Management Flow — "Cutoff & DTR Lock". Once HR has
// resolved every attendance exception for a branch's pay period, the period is
// LOCKED: attendance freezes and a compliant DTR is produced. Payroll (Step 6)
// computes only on locked periods, so figures can't shift under a released run.
//
// A lock is keyed by branch + period. `period` is the cutoff id — here a month
// "YYYY-MM" (Qui's DTR/attendance are month-based); the shape allows semi-monthly
// ("YYYY-MM-H1"/"-H2") later without a migration.

const COLL = "dtr_locks";

export type DtrLock = {
  branchId: string;
  period: string; // "YYYY-MM"
  locked: boolean;
  lockedBy: string | null;
  note: string; // exception-resolution note captured at lock time
};

export const dtrLockId = (branchId: string, period: string) => `${branchId}_${period}`;

function fromDoc(id: string, data: Record<string, unknown>): DtrLock {
  const sep = id.indexOf("_");
  return {
    branchId: typeof data.branchId === "string" ? data.branchId : id.slice(0, sep),
    period: typeof data.period === "string" ? data.period : id.slice(sep + 1),
    locked: data.locked === true,
    lockedBy: typeof data.lockedBy === "string" ? data.lockedBy : null,
    note: typeof data.note === "string" ? data.note : "",
  };
}

// Real-time locks. The collection is low-cardinality (one doc per branch·period),
// so we read it whole and let callers filter by branch/period in memory.
export function subscribeDtrLocks(onChange: (locks: DtrLock[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    collection(db, COLL),
    (snap) => onChange(snap.docs.map((d) => fromDoc(d.id, d.data() as Record<string, unknown>)).filter((l) => l.locked)),
    (e) => onError?.(e as Error),
  );
}

export function isPeriodLocked(locks: DtrLock[], branchId: string | null | undefined, period: string): boolean {
  if (!branchId) return false;
  return locks.some((l) => l.branchId === branchId && l.period === period && l.locked);
}

export function lockFor(locks: DtrLock[], branchId: string | null | undefined, period: string): DtrLock | null {
  if (!branchId) return null;
  return locks.find((l) => l.branchId === branchId && l.period === period) ?? null;
}

export async function lockPeriod(branchId: string, period: string, lockedBy: string, note: string) {
  await setDoc(
    doc(db, COLL, dtrLockId(branchId, period)),
    { branchId, period, locked: true, lockedBy, note, lockedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function unlockPeriod(branchId: string, period: string, unlockedBy: string) {
  await setDoc(
    doc(db, COLL, dtrLockId(branchId, period)),
    { branchId, period, locked: false, unlockedBy, unlockedAt: serverTimestamp(), lockedBy: deleteField() },
    { merge: true },
  );
}
