import { Timestamp, addDoc, collection, getDocs, limit, onSnapshot, query, serverTimestamp, where, writeBatch } from "firebase/firestore";

import { db } from "@/lib/firebase";

// In-app notifications, targeted to one employee. Written when something the
// employee cares about happens (leave / OT request approved or rejected).
// notify() is fire-and-forget so it never blocks the triggering action.

export type NotifKind = "success" | "info" | "warning";

export type AppNotification = {
  id: string;
  toEmployeeId: string;
  title: string;
  body: string;
  kind: NotifKind;
  read: boolean;
  createdAt: Date | null;
};

function tsToDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v && typeof v === "object" && "seconds" in v) return new Timestamp((v as { seconds: number }).seconds, 0).toDate();
  return null;
}

export function notify(toEmployeeId: string, title: string, body: string, kind: NotifKind = "info"): void {
  if (!toEmployeeId) return;
  addDoc(collection(db, "notifications"), {
    toEmployeeId,
    title,
    body,
    kind,
    read: false,
    createdAt: serverTimestamp(),
  }).catch(() => {
    /* best-effort */
  });
}

export function subscribeMyNotifications(
  employeeId: string,
  onChange: (n: AppNotification[]) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    query(collection(db, "notifications"), where("toEmployeeId", "==", employeeId), limit(50)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          toEmployeeId: typeof x.toEmployeeId === "string" ? x.toEmployeeId : "",
          title: typeof x.title === "string" ? x.title : "",
          body: typeof x.body === "string" ? x.body : "",
          kind: (["success", "info", "warning"].includes(x.kind as string) ? x.kind : "info") as NotifKind,
          read: x.read === true,
          createdAt: tsToDate(x.createdAt),
        } as AppNotification;
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}

export async function markAllRead(employeeId: string): Promise<void> {
  const snap = await getDocs(
    query(collection(db, "notifications"), where("toEmployeeId", "==", employeeId), where("read", "==", false), limit(100)),
  );
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
}
