import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

export default defineConfig({
  plugins: [react(), {
    name: 'publish-index',
    closeBundle() {
      const source = path.resolve(__dirname, 'dist/app.html');
      const target = path.resolve(__dirname, 'dist/index.html');
      if (fs.existsSync(source)) fs.renameSync(source, target);
    },
  }],
  base: '/FBS-PLANER/',
  build: { rollupOptions: {
    input: path.resolve(__dirname, 'app.html'),
    output: { entryFileNames: 'assets/app-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
  } },
});



