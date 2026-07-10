import { addDoc, collection, limit, onSnapshot, query, serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";

// Simple HR memos: compose → pick recipients → save as draft or send. Stored in
// the `memos` collection; recipients are employee ids + names snapshotted at send.

export type MemoStatus = "draft" | "sent";

export type Memo = {
  id: string;
  subject: string;
  content: string;
  recipientIds: string[];
  recipientNames: string[];
  status: MemoStatus;
  createdBy: string;
  createdAt: Date | null;
};

function tsToDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

export async function createMemo(
  data: { subject: string; content: string; recipientIds: string[]; recipientNames: string[]; status: MemoStatus },
  createdBy: string,
) {
  await addDoc(collection(db, "memos"), {
    subject: data.subject.trim(),
    content: data.content.trim(),
    recipientIds: data.recipientIds,
    recipientNames: data.recipientNames,
    status: data.status,
    createdBy,
    createdAt: serverTimestamp(),
    ...(data.status === "sent" ? { sentAt: serverTimestamp() } : {}),
  });
}

// Recent memos, newest first.
export function subscribeMemos(onChange: (memos: Memo[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "memos"), limit(50)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          subject: typeof data.subject === "string" ? data.subject : "",
          content: typeof data.content === "string" ? data.content : "",
          recipientIds: Array.isArray(data.recipientIds) ? (data.recipientIds as string[]) : [],
          recipientNames: Array.isArray(data.recipientNames) ? (data.recipientNames as string[]) : [],
          status: data.status === "sent" ? "sent" : "draft",
          createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
          createdAt: tsToDate(data.createdAt),
        } as Memo;
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}
