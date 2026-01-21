import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBJspCFmB7IQQdLdxLYQrZZ-TFAiDPXrXk",
  authDomain: "fastdelivery-46457.firebaseapp.com",
  projectId: "fastdelivery-46457",
  storageBucket: "fastdelivery-46457.appspot.com",
  messagingSenderId: "889884008498",
  appId: "1:889884008498:web:418e00c16326df6d4e1c2b",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);

// Admin UID centralizado
const adminUID = "DGfO0ZsoU0W7CXbDdbYPRSmweKx2";

export { app, db, auth, analytics, adminUID };
