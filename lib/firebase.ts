import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

// Firebase web config, loaded from EXPO_PUBLIC_ env vars (see .env / .env.example).
// These values are NOT secrets — EXPO_PUBLIC_ vars are bundled into the client, and
// access to your data is controlled by Firestore security rules + Firebase Auth, not
// by hiding this config. They live in .env only for config hygiene and easy dev/prod
// swaps. Real secrets belong in functions/.env, never behind EXPO_PUBLIC_.
// Analytics (getAnalytics) is intentionally omitted: it is a web-only API and
// is not supported in React Native / Expo.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Fail loudly at startup if the env wasn't loaded (e.g. missing .env after a fresh
// clone), instead of surfacing a cryptic Firebase "invalid-api-key" error later.
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    "Missing Firebase config. Copy .env.example to .env and fill in the " +
      "EXPO_PUBLIC_FIREBASE_* values, then restart the Expo dev server.",
  );
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// On native we wire AsyncStorage so the signed-in session survives app restarts.
// On web, the SDK's default (IndexedDB/local) persistence is used.
//
// `getReactNativePersistence` only exists in firebase/auth's React-Native build
// (Metro resolves it at runtime), so it's loaded via require() inside the
// native-only branch — the web bundle never references it and TS doesn't try to
// type-check the missing export.
function resolveAuth(): Auth {
  if (Platform.OS === "web") return getAuth(app);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getReactNativePersistence } = require("firebase/auth");
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    // initializeAuth throws if already initialized (e.g. Fast Refresh).
    return getAuth(app);
  }
}

export const db = getFirestore(app);
export const auth = resolveAuth();
export const storage = getStorage(app);
export const functions = getFunctions(app);
