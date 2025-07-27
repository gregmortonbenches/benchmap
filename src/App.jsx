import React from 'react'
import MapView from './components/MapView'
import SearchBar from './components/SearchBar'

export default function App() {
  return (
    <div className="flex flex-col h-screen">
      <header className="bg-blue-600 text-white p-4 text-xl font-bold">
        Bench Map
      </header>
      <SearchBar />
      <MapView />
    </div>
  )
}
