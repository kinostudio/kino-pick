import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const targetUi = path.join(webRoot, 'target-ui');

const uploadSlots = process.env.KINO_LOCAL_BENCH_UPLOAD_SLOTS ?? '10';
if (!['4', '6', '10'].includes(uploadSlots))
  throw new Error('Invalid upload concurrency');

export default defineConfig({
  define: { __UPLOAD_SLOTS__: uploadSlots },
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
