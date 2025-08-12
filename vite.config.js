import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/skycast-app/', // This matches the homepage field in package.json for GitHub Pages
  build: {
    outDir: 'build', // Keep the same output directory for consistency with deployment scripts
  },
})