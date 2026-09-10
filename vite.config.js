import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
