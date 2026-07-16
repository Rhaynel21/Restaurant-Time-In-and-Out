import {
  User,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { Platform } from "react-native";
import { doc, getDoc, getDocs, collection, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";

import { EmployeeProfile } from "@/lib/attendance";
import { auth, db } from "@/lib/firebase";

export type AccessRole = "owner" | "staff" | "manager" | "areaManager" | "hr" | "admin";

export const AUTH_ERRORS = {
  NOT_FOUND: "AUTH_NOT_FOUND",
  WRONG_PASSWORD: "AUTH_WRONG_PASSWORD",
  EXISTS: "AUTH_EXISTS",
  OFFLINE: "AUTH_OFFLINE",
  WEAK_PASSWORD: "AUTH_WEAK_PASSWORD",
} as const;

function normalizeId(input: string) {
  return input.trim().toUpperCase();
}

function deriveNames(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] ?? fullName.trim(), lastName: parts.slice(1).join(" ") || "" };
}

type EmployeeDoc = Partial<EmployeeProfile> & { uid?: string };

function toProfile(employeeId: string, data: EmployeeDoc): EmployeeProfile {
  return {
    employeeId,
    firstName: data.firstName ?? "",
    lastName: data.lastName ?? "",
    fullName: data.fullName || `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || employeeId,
    email: data.email ?? "",
    phone: data.phone ?? "",
    role: data.role ?? "Staff",
    companyId: data.companyId ?? null,
    brandId: data.brandId ?? null,
    branchId: data.branchId ?? null,
    branchIds: Array.isArray(data.branchIds) ? data.branchIds.filter((x): x is string => typeof x === "string") : [],
    branchName: data.branchName ?? null,
    accessRole: (data.accessRole as AccessRole) ?? "staff",
  };
}

// Map Firebase Auth error codes to our friendly error constants.
function mapAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") return AUTH_ERRORS.WRONG_PASSWORD;
  if (code === "auth/user-not-found" || code === "auth/invalid-email") return AUTH_ERRORS.NOT_FOUND;
  if (code === "auth/email-already-in-use") return AUTH_ERRORS.EXISTS;
  if (code === "auth/weak-password") return AUTH_ERRORS.WEAK_PASSWORD;
  if (code === "auth/network-request-failed") return AUTH_ERRORS.OFFLINE;
  return AUTH_ERRORS.OFFLINE;
}

// Resolve an Employee ID to its email (Firebase Auth signs in by email only).
async function resolveEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();

  const snap = await getDoc(doc(db, "employees", normalizeId(trimmed)));
  const email = snap.exists() ? (snap.data() as EmployeeDoc).email : null;
  if (!email) throw new Error(AUTH_ERRORS.NOT_FOUND);
  return email.toLowerCase();
}

// Load the employees profile doc that matches a signed-in Firebase user (by email).
async function loadProfileForUser(user: User): Promise<EmployeeProfile | null> {
  const email = (user.email ?? "").toLowerCase();
  if (!email) return null;
  const snap = await getDocs(query(collection(db, "employees"), where("email", "==", email), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toProfile(d.id, d.data() as EmployeeDoc);
}

// Web: honor a "remember me" choice via persistence. Native always persists
// (AsyncStorage), so this is a no-op there.
async function applyWebPersistence(remember: boolean) {
  if (Platform.OS !== "web") return;
  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  } catch {
    // ignore
  }
}

export async function signIn(
  identifier: string,
  password: string,
  remember = true,
): Promise<EmployeeProfile> {
  await applyWebPersistence(remember);

  let email: string;
  try {
    email = await resolveEmail(identifier);
  } catch (e) {
    if (e instanceof Error && e.message === AUTH_ERRORS.NOT_FOUND) throw e;
    throw new Error(AUTH_ERRORS.OFFLINE);
  }

  let user: User;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    user = cred.user;
  } catch (e) {
    throw new Error(mapAuthError(e));
  }

  const profile = await loadProfileForUser(user);
  if (!profile) throw new Error(AUTH_ERRORS.NOT_FOUND);
  return profile;
}

// Staff self-registration: creates the Firebase Auth user + the employees
// profile doc (accessRole "staff"). Managers/admins are provisioned by the seed
// script and never self-granted.
export async function signUp(input: {
  employeeId: string;
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  position?: string;
  branchId?: string | null;
  branchName?: string | null;
}): Promise<EmployeeProfile> {
  const employeeId = normalizeId(input.employeeId);
  const email = input.email.trim().toLowerCase();

  // Reject duplicate Employee IDs up front (Auth guards duplicate emails).
  try {
    const existing = await getDoc(doc(db, "employees", employeeId));
    if (existing.exists()) throw new Error(AUTH_ERRORS.EXISTS);
  } catch (e) {
    if (e instanceof Error && e.message === AUTH_ERRORS.EXISTS) throw e;
    throw new Error(AUTH_ERRORS.OFFLINE);
  }

  let user: User;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, input.password);
    user = cred.user;
  } catch (e) {
    throw new Error(mapAuthError(e));
  }

  const { firstName, lastName } = deriveNames(input.fullName);
  const profile: EmployeeProfile = {
    employeeId,
    firstName,
    lastName,
    fullName: input.fullName.trim(),
    email,
    phone: input.phone?.trim() ?? "",
    role: input.position?.trim() || "Staff",
    companyId: null,
    brandId: null,
    branchId: input.branchId ?? null,
    branchIds: [],
    branchName: input.branchName ?? null,
    accessRole: "staff",
  };

  await setDoc(doc(db, "employees", employeeId), {
    ...profile,
    uid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return profile;
}

// Subscribe to auth state. Fires with the resolved profile (or null when signed
// out / no profile doc). Returns an unsubscribe function.
export function onAuthChange(callback: (profile: EmployeeProfile | null) => void) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }
    try {
      callback(await loadProfileForUser(user));
    } catch {
      callback(null);
    }
  });
}

export async function signOutUser() {
  await signOut(auth);
}
