import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import 'leaflet/dist/leaflet.css'

const BenchMap = () => {
  const [benches, setBenches] = useState([])

  useEffect(() => {
    const fetchBenches = async () => {
      const snapshot = await getDocs(collection(db, 'benches'))
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setBenches(data)
    }
    fetchBenches()
  }, [])

  return (
    <MapContainer center={[51.5, -0.1]} zoom={13} style={{ height: '100vh', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {benches.map(bench => (
        <Marker key={bench.id} position={[bench.lat, bench.lng]}>
          <Popup>
            {bench.name}<br />
            Comfort: {bench.comfort}<br />
            View: {bench.view}<br />
            Ambience: {bench.ambience}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

export default BenchMap
