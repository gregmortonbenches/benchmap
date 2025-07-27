// src/firebase.js
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
 apiKey: "AIzaSyAg-VG3laAp8kvel5mC9Q_kWhLv6xvFTPY",
      authDomain: "bench-rating.firebaseapp.com",
      projectId: "bench-rating",
      storageBucket: "bench-rating.firebasestorage.app",
      messagingSenderId: "601862513386",
      appId: "1:601862513386:web:485fa761244ea436a4ad93"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

export { db }
