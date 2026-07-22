import { LocationPoint } from "@/lib/branches";

// Step 3 of the Klicc Staff Management Flow — mobile GPS check-in. A branch defines
// a geofence (latitude, longitude, radiusMeters, set in the Org tab). A GPS punch is
// accepted only when the device's location falls inside that circle. Phase 1 stores
// branch lat/lng but no radius, so the radius is Qui's own field.

export type Geofence = { latitude: number | null; longitude: number | null; radiusMeters: number | null };

// Great-circle distance between two points, in metres (haversine).
export function distanceMeters(a: LocationPoint, b: { lat: number; lng: number }): number {
  const R = 6371000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceCheck = {
  ok: boolean;
  reason: "inside" | "outside" | "no-geofence";
  distanceMeters: number | null;
  radiusMeters: number | null;
};

const DEFAULT_RADIUS_M = 150;

// Is a device location within a branch's geofence? When the branch has no
// coordinates configured we can't enforce a fence — callers decide whether to
// allow the punch (reason "no-geofence").
export function checkGeofence(point: LocationPoint, fence: Geofence): GeofenceCheck {
  if (fence.latitude == null || fence.longitude == null) {
    return { ok: false, reason: "no-geofence", distanceMeters: null, radiusMeters: null };
  }
  const radius = fence.radiusMeters && fence.radiusMeters > 0 ? fence.radiusMeters : DEFAULT_RADIUS_M;
  const d = distanceMeters(point, { lat: fence.latitude, lng: fence.longitude });
  return { ok: d <= radius, reason: d <= radius ? "inside" : "outside", distanceMeters: Math.round(d), radiusMeters: radius };
}
