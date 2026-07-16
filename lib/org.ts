import { collection, collectionGroup, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { AccessRole } from "@/lib/auth";
import { BRANCHES } from "@/lib/branches";
import { db } from "@/lib/firebase";

// Multi-tenant org hierarchy: Company → Brand → Branch, stored as NESTED
// subcollections (matching the Klicc admin app):
//   companies/{companyId}
//     └── brands/{brandId}
//           └── branches/{branchId}
//
// Parent ids are derived from each document's path (not denormalized fields), so
// the whole tree is read with two collectionGroup listeners. Branch doc ids match
// the branchId already stamped on attendance/employee docs (e.g. "kio-qc").

export type Company = { id: string; name: string; code: string };
export type Brand = { id: string; name: string; code: string; companyId: string };
export type Branch = { id: string; name: string; code: string; companyId: string; brandId: string; address: string };

export type OrgTree = { companies: Company[]; brands: Brand[]; branches: Branch[] };

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

// ── Nested doc refs ──
const companyRef = (companyId: string) => doc(db, "companies", companyId);
const brandRef = (companyId: string, brandId: string) => doc(db, "companies", companyId, "brands", brandId);
const branchRef = (companyId: string, brandId: string, branchId: string) =>
  doc(db, "companies", companyId, "brands", brandId, "branches", branchId);

// ── Real-time tree: companies + collectionGroup(brands) + collectionGroup(branches) ──
export function subscribeOrgTree(onChange: (tree: OrgTree) => void, onError?: (e: Error) => void) {
  const tree: OrgTree = { companies: [], brands: [], branches: [] };
  const emit = () => onChange({ ...tree });

  const subCompanies = onSnapshot(
    collection(db, "companies"),
    (snap) => {
      tree.companies = snap.docs
        .map((d) => ({ id: d.id, name: str(d.data().name, d.id), code: str(d.data().code) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      emit();
    },
    (e) => onError?.(e as Error),
  );
  const subBrands = onSnapshot(
    collectionGroup(db, "brands"),
    (snap) => {
      tree.brands = snap.docs
        .map((d) => ({
          id: d.id,
          name: str(d.data().name, d.id),
          code: str(d.data().code),
          companyId: d.ref.parent.parent?.id ?? "", // …/companies/{companyId}/brands/{id}
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      emit();
    },
    (e) => onError?.(e as Error),
  );
  const subBranches = onSnapshot(
    collectionGroup(db, "branches"),
    (snap) => {
      tree.branches = snap.docs
        .map((d) => ({
          id: d.id,
          name: str(d.data().name, d.id),
          code: str(d.data().code),
          address: str(d.data().address),
          brandId: d.ref.parent.parent?.id ?? "", // …/brands/{brandId}/branches/{id}
          companyId: d.ref.parent.parent?.parent.parent?.id ?? "", // …/companies/{companyId}/…
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      emit();
    },
    (e) => onError?.(e as Error),
  );

  return () => {
    subCompanies();
    subBrands();
    subBranches();
  };
}

// ── CRUD (writes go to the nested path) ──
export async function saveCompany(c: Company) {
  await setDoc(companyRef(c.id), { name: c.name, code: c.code, updatedAt: serverTimestamp() }, { merge: true });
}
export async function saveBrand(b: Brand) {
  await setDoc(brandRef(b.companyId, b.id), { name: b.name, code: b.code, updatedAt: serverTimestamp() }, { merge: true });
}
export async function saveBranch(b: Branch) {
  await setDoc(
    branchRef(b.companyId, b.brandId, b.id),
    { name: b.name, code: b.code, address: b.address, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// Deletes cascade to children (Firestore doesn't do this automatically).
export async function deleteBranch(companyId: string, brandId: string, branchId: string) {
  await deleteDoc(branchRef(companyId, brandId, branchId));
}
export async function deleteBrand(companyId: string, brandId: string) {
  const branches = await getDocs(collection(db, "companies", companyId, "brands", brandId, "branches"));
  await Promise.all(branches.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(brandRef(companyId, brandId));
}
export async function deleteCompany(companyId: string) {
  const brands = await getDocs(collection(db, "companies", companyId, "brands"));
  for (const brand of brands.docs) await deleteBrand(companyId, brand.id);
  await deleteDoc(companyRef(companyId));
}

// One-time migration: seed Company "Qui" → Brand "Qui" → the three hardcoded
// branches, reusing their existing ids so attendance history maps cleanly.
export async function migrateQuiOrg(): Promise<{ created: number; skipped: boolean }> {
  const existing = await getDocs(collection(db, "companies"));
  if (!existing.empty) return { created: 0, skipped: true };
  await saveCompany({ id: "qui", name: "Qui", code: "QUI" });
  await saveBrand({ id: "qui", name: "Qui", code: "QUI", companyId: "qui" });
  for (const b of BRANCHES) {
    await saveBranch({ id: b.id, name: b.name, code: b.id.toUpperCase(), companyId: "qui", brandId: "qui", address: b.address });
  }
  return { created: BRANCHES.length, skipped: false };
}

// ── Scope: what a signed-in user is allowed to see ──
export type ScopeLevel = "owner" | "company" | "branch" | "none";
export type Scope = { level: ScopeLevel; companyId: string | null; branchId: string | null };

export type ScopedProfile = {
  accessRole: AccessRole;
  companyId?: string | null;
  brandId?: string | null;
  branchId?: string | null;
};

// Map a user's role + assignment to a scope:
//   owner   → everything
//   admin   → their whole company (all brands + branches)
//   manager → just their branch
//   staff   → just their branch (mobile app)
export function resolveScope(me: ScopedProfile): Scope {
  if (me.accessRole === "owner") return { level: "owner", companyId: null, branchId: null };
  // Admin and HR both see their whole company (all brands + branches).
  if (me.accessRole === "admin" || me.accessRole === "hr")
    return { level: "company", companyId: me.companyId ?? null, branchId: null };
  return { level: "branch", companyId: me.companyId ?? null, branchId: me.branchId ?? null };
}

// The set of branch ids a scope may see, or null for "all branches" (owner).
export function allowedBranchIds(scope: Scope, branches: Branch[]): Set<string> | null {
  if (scope.level === "owner") return null;
  if (scope.level === "company") {
    return new Set(branches.filter((b) => b.companyId === scope.companyId).map((b) => b.id));
  }
  return new Set(scope.branchId ? [scope.branchId] : []);
}

// Is a record (by its branchId) visible under `allowed`? null = owner (all).
export function inScope(branchId: string | null | undefined, allowed: Set<string> | null): boolean {
  if (allowed === null) return true;
  if (!branchId) return false;
  return allowed.has(branchId);
}
