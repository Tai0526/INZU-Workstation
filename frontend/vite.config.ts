import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
  build: {
    /**
     * There is deliberately no `manualChunks` here. Every page is lazy-loaded in
     * App.tsx, which is what took first load from 4.10 MB (1.18 MB gzipped) to
     * 0.59 MB (172 KB gzipped) — Rollup then splits per route on its own and
     * keeps xlsx / jsPDF / leaflet inside the pages that actually use them.
     *
     * Hand-chunking on top of that was tried and made things WORSE every time:
     *   - Splitting react/react-dom/recharts/supabase into a vendor chunk broke
     *     CommonJS init order — a white screen, "Cannot read properties of
     *     undefined (reading 'createContext')".
     *   - Isolating leaflet pulled the map onto first paint: Vite hoists CSS from
     *     a manual chunk into index.html as a render-blocking stylesheet, and
     *     leaflet ships its own CSS.
     *   - Isolating xlsx / jspdf stranded Rollup's shared helpers (the preload
     *     helper, the CJS interop shim) inside those huge chunks, so the entry
     *     imported one small function and dragged 690 KB–1.3 MB onto first paint.
     * Rollup's automatic chunking gets all of this right. Leave it alone.
     *
     * Long-term caching is handled where it belongs — netlify.toml marks the
     * fingerprinted /assets/* immutable, so a deploy only re-fetches what changed.
     */
    // The remaining >500 kB chunks are the export libraries, and they are now
    // lazy — off the first-load path. This keeps the warning meaningful rather
    // than firing on every build.
    chunkSizeWarningLimit: 1400,
  },
})
