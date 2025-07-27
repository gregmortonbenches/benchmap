import React from 'react'

export default function SearchBar() {
  return (
    <div className="p-4 bg-gray-100">
      <input
        type="text"
        placeholder="Search benches by location or name..."
        className="w-full p-2 border rounded"
        disabled
      />
      <p className="text-xs text-gray-500 mt-1">Search feature coming soon!</p>
    </div>
  )
}
