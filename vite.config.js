import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/benchmap/',
  optimizeDeps: {
    include: ['leaflet.heat'],  // Pre-bundle leaflet.heat for dev
  },
  build: {
    rollupOptions: {
      // Remove externalization here
      // external: ['leaflet.heat'],  <-- REMOVE this line
    }
  }
})
