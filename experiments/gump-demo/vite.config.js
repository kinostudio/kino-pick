import { fileURLToPath } from 'node:url';
const config = {
  root: fileURLToPath(new URL('.', import.meta.url)),
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
};

export default config;
