import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/benchmap/', // 👈 this is critical for GitHub Pages!
})
