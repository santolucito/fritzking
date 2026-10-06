import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://<user>.github.io/fritzking/ on GitHub Pages.
  base: process.env.GITHUB_ACTIONS ? '/fritzking/' : '/',
})
