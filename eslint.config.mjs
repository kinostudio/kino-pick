import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
const config = [
  {
    ignores: [
      '**/.next/**',
      '**/.wrangler/**',
      '**/.build/**',
      '**/.build-storage/**',
      '**/.build-history-stream/**',
      '**/.static/**',
      '**/worker-configuration.d.ts',
      '**/.local/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...next,
  ...ts,
  {
    files: ['apps/web/target-ui/**/*.{ts,tsx}'],
    // This entry is a Vite Worker UI; local blob previews have no Next optimizer.
    rules: { '@next/next/no-img-element': 'off' },
  },
  {
    settings: { next: { rootDir: 'apps/web/' } },
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
];
export default config;
