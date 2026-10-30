import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const targetUi = path.join(webRoot, 'target-ui');

export default defineConfig({
  root: targetUi,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^next\/link$/,
        replacement: path.join(targetUi, 'next-link.tsx'),
      },
      {
        find: /^next\/navigation$/,
        replacement: path.join(targetUi, 'next-navigation.ts'),
      },
    ],
  },
  css: { postcss: path.join(webRoot, 'postcss.config.mjs') },
  build: {
    outDir: path.resolve(webRoot, '../worker/.static'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
