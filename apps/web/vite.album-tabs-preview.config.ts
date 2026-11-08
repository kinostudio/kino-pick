import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: dirname(require.resolve('react/package.json')),
      'react-dom': dirname(require.resolve('react-dom/package.json')),
    },
  },
  root: fileURLToPath(
    new URL('../../docs/prototypes/album-tabs', import.meta.url),
  ),
  server: { host: '127.0.0.1', port: 4198, strictPort: true },
});
