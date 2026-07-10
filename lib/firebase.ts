import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

// Firebase web config. The apiKey here is NOT a secret — access to your data is
// controlled by Firestore security rules + Firebase Auth, not by hiding this key.
// Analytics (getAnalytics) is intentionally omitted: it is a web-only API and
// is not supported in React Native / Expo.
const firebaseConfig = {
  apiKey: "AIzaSyD-cISjvsFXBmtdOAan1o4EMNp456F9F2c",
  authDomain: "kitchen-in-and-out.firebaseapp.com",
  projectId: "kitchen-in-and-out",
  storageBucket: "kitchen-in-and-out.firebasestorage.app",
  messagingSenderId: "644399021106",
  appId: "1:644399021106:web:8f8f00a34d7eef7a17d02b",
  measurementId: "G-V313Y3EK51",
};

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
