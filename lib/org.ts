import { collection, collectionGroup, deleteDoc, doc, documentId, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";

import { AccessRole } from "@/lib/auth";
import { BRANCHES } from "@/lib/branches";
import { db } from "@/lib/firebase";

// Multi-tenant org hierarchy, aligned to the Klicc Phase 1 POS data model
// (project restaurant-management-96e52): NESTED subcollections under a top-level
// `organization` collection, with an `areas` grouping alongside brands:
//   organization/{orgId}
//     ├── brands/{brandId}
//     │     └── branches/{branchId}   (name, address, latitude, longitude, areaId, areaName)
//     └── areas/{areaId}              (name, code)
//
// Parent ids are derived from each document's path (Phase 1 branch docs are also
// path-based at the branch level), so the tree is read with three collectionGroup
// listeners. Branch doc ids match the branchId stamped on attendance/employee docs.
//
// (The in-memory field `companyId` = the organization id; Phase 1 stamps this as
// `organizationId` on its transactional docs.)

export type Company = { id: string; name: string; code: string };
export type Brand = { id: string; name: string; code: string; companyId: string };
export type Area = { id: string; name: string; code: string; companyId: string };
export type Branch = {
  id: string;
  name: string;
  code: string;
  companyId: string;
  brandId: string;
  address: string;
  // Phase-1-aligned branch fields (all optional; used by mobile GPS check-in + area grouping).
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null; // GPS check-in geofence radius (Phase 1 has lat/lng only — this is Qui's addition)
  areaId: string | null;
  areaName: string | null;
  // Link to the Phase-1 POS branch (project restaurant-management-96e52). The bridge/API
  // keys revenue + service-charge feeds by this id → Qui `pos_daily/{branchId}_{date}`.
  posBranchId: string | null;
};

export type OrgTree = { companies: Company[]; brands: Brand[]; areas: Area[]; branches: Branch[] };

// A fresh, empty tree — use as the initial state for OrgTree consumers.
export const EMPTY_ORG: OrgTree = { companies: [], brands: [], areas: [], branches: [] };

// Resolve the canonical organization branch used by mobile geofencing. This
// deliberately avoids the legacy hard-coded branch list so coordinate/radius
// changes made by an administrator take effect immediately.
export async function getOrgBranch(branchId: string): Promise<Branch | null> {
  const snap = await getDocs(query(collectionGroup(db, "branches"), where(documentId(), "==", branchId)));
  const d = snap.docs.find((row) => row.ref.path.startsWith("organization/"));
  if (!d) return null;
  const data = d.data();
  return {
    id: d.id,
    name: str(data.name, d.id),
    code: str(data.code),
    address: str(data.address),
    latitude: numOrNull(data.latitude),
    longitude: numOrNull(data.longitude),
    radiusMeters: numOrNull(data.radiusMeters),
    areaId: typeof data.areaId === "string" ? data.areaId : null,
    areaName: typeof data.areaName === "string" ? data.areaName : null,
    posBranchId: typeof data.posBranchId === "string" ? data.posBranchId : null,
    brandId: d.ref.parent.parent?.id ?? "",
    companyId: d.ref.parent.parent?.parent.parent?.id ?? "",
  };
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

// ── Nested doc refs (top collection: `organization`) ──
const companyRef = (companyId: string) => doc(db, "organization", companyId);
const brandRef = (companyId: string, brandId: string) => doc(db, "organization", companyId, "brands", brandId);
const areaRef = (companyId: string, areaId: string) => doc(db, "organization", companyId, "areas", areaId);
const branchRef = (companyId: string, brandId: string, branchId: string) =>
  doc(db, "organization", companyId, "brands", brandId, "branches", branchId);

// ── Real-time tree: organization + collectionGroup(brands / areas / branches) ──
export function subscribeOrgTree(onChange: (tree: OrgTree) => void, onError?: (e: Error) => void) {
  const tree: OrgTree = { companies: [], brands: [], areas: [], branches: [] };
  const emit = () => onChange({ ...tree });

  const subCompanies = onSnapshot(
    collection(db, "organization"),
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
          companyId: d.ref.parent.parent?.id ?? "", // …/organization/{companyId}/brands/{id}
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      emit();
    },
    (e) => onError?.(e as Error),
  );
  const subAreas = onSnapshot(
    collectionGroup(db, "areas"),
    (snap) => {
      tree.areas = snap.docs
        .map((d) => ({
          id: d.id,
          name: str(d.data().name, d.id),
          code: str(d.data().code),
          companyId: d.ref.parent.parent?.id ?? "", // …/organization/{companyId}/areas/{id}
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
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: str(data.name, d.id),
            code: str(data.code),
            address: str(data.address),
            latitude: numOrNull(data.latitude),
            longitude: numOrNull(data.longitude),
            radiusMeters: numOrNull(data.radiusMeters),
            areaId: typeof data.areaId === "string" ? data.areaId : null,
            areaName: typeof data.areaName === "string" ? data.areaName : null,
            posBranchId: typeof data.posBranchId === "string" ? data.posBranchId : null,
            brandId: d.ref.parent.parent?.id ?? "", // …/brands/{brandId}/branches/{id}
            companyId: d.ref.parent.parent?.parent.parent?.id ?? "", // …/organization/{companyId}/…
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      emit();
    },
    (e) => onError?.(e as Error),
  );

  return () => {
    subCompanies();
    subBrands();
    subAreas();
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
export async function saveArea(a: Area) {
  await setDoc(areaRef(a.companyId, a.id), { name: a.name, code: a.code, updatedAt: serverTimestamp() }, { merge: true });
}
export async function saveBranch(b: Branch) {
  await setDoc(
    branchRef(b.companyId, b.brandId, b.id),
    {
      name: b.name,
      code: b.code,
      address: b.address,
      latitude: b.latitude,
      longitude: b.longitude,
      radiusMeters: b.radiusMeters,
      areaId: b.areaId,
      areaName: b.areaName,
      posBranchId: b.posBranchId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// Deletes cascade to children (Firestore doesn't do this automatically).
export async function deleteBranch(companyId: string, brandId: string, branchId: string) {
  await deleteDoc(branchRef(companyId, brandId, branchId));
}
export async function deleteArea(companyId: string, areaId: string) {
  await deleteDoc(areaRef(companyId, areaId));
}
export async function deleteBrand(companyId: string, brandId: string) {
  const branches = await getDocs(collection(db, "organization", companyId, "brands", brandId, "branches"));
  await Promise.all(branches.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(brandRef(companyId, brandId));
}
export async function deleteCompany(companyId: string) {
  const brands = await getDocs(collection(db, "organization", companyId, "brands"));
  for (const brand of brands.docs) await deleteBrand(companyId, brand.id);
  const areas = await getDocs(collection(db, "organization", companyId, "areas"));
  await Promise.all(areas.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(companyRef(companyId));
}

// One-time migration: seed Organization "Qui" → Brand "Qui" → the three hardcoded
// branches, reusing their existing ids so attendance history maps cleanly.
export async function migrateQuiOrg(): Promise<{ created: number; skipped: boolean }> {
  const existing = await getDocs(collection(db, "organization"));
  if (!existing.empty) return { created: 0, skipped: true };
  await saveCompany({ id: "qui", name: "Qui", code: "QUI" });
  await saveBrand({ id: "qui", name: "Qui", code: "QUI", companyId: "qui" });
  for (const b of BRANCHES) {
    await saveBranch({
      id: b.id,
      name: b.name,
      code: b.id.toUpperCase(),
      companyId: "qui",
      brandId: "qui",
      address: b.address,
      latitude: null,
      longitude: null,
      radiusMeters: null,
      areaId: null,
      areaName: null,
      posBranchId: null,
    });
  }
  return { created: BRANCHES.length, skipped: false };
}

// ── Scope: what a signed-in user is allowed to see ──
export type ScopeLevel = "owner" | "company" | "area" | "branch" | "none";
export type Scope = { level: ScopeLevel; companyId: string | null; branchId: string | null; branchIds: string[] };

export type ScopedProfile = {
  accessRole: AccessRole;
  companyId?: string | null;
  brandId?: string | null;
  branchId?: string | null;
  branchIds?: string[] | null; // area managers cover several branches
};

// Map a user's role + assignment to a scope:
//   owner       → everything
//   admin / hr  → their whole company (all brands + branches)
//   areaManager → the several branches assigned to them (an area/region)
//   manager     → just their branch
//   staff       → just their branch (mobile app)
export function resolveScope(me: ScopedProfile): Scope {
  if (me.accessRole === "owner") return { level: "owner", companyId: null, branchId: null, branchIds: [] };
  // Admin and HR both see their whole company (all brands + branches).
  if (me.accessRole === "admin" || me.accessRole === "hr")
    return { level: "company", companyId: me.companyId ?? null, branchId: null, branchIds: [] };
  // Area manager: several branches. Falls back to their single branchId if the
  // branchIds list is empty (so a mis-provisioned area manager still sees one).
  if (me.accessRole === "areaManager") {
    const ids = (me.branchIds ?? []).filter(Boolean);
    return {
      level: "area",
      companyId: me.companyId ?? null,
      branchId: null,
      branchIds: ids.length ? ids : me.branchId ? [me.branchId] : [],
    };
  }
  return { level: "branch", companyId: me.companyId ?? null, branchId: me.branchId ?? null, branchIds: [] };
}

// The set of branch ids a scope may see, or null for "all branches" (owner).
export function allowedBranchIds(scope: Scope, branches: Branch[]): Set<string> | null {
  if (scope.level === "owner") return null;
  if (scope.level === "company") {
    return new Set(branches.filter((b) => b.companyId === scope.companyId).map((b) => b.id));
  }
  if (scope.level === "area") return new Set(scope.branchIds);
  return new Set(scope.branchId ? [scope.branchId] : []);
}

// Is a record (by its branchId) visible under `allowed`? null = owner (all).
export function inScope(branchId: string | null | undefined, allowed: Set<string> | null): boolean {
  if (allowed === null) return true;
  if (!branchId) return false;
  return allowed.has(branchId);
}
