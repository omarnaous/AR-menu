import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo>/, so the base path is set at
// build time. Everything that builds a URL goes through import.meta.env.BASE_URL.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three/addons/exporters/GLTFExporter.js'],
          modelviewer: ['@google/model-viewer'],
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
})
