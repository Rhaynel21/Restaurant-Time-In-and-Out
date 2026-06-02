export type Branch = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export type LocationPoint = {
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
};

export const BRANCHES: Branch[] = [
  {
    id: "kopiko-qc",
    name: "Kopiko - Quezon City",
    address: "32 Tomas Morato Ave, Quezon City",
    lat: 14.63093,
    lng: 121.03371,
  },
  {
    id: "kopiko-makati",
    name: "Kopiko - Makati Hub",
    address: "5th Floor, Paseo Tower, Makati City",
    lat: 14.55686,
    lng: 121.01975,
  },
  {
    id: "kopiko-bgc",
    name: "Kopiko - BGC",
    address: "26th St, Bonifacio Global City, Taguig",
    lat: 14.55122,
    lng: 121.04673,
  },
];

export function distanceScore(a: LocationPoint, b: Branch) {
  const latDiff = a.lat - b.lat;
  const lngDiff = a.lng - b.lng;
  return latDiff * latDiff + lngDiff * lngDiff;
}

export function findNearestBranch(userLocation: LocationPoint) {
  return BRANCHES.reduce((currentNearest, currentBranch) => {
    const currentScore = distanceScore(userLocation, currentBranch);
    const nearestScore = distanceScore(userLocation, currentNearest);
    return currentScore < nearestScore ? currentBranch : currentNearest;
  }, BRANCHES[0]);
}
