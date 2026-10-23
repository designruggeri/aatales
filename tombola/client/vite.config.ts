import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const target = `http://localhost:${process.env.PORT || 8080}`;
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, '../dist/client'), emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': target, '/media': target, '/ws': { target: target.replace('http', 'ws'), ws: true } },
  },
});
