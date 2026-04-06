// Her Shield — Firebase Web SDK (replace with your Firebase project web app config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Your web app's Firebase configuration


const firebaseConfig = {
  apiKey: "AIzaSyA3iKwVNo7xrNMXUGv0-R8hIG8SG6vdIqI",
  authDomain: "hershield-web.firebaseapp.com",
  projectId: "hershield-web",
  storageBucket: "hershield-web.firebasestorage.app",
  messagingSenderId: "64178190817",
  appId: "1:64178190817:web:8a22b6e2dd10763a98faa0",
  measurementId: "G-HM9KBQMH7S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Export the app instance for other modules
export default app;
