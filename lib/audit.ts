import { Timestamp, addDoc, collection, limit, onSnapshot, query, serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";

// Lightweight audit trail. Every sensitive mutation (salary/record edits,
// payroll-formula changes, leave/OT approvals) records who did what, when.
// Writes are FIRE-AND-FORGET and swallow errors, so logging can never break the
// underlying action (or block it if the auditLog rule isn't deployed yet).

export type AuditEntry = {
  id: string;
  action: string; // e.g. "save", "delete", "approve"
  entity: string; // e.g. "employee", "payroll", "leave", "request"
  entityId: string;
  summary: string; // human-readable
  actor: string; // who did it
  at: Date | null;
};

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function tsToDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v && typeof v === "object" && "seconds" in v) return new Timestamp((v as { seconds: number }).seconds, 0).toDate();
  return null;
}

export function logAudit(action: string, entity: string, entityId: string, summary: string, actor: string): void {
  addDoc(collection(db, "auditLog"), {
    action,
    entity,
    entityId,
    summary,
    actor: actor || "System",
    at: serverTimestamp(),
  }).catch(() => {
    /* best-effort — never surface audit failures */
  });
}

export function subscribeAuditLog(onChange: (entries: AuditEntry[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "auditLog"), limit(300)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          action: s(x.action),
          entity: s(x.entity),
          entityId: s(x.entityId),
          summary: s(x.summary),
          actor: s(x.actor),
          at: tsToDate(x.at),
        } as AuditEntry;
      });
      items.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}
