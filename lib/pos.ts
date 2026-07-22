import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";

import { db } from "@/lib/firebase";

// POS revenue + service-charge feed from Phase 1 (Klicc POS, project
// restaurant-management-96e52). The two systems are SEPARATE Firebase projects,
// so Qui never reads Phase 1 directly from the client. Instead a server-side
// consumer (a Qui Cloud Function) calls Phase 1's read API…
//
//     GET /api/v2/daily-summary?branchId={posBranchId}&from=YYYY-MM-DD&to=YYYY-MM-DD
//         → [{ businessDate, grossSales, netSales, serviceCharge }]
//         Authorization: Bearer <service key>   (secret stays server-side)
//
// …maps each row to the Qui branch by `posBranchId`, and caches it here as
// `pos_daily/{branchId}_{date}`. This module is what the admin portal reads.
//
// `source: "manual"` rows are HR-entered fallbacks so the Labor Cost Ratio and
// service-charge pool still work for branches not yet wired to the POS API.
//
// NOTE: this feed carries the service-charge POOL total only. How that pool is
// split per employee (ISS-01 / ISS-02) is BLOCKED pending PM sign-off — do not
// distribute it here.

const COLL = "pos_daily";

export type PosDaily = {
  branchId: string;
  date: string; // YYYY-MM-DD business date
  grossSales: number;
  netSales: number;
  serviceChargePool: number;
  source: "api" | "manual";
};

export const posDailyId = (branchId: string, date: string) => `${branchId}_${date}`;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fromDoc(id: string, data: Record<string, unknown>): PosDaily {
  return {
    branchId: typeof data.branchId === "string" ? data.branchId : id.split("_")[0] ?? "",
    date: typeof data.date === "string" ? data.date : id.slice(id.indexOf("_") + 1),
    grossSales: num(data.grossSales),
    netSales: num(data.netSales),
    serviceChargePool: num(data.serviceChargePool),
    source: data.source === "manual" ? "manual" : "api",
  };
}

// Real-time pos_daily for a set of branches over a date range (inclusive).
export function subscribePosDaily(
  branchIds: string[],
  from: string,
  to: string,
  onChange: (rows: PosDaily[]) => void,
  onError?: (e: Error) => void,
) {
  if (branchIds.length === 0) {
    onChange([]);
    return () => {};
  }
  // Firestore `in` caps at 30 values — chunk the branch list.
  const chunks: string[][] = [];
  for (let i = 0; i < branchIds.length; i += 30) chunks.push(branchIds.slice(i, i + 30));
  const byChunk: PosDaily[][] = chunks.map(() => []);
  const emit = () =>
    onChange(byChunk.flat().filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date)));

  const unsubs = chunks.map((chunk, i) =>
    onSnapshot(
      query(collection(db, COLL), where("branchId", "in", chunk)),
      (snap) => {
        byChunk[i] = snap.docs.map((d) => fromDoc(d.id, d.data() as Record<string, unknown>));
        emit();
      },
      (e) => onError?.(e as Error),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

// One-shot read for a single branch + range (used by monthly aggregates).
export async function getPosDaily(branchId: string, from: string, to: string): Promise<PosDaily[]> {
  const snap = await getDocs(query(collection(db, COLL), where("branchId", "==", branchId)));
  return snap.docs
    .map((d) => fromDoc(d.id, d.data() as Record<string, unknown>))
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Sum a set of rows into period totals.
export function sumPos(rows: PosDaily[]): { grossSales: number; netSales: number; serviceChargePool: number } {
  return rows.reduce(
    (a, r) => ({
      grossSales: a.grossSales + r.grossSales,
      netSales: a.netSales + r.netSales,
      serviceChargePool: a.serviceChargePool + r.serviceChargePool,
    }),
    { grossSales: 0, netSales: 0, serviceChargePool: 0 },
  );
}

// Manual fallback entry (HR types in a day's revenue when the POS API isn't wired).
export async function savePosDailyManual(
  branchId: string,
  date: string,
  vals: { grossSales: number; netSales: number; serviceChargePool: number },
) {
  await setDoc(
    doc(db, COLL, posDailyId(branchId, date)),
    {
      branchId,
      date,
      grossSales: vals.grossSales,
      netSales: vals.netSales,
      serviceChargePool: vals.serviceChargePool,
      source: "manual",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
