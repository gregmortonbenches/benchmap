// Stub for Firebase initialization & functions
// Replace with your own Firebase config & functions as you build

export function submitRating(benchId, rating) {
  console.log(`Submitting rating for bench ${benchId}`, rating)
}

export function fetchRatings(benchId) {
  console.log(`Fetching ratings for bench ${benchId}`)
  return Promise.resolve([])
}
