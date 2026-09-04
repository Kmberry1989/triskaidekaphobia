// Firebase is enabled for the Triskaidekaphobia online room experience.
// Add a TURN server to iceServers for reliable voice links across restrictive networks.
window.FLOOR13_FIREBASE_CONFIG = {
  enabled: true,
  config: {
    apiKey: "AIzaSyBnp4PQq_Jx73JR4JeyF7i6gwyNT53sBH8",
    authDomain: "bullseyebingo-51545831-aa22b.firebaseapp.com",
    projectId: "bullseyebingo-51545831-aa22b",
    storageBucket: "bullseyebingo-51545831-aa22b.firebasestorage.app",
    messagingSenderId: "700795831239",
    appId: "1:700795831239:web:98c51a0259816b1be7cfe2"
  },
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};
