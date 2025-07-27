import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Firebase imports
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
} from "firebase/firestore";

// Your Firebase config (replace with your actual config)
const firebaseConfig = {
  apiKey: "AIzaSyAg-VG3laAp8kvel5mC9Q_kWhLv6xvFTPY",
      authDomain: "bench-rating.firebaseapp.com",
      projectId: "bench-rating",
      storageBucket: "bench-rating.firebasestorage.app",
      messagingSenderId: "601862513386",
      appId: "1:601862513386:web:485fa761244ea436a4ad93"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export default function BenchMap() {
  const [benches, setBenches] = useState([]);

  useEffect(() => {
    async function fetchBenches() {
      try {
        const benchesCol = collection(db, "benches");
        const benchSnapshot = await getDocs(benchesCol);
        const benchList = benchSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setBenches(benchList);
      } catch (error) {
        console.error("Error fetching benches:", error);
      }
    }
    fetchBenches();
  }, []);

  async function rateBench(id, rating) {
    try {
      const benchRef = doc(db, "benches", id);
      await setDoc(
        benchRef,
        { ratings: rating }, // You can modify to accumulate ratings or update as needed
        { merge: true }
      );
      alert("Thanks for rating!");
    } catch (error) {
      console.error("Error saving rating:", error);
    }
  }

  return (
    <MapContainer
      center={[51.505, -0.09]}
      zoom={13}
      style={{ height: "600px", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {benches.map((bench) => (
        <Marker key={bench.id} position={[bench.lat, bench.lng]}>
          <Popup>
            <div>
              <h3 className="font-bold">{bench.name || "Bench"}</h3>
              <p>Comfort: {bench.ratings?.comfort || "Not rated"}</p>
              <p>Ambience: {bench.ratings?.ambience || "Not rated"}</p>
              <p>View: {bench.ratings?.view || "Not rated"}</p>

              <button
                onClick={() =>
                  rateBench(bench.id, {
                    comfort: 5,
                    ambience: 4,
                    view: 3,
                  })
                }
                className="mt-2 px-2 py-1 bg-blue-500 text-white rounded"
              >
                Rate 5 / 4 / 3
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
