import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'vitest';

type NativeMiniflare = {
  dispatchFetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
};
type Esbuild = {
  build(options: unknown): Promise<{ outputFiles: { text: string }[] }>;
};

const workerRequire = createRequire(resolve('apps/worker/package.json'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare') as {
  Miniflare: new (options: unknown) => NativeMiniflare;
  convertV4MiniflareOptions: (options: unknown) => unknown;
};
const wranglerPackage = workerRequire.resolve('wrangler/package.json');
const { build } = createRequire(wranglerPackage)('esbuild') as Esbuild;

test('bundled S3 list parser runs in the Miniflare Worker runtime', async () => {
  const workerName = 's3-storage-list-workerd';
  const parserPath = resolve('apps/worker/src/s3-storage-list.ts').replaceAll(
    '\\',
    '/',
  );
  const entry = `
    import { parseS3StorageList } from ${JSON.stringify(parserPath)};
    const bucketName = 'smoke-bucket';
    const prefix = '123e4567-e89b-42d3-a456-426614174000/';
    export default {
      async fetch(request) {
        try {
          const url = new URL(request.url);
          const cursor = url.searchParams.get('cursor') ?? undefined;
          const result = parseS3StorageList(await request.text(), {
            bucketName, prefix, limit: 2, cursor,
          });
          return Response.json(result);
        } catch {
          return Response.json({ error: 'S3_STORAGE_LIST_INVALID' }, { status: 400 });
        }
      },
    };
  `;
  const bundled = await build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      sourcefile: 's3-storage-list-workerd-entry.js',
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['browser', 'module', 'main'],
  });
  assert.equal(bundled.outputFiles.length, 1);

  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: workerName,
          modules: true,
          script: bundled.outputFiles[0]!.text,
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
        },
      ],
    }),
  );

  try {
    const cursor = 'opaque😀*+/=token';
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>smoke-bucket</Name><Prefix>123e4567-e89b-42d3-a456-426614174000%2F</Prefix><EncodingType>url</EncodingType><KeyCount>2</KeyCount><MaxKeys>2</MaxKeys><IsTruncated>true</IsTruncated><ContinuationToken>${cursor}</ContinuationToken><NextContinuationToken>next+/=token</NextContinuationToken><Contents><Key>123e4567-e89b-42d3-a456-426614174000%2Fcaf%C3%A9%20photo.jpg</Key><Size>4</Size></Contents><Contents><Key>123e4567-e89b-42d3-a456-426614174000%2Fsecond.jpg</Key><Size>8</Size></Contents></ListBucketResult>`;
    const valid = await mf.dispatchFetch(
      `http://miniflare.invalid/list?cursor=${encodeURIComponent(cursor)}`,
      { method: 'POST', body: xml },
    );
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), {
      objects: [
        {
          key: '123e4567-e89b-42d3-a456-426614174000/café photo.jpg',
          size: 4,
        },
        {
          key: '123e4567-e89b-42d3-a456-426614174000/second.jpg',
          size: 8,
        },
      ],
      truncated: true,
      cursor: 'next+/=token',
    });

    const invalid = await mf.dispatchFetch('http://miniflare.invalid/list', {
      method: 'POST',
      body: xml.replace('caf%C3%A9', 'caf&nbsp;'),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      error: 'S3_STORAGE_LIST_INVALID',
    });
  } finally {
    await mf.dispose();
  }
});
