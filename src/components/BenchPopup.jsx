import React from 'react'

export default function BenchPopup({ bench }) {
  // Stub for future bench info + ratings UI
  return (
    <div>
      <h3 className="font-bold">{bench.name || 'Bench Name'}</h3>
      <p>{bench.description || 'Description goes here'}</p>
      <p>Comfort: ⭐⭐⭐⭐☆</p>
      <p>Ambience: ⭐⭐⭐☆☆</p>
      <p>View: ⭐⭐⭐⭐⭐</p>
    </div>
  )
}
