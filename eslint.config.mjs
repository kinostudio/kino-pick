import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
const config = [
  {
    ignores: [
      '**/.next/**',
      '.local/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...next,
  ...ts,
  {
    settings: { next: { rootDir: 'apps/web/' } },
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
];
export default config;
