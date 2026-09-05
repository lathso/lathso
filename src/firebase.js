import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC1Whisdd8AAPl46X41xAOLAsP8ALNuqEc",
  authDomain: "learnora-691fd.firebaseapp.com",
  projectId: "learnora-691fd",
  storageBucket: "learnora-691fd.firebasestorage.app",
  messagingSenderId: "1047690958229",
  appId: "1:1047690958229:web:9a37046e5c5f5982b1929c",
  measurementId: "G-Y9LGYYLTG7"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;