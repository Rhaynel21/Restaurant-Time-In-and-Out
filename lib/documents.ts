import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, storage } from "@/lib/firebase";

// Employee 201 documents. The file bytes live in Firebase Storage under
// `employee-docs/{employeeId}/…`; a metadata row in the `employeeDocuments`
// Firestore collection makes them listable + real-time in the portal.

export type EmployeeDocument = {
  id: string;
  employeeId: string;
  name: string;
  size: number;
  contentType: string;
  url: string;
  storagePath: string;
  uploadedAt: Date | null;
  uploadedBy: string;
};

function tsToDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

// Real-time list of one employee's documents (newest first).
export function subscribeEmployeeDocuments(
  employeeId: string,
  onChange: (docs: EmployeeDocument[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "employeeDocuments"), where("employeeId", "==", employeeId));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          employeeId: typeof data.employeeId === "string" ? data.employeeId : employeeId,
          name: typeof data.name === "string" ? data.name : "Document",
          size: typeof data.size === "number" ? data.size : 0,
          contentType: typeof data.contentType === "string" ? data.contentType : "",
          url: typeof data.url === "string" ? data.url : "",
          storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
          uploadedAt: tsToDate(data.uploadedAt),
          uploadedBy: typeof data.uploadedBy === "string" ? data.uploadedBy : "",
        } as EmployeeDocument;
      });
      items.sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
      onChange(items);
    },
    (error) => onError?.(error as Error),
  );
}

// Sanitize a filename for a Storage path while keeping it recognizable.
function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120);
}

// Upload a file to Storage and record its metadata. `stamp` is a caller-supplied
// millisecond timestamp (Date.now() is unavailable inside workflow scripts, but
// components can pass it) used to keep the storage path unique.
export async function uploadEmployeeDocument(
  employeeId: string,
  file: File,
  uploadedBy: string,
  stamp: number,
): Promise<void> {
  const storagePath = `employee-docs/${employeeId}/${stamp}-${safeName(file.name)}`;
  const objectRef = ref(storage, storagePath);
  await uploadBytes(objectRef, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(objectRef);
  await addDoc(collection(db, "employeeDocuments"), {
    employeeId,
    name: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    url,
    storagePath,
    uploadedBy,
    uploadedAt: serverTimestamp(),
  });
}

// Remove both the Storage object and its metadata row. A missing Storage object
// (e.g. already gone) is ignored so the row can still be cleaned up.
export async function deleteEmployeeDocument(docId: string, storagePath: string): Promise<void> {
  if (storagePath) {
    try {
      await deleteObject(ref(storage, storagePath));
    } catch {
      // object may already be gone — proceed to remove the metadata
    }
  }
  await deleteDoc(doc(db, "employeeDocuments", docId));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
