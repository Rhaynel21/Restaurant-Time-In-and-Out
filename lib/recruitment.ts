import {
  Timestamp,
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

// Recruitment / Applicant Tracking. Two collections:
//   jobPosts  — openings to fill
//   applicants — people applying, moving through a hiring pipeline.

export type JobStatus = "open" | "closed";
export type ApplicantStage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

export const STAGES: { key: ApplicantStage; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
];

export type JobPost = {
  id: string;
  title: string;
  department: string;
  branchName: string;
  description: string;
  openings: number;
  status: JobStatus;
  createdAt: Date | null;
};

export type Applicant = {
  id: string;
  jobPostId: string;
  jobTitle: string;
  name: string;
  email: string;
  phone: string;
  stage: ApplicantStage;
  notes: string;
  createdAt: Date | null;
};

function tsToDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v && typeof v === "object" && "seconds" in v) return new Timestamp((v as { seconds: number }).seconds, 0).toDate();
  return null;
}
function s(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

// ── Job posts ────────────────────────────────────────────────────────────────
export async function createJobPost(data: { title: string; department: string; branchName: string; description: string; openings: number }) {
  await addDoc(collection(db, "jobPosts"), {
    ...data,
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function setJobStatus(id: string, status: JobStatus) {
  await updateDoc(doc(db, "jobPosts", id), { status, updatedAt: serverTimestamp() });
}

export function subscribeJobPosts(onChange: (posts: JobPost[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "jobPosts"), limit(200)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: s(x.title),
          department: s(x.department),
          branchName: s(x.branchName),
          description: s(x.description),
          openings: typeof x.openings === "number" ? x.openings : 1,
          status: x.status === "closed" ? "closed" : "open",
          createdAt: tsToDate(x.createdAt),
        } as JobPost;
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}

// ── Applicants ───────────────────────────────────────────────────────────────
export async function createApplicant(data: { jobPostId: string; jobTitle: string; name: string; email: string; phone: string; notes: string }) {
  await addDoc(collection(db, "applicants"), {
    ...data,
    stage: "applied",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function setApplicantStage(id: string, stage: ApplicantStage) {
  await updateDoc(doc(db, "applicants", id), { stage, updatedAt: serverTimestamp() });
}

export function subscribeApplicants(onChange: (a: Applicant[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "applicants"), limit(500)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          jobPostId: s(x.jobPostId),
          jobTitle: s(x.jobTitle),
          name: s(x.name, "Applicant"),
          email: s(x.email),
          phone: s(x.phone),
          stage: (STAGES.some((st) => st.key === x.stage) ? x.stage : "applied") as ApplicantStage,
          notes: s(x.notes),
          createdAt: tsToDate(x.createdAt),
        } as Applicant;
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      onChange(items);
    },
    (e) => onError?.(e as Error),
  );
}
