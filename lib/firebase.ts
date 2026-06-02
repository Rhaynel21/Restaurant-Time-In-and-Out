import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase web config. The apiKey here is NOT a secret — access to your data is
// controlled by Firestore security rules, not by hiding this key.
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

export const db = getFirestore(app);
