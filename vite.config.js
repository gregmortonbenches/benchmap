import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  plugins: [react()],
  base: '/benchmap/',
  optimizeDeps: {
    include: ['leaflet.heat'],
  },
  build: {
    rollupOptions: {
      plugins: [commonjs()]
    }
  }
})
