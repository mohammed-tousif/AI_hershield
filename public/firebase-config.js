// Her Shield — Firebase Web SDK (replace with your Firebase project web app config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAGAW2IYsIk4vgMIZ6aSCJKHBb2AglSC7E",
  authDomain: "endless-galaxy-453316-a9.firebaseapp.com",
  projectId: "endless-galaxy-453316-a9",
  storageBucket: "endless-galaxy-453316-a9.firebasestorage.app",
  messagingSenderId: "756856970803",
  appId: "1:756856970803:web:55f4da2d35b5df09120d46"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Export the app instance for other modules
export default app;
