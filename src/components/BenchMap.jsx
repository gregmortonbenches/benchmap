import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';

function getTileUrlsForBounds(bounds) {
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

  const urls = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      urls.push(`${import.meta.env.BASE_URL}data/tile_${row}_${col}.geojson`);
    }
  }
  return urls;
}

export default function BenchMap() {
  const mapRef = useRef(null);
  const heatLayerRef = useRef(null);
  const tilesLoaded = useRef(new Set());

  useEffect(() => {
    const map = L.map('map').setView([54.5, -3], 6);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    heatLayerRef.current = L.heatLayer([], {
      radius: 25,
      blur: 15,
      maxZoom: 17,
    }).addTo(map);

    const loadVisibleTiles = () => {
      const bounds = map.getBounds();
      const urls = getTileUrlsForBounds(bounds);

      urls.forEach(url => {
        if (tilesLoaded.current.has(url)) return;

        fetch(url)
          .then(res => res.json())
          .then(data => {
            const points = data.features.map(f => {
              const [lng, lat] = f.geometry.coordinates;
              return [lat, lng, 1];
            });

            heatLayerRef.current.addLatLngs(points);
            tilesLoaded.current.add(url);
          })
          .catch(err => {
            console.warn('Failed to load tile:', url, err);
          });
      });
    };

    map.on('moveend', loadVisibleTiles);
    loadVisibleTiles();

    return () => {
      map.off('moveend', loadVisibleTiles);
    };
  }, []);

  return <div id="map" className="w-full h-full" />;
}
