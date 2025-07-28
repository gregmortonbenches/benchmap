import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/benchmap/',
  optimizeDeps: {
    include: ['leaflet.heat'],
  },
  build: {
    rollupOptions: {
      external: ['leaflet.heat'],
    }
  }
})
