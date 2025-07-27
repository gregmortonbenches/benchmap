import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

// Firebase config (use your actual keys)
const firebaseConfig = {
  apiKey: "AIzaSyAg-VG3laAp8kvel5mC9Q_kWhLv6xvFTPY",
  authDomain: "bench-rating.firebaseapp.com",
  projectId: "bench-rating",
  storageBucket: "bench-rating.firebasestorage.app",
  messagingSenderId: "601862513386",
  appId: "1:601862513386:web:485fa761244ea436a4ad93"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const ratingCategories = ['comfort', 'ambience', 'view'];

const BenchesMap = () => {
  const mapRef = useRef(null);
  const markerClusterRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const tilesLoaded = useRef(new Set());

  useEffect(() => {
    // Initialize Leaflet map only once
    if (!mapRef.current) {
      mapRef.current = L.map('map', {
        maxBounds: [[48.5, -11], [61.5, 4]],
        maxBoundsViscosity: 1.0
      }).setView([54.5, -3], 6);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(mapRef.current);

      markerClusterRef.current = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        maxClusterRadius: 40
      });
      mapRef.current.addLayer(markerClusterRef.current);

      mapRef.current.on('moveend', () => {
        loadVisibleTiles();
      });

      loadVisibleTiles();

      // Hide loading after a delay similar to old code
      setTimeout(() => setLoading(false), 2500);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sanitizeBenchId(rawId) {
    return String(rawId).replace(/\//g, "_");
  }

  // Helpers for localStorage with try/catch
  function safeGetItem(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function getUserRatingKey(benchId, category) {
    return `benchRatedNum_${benchId}_${category}`;
  }

  function loadCategoryAverage(benchId, category, avgEl) {
    if (!avgEl) return;
    avgEl.innerHTML = `<span class="spinner"></span>`;
    db.collection("benchRatings").doc(benchId).get()
      .then(doc => {
        let avg = 0, count = 0;
        if (doc.exists && doc.data()[category]) {
          const data = doc.data()[category];
          avg = data.total / data.count;
          count = data.count;
        }
        avgEl.innerHTML = count > 0
          ? `Avg: ${avg.toFixed(2)} (${count})`
          : 'No ratings yet';
      });
  }

  function submitNumberRating(benchId, category, input, btn, thanksEl) {
    const value = parseInt(input.value, 10);
    if (isNaN(value) || value < 1 || value > 5) {
      input.style.border = "2px solid #e74c3c";
      setTimeout(() => { input.style.border = ""; }, 1400);
      return;
    }
    if (safeGetItem(getUserRatingKey(benchId, category))) return;
    btn.disabled = true;
    input.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;

    const ref = db.collection("benchRatings").doc(benchId);
    ref.get().then(doc => {
      let update = {};
      if (doc.exists) {
        const data = doc.data();
        const cat = data[category] || { total: 0, count: 0 };
        update[category] = {
          total: cat.total + value,
          count: cat.count + 1
        };
      } else {
        update[category] = { total: value, count: 1 };
      }
      ref.set(update, { merge: true }).then(() => {
        safeSetItem(getUserRatingKey(benchId, category), '1');
        btn.innerHTML = "Submitted";
        loadCategoryAverage(benchId, category, document.getElementById(`avg-${category}-${benchId}`));
        if (thanksEl) {
          thanksEl.classList.remove('hidden');
          setTimeout(() => thanksEl.classList.add('hidden'), 1800);
        }
      });
    });
  }

  function createPopupContent(props, benchId) {
    const extraKeys = ['material', 'colour', 'seats', 'backrest'];
    const extras = extraKeys.filter(k => props[k]).map(k =>
      `<span>${k.charAt(0).toUpperCase() + k.slice(1)}: ${props[k]}</span>`
    ).join('');
    const benchNamePlaceholder = "Bench";
    let categoriesHtml = ratingCategories.map(cat => {
      const localKey = getUserRatingKey(benchId, cat);
      const alreadyRated = !!safeGetItem(localKey);
      return `
        <div class="rating-row">
          <label for="input-${cat}-${benchId}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</label>
          <input class="rating-input" id="input-${cat}-${benchId}" type="number" min="1" max="5" ${alreadyRated ? 'disabled' : ''} />
          <button class="rating-btn" id="btn-${cat}-${benchId}" data-bench="${benchId}" data-cat="${cat}" ${alreadyRated ? 'disabled' : ''}>Submit</button>
          <span class="avg-pill" id="avg-${cat}-${benchId}"></span>
        </div>
      `;
    }).join('');
    return `
      <div class="bench-popup">
        <div class="bench-title" id="bench-title-${benchId}">${benchNamePlaceholder}</div>
        <div class="bench-details">${extras}</div>
        <div class="rating-instructions">Rate this bench <b>1–5</b></div>
        ${categoriesHtml}
        <div id="thanks-${benchId}" class="thanks-message hidden" aria-live="polite">Thanks for rating!</div>
      </div>
    `;
  }

  function loadVisibleTiles() {
    if (!mapRef.current || !markerClusterRef.current) return;
    const bounds = mapRef.current.getBounds();

    // Same tile logic as your original
    const tileRows = 10, tileCols = 10;
    const latMin = 48.5, latMax = 61.5, lngMin = -11, lngMax = 4;
    const latStep = (latMax - latMin) / tileRows;
    const lngStep = (lngMax - lngMin) / tileCols;
    let minRow = Math.floor((bounds.getSouth() - latMin) / latStep);
    let maxRow = Math.floor((bounds.getNorth() - latMin) / latStep);
    let minCol = Math.floor((bounds.getWest() - lngMin) / lngStep);
    let maxCol = Math.floor((bounds.getEast() - lngMin) / lngStep);
    minRow = Math.max(0, minRow); maxRow = Math.min(tileRows - 1, maxRow);
    minCol = Math.max(0, minCol); maxCol = Math.min(tileCols - 1, maxCol);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const url = `data/tile_${row}_${col}.geojson`;
        if (tilesLoaded.current.has(url)) continue;
        tilesLoaded.current.add(url);

        fetch(url).then(res => res.ok ? res.json() : Promise.reject(res.status))
          .then(data => {
            data.features.forEach(feature => {
              if (!feature.geometry || !feature.geometry.coordinates) return;
              const [lng, lat] = feature.geometry.coordinates;
              const props = feature.properties || {};
              const benchId = sanitizeBenchId(props.id || `${row}_${col}_${lat}_${lng}`);

              const marker = L.marker([lat, lng]);
              markerClusterRef.current.addLayer(marker);

              marker.bindPopup(createPopupContent(props, benchId), {
                maxWidth: 320
              });

              marker.on('popupopen', () => {
                // Attach event listeners to rating buttons in popup
                ratingCategories.forEach(cat => {
                  const btn = document.getElementById(`btn-${cat}-${benchId}`);
                  const input = document.getElementById(`input-${cat}-${benchId}`);
                  const thanks = document.getElementById(`thanks-${benchId}`);
                  if (btn && input) {
                    btn.onclick = () => submitNumberRating(benchId, cat, input, btn, thanks);
                  }
                  loadCategoryAverage(benchId, cat, document.getElementById(`avg-${cat}-${benchId}`));
                });
              });
            });
          }).catch(err => {
            console.error("Error loading tile", url, err);
          });
      }
    }
  }

  return (
    <>
      {loading && <div className="loading-overlay">Loading benches…</div>}
      <div id="map" style={{ height: '600px', width: '100%' }} />
    </>
  );
};

export default BenchesMap;
