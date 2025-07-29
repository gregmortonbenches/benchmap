import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  plugins: [
    react(),
    commonjs(), // ✅ ensures leaflet.heat is bundled correctly
  ],
  base: '/benchmap/', // ✅ must match your GitHub repo name
  optimizeDeps: {
    include: ['leaflet.heat'],
  },
})
