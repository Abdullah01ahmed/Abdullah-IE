import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is loaded by Electron from disk (file://) in production, so the
// base must be relative. In development it is served by the Vite dev server.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('@babylonjs')) return 'babylon';
          if (/node_modules\/(react|react-dom|zustand|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    exclude: [],
  },
});
