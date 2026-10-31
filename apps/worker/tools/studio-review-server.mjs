import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeSignature } from 'better-auth/crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import sharp from 'sharp';
import { applyMigration } from '../tests/apply-migration.mjs';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  origin = 'http://127.0.0.1:4180',
  host = '127.0.0.1:4180',
  owner = randomUUID(),
  session = randomUUID(),
  token = randomBytes(32).toString('hex'),
  secret = randomBytes(40).toString('hex');
const signature = await makeSignature(token, secret),
  cookie =
    'kino-owner.session_token=' + encodeURIComponent(token + '.' + signature);
const flags = Object.fromEntries(
  [
    'PHOTOGRAPHER_RECOMMENDATIONS',
    'ALBUM_ACTIVATION',
    'GUEST_INVITE_ISSUANCE',
    'GUEST_EXCHANGE',
    'GUEST_SELECTION',
    'GUEST_FEEDBACK',
    'GUEST_TAGS',
    'GUEST_HISTORY',
    'GUEST_DOWNLOADS',
    'GUEST_VERSION_COMPARISON',
    'GUEST_COMMENTS',
    'GUEST_ANNOTATIONS',
    'FREEHAND_ANNOTATIONS',
    'OWNER_COMMENTS',
    'OWNER_COMMENT_PROCESSING',
    'OWNER_ANNOTATIONS',
    'OWNER_ANNOTATION_AUTHORING',
    'OWNER_ANNOTATION_PROCESSING',
    'OWNER_HISTORY',
    'HUMAN_VIEW_TRACKING',
    'PHOTO_VERSIONS',
    'PROJECT_VERSIONING_CONFIGURATION',
  ].map((x) => [x + '_ENABLED', 'true']),
);
const common = {
  APP_ENV: 'local',
  APP_URL: origin,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  BETTER_AUTH_SECRET: secret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-review-only-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-review-only-secret',
  R2_BUCKET_NAME: 'studio-review-private',
  ...flags,
};
const options = (name) => ({
  name,
  modules: true,
  scriptPath: join(root, '.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {
    ...common,
    DIRECT_UPLOAD_ENABLED: name === 'seed' ? 'true' : 'false',
    PHOTO_VERSION_UPLOADS_ENABLED: name === 'seed' ? 'true' : 'false',
  },
  d1Databases: { DB: 'studio-review' },
  r2Buckets: { PRIMARY_STORAGE: 'studio-review' },
  assets: {
    directory: join(root, '.static'),
    binding: 'ASSETS',
    run_worker_first: true,
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
});
let mf,
  phase = 'initialization';
try {
  mf = new Miniflare(
    convertV4MiniflareOptions({ workers: ['seed', 'review'].map(options) }),
  );
  const db = await mf.getD1Database('DB', 'review'),
    storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'review'),
    seed = await mf.getWorker('seed'),
    worker = await mf.getWorker('review');
  const sql = (text, ...args) =>
    db
      .prepare(text)
      .bind(...args)
      .run();
  const files = (await readdir(join(root, 'migrations')))
    .filter((x) => /^\d{4}_.+\.sql$/.test(x))
    .sort();
  assert.ok(files.length >= 58 && files.length <= 59);
  for (const file of files) {
    phase = 'migration-' + file.slice(0, 4);
    await applyMigration(
      db,
      await readFile(join(root, 'migrations', file), 'utf8'),
    );
  }
  phase = 'owner';
  await sql(
    'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
    owner,
    'local-review-' + randomUUID(),
  );
  const now = Date.now();
  await sql(
    'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    session,
    token,
    owner,
    now + 86400000,
    now,
    now,
  );
  async function api(path, body, method = 'POST') {
    const r = await seed.fetch(
      new Request(origin + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': owner,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const j = await r.json();
    if (!r.ok)
      throw new Error('API ' + r.status + ' ' + (j.error?.code ?? 'unknown'));
    return j;
  }
  phase = 'workspace';
  const { workspace } = await api('/api/v1/workspaces', {
    name: '奇諾影像｜真實 API 驗收工作區',
    requestId: randomUUID(),
  });
  const policy = await api(
    '/api/v1/workspaces/' + workspace.id + '/image-processing-policy',
    undefined,
    'GET',
  );
  if (policy.recipe !== 'local-sharp-0.35.5-v1')
    await api(
      '/api/v1/workspaces/' + workspace.id + '/image-processing-policy',
      {
        requestId: randomUUID(),
        expectedRevision: policy.revision,
        recipe: 'local-sharp-0.35.5-v1',
      },
    );
  phase = 'project';
  const { project } = await api('/api/v1/projects', {
    workspaceId: workspace.id,
    name: '海岸婚禮紀錄｜驗收專案',
    requestId: randomUUID(),
  });
  phase = 'album';
  const { album } = await api('/api/v1/projects/' + project.id + '/albums', {
    name: '海邊儀式・精選照片',
    requestId: randomUUID(),
  });
  await api('/api/v1/albums/' + album.id + '/activate', {
    requestId: randomUUID(),
    expectedRevision: album.revision,
    confirmActivate: true,
  });
  const jobs = new D1ImageProcessingRepository(db),
    objects = new R2ProcessingObjectStore(storage),
    processor = new LocalSharpImageProcessor();
  for (let i = 0; i < 8; i++) {
    phase = 'photo-' + (i + 1);
    const colors = [
      '#426f69',
      '#7f939e',
      '#ad8271',
      '#728971',
      '#697b98',
      '#aa946e',
      '#597d7e',
      '#987d8d',
    ];
    const bytes = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="' +
          colors[i] +
          '"/><circle cx="1100" cy="320" r="180" fill="#e9d7ab"/><path d="M0 800 Q400 300 850 850 T1600 700 V1200 H0" fill="#223e39"/><path d="M0 1000 Q500 700 900 1100 T1600 850 V1200 H0" fill="#acc2ac"/></svg>',
      ),
    )
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="3" xmp:Label="Red"/></rdf:RDF></x:xmpmeta>',
      )
      .jpeg()
      .toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const { uploadSession } = await api('/api/v1/uploads/init', {
      workspaceId: workspace.id,
      projectId: project.id,
      albumId: album.id,
      originalFilename:
        'KINO_REVIEW_' + String(i + 1).padStart(3, '0') + '.jpg',
      expectedBytes: bytes.byteLength,
      contentType: 'image/jpeg',
      sha256: hash,
      requestId: randomUUID(),
    });
    await api('/api/v1/uploads/' + uploadSession.id + '/authorize', {
      requestId: randomUUID(),
    });
    const row = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(uploadSession.id)
      .first();
    await storage.put(row.object_key, new Uint8Array(bytes), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/jpeg' },
      sha256: hash,
    });
    const { completion } = await api(
      '/api/v1/uploads/' + uploadSession.id + '/complete',
      { requestId: randomUUID() },
    );
    phase = 'process-' + (i + 1);
    const result = await runImageProcessingJob({
      jobId: completion.assetId,
      jobs,
      objects,
      processor,
    });
    if (result.status !== 'succeeded') {
      const row = await db
        .prepare(
          'SELECT status,reason_code FROM image_processing_jobs WHERE id=?',
        )
        .bind(completion.assetId)
        .first();
      throw new Error(
        'Processing ' + JSON.stringify({ result: result.status, ...row }),
      );
    }
  }
  phase = 'versioning-policy';
  await api(
    '/api/v1/projects/' + project.id + '/versioning',
    {
      requestId: randomUUID(),
      expectedRevision: project.revision,
      mode: 'manual',
      confirm: true,
    },
    'PUT',
  );
  const baseline = await db
    .prepare(
      'SELECT p.id,h.version_id,h.revision FROM photos p JOIN photo_version_heads h ON h.photo_id=p.id AND h.workspace_id=p.workspace_id WHERE p.album_id=? ORDER BY p.created_at,p.id LIMIT 1',
    )
    .bind(album.id)
    .first();
  const edit = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#d5b88d' },
  })
    .jpeg()
    .toBuffer();
  const editHash = createHash('sha256').update(edit).digest('hex');
  phase = 'retouch-version';
  const revised = await api(
    '/api/v1/photos/' + baseline.id + '/versions/init',
    {
      requestId: randomUUID(),
      originalFilename: 'KINO_REVIEW_EDIT.jpg',
      expectedBytes: edit.byteLength,
      contentType: 'image/jpeg',
      sha256: editHash,
      expectedRevision: baseline.revision,
      expectedCurrentVersionId: baseline.version_id,
      changeType: 'new_retouch',
      changeNote: '隔離驗收：暖色修圖版本',
      labels: ['驗收'],
      confirm: true,
    },
  );
  await api('/api/v1/uploads/' + revised.uploadSession.id + '/authorize', {
    requestId: randomUUID(),
  });
  const editRow = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(revised.uploadSession.id)
    .first();
  await storage.put(editRow.object_key, new Uint8Array(edit), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/jpeg' },
    sha256: editHash,
  });
  const completedEdit = await api(
    '/api/v1/uploads/' + revised.uploadSession.id + '/complete',
    { requestId: randomUUID() },
  );
  assert.equal(
    (
      await runImageProcessingJob({
        jobId: completedEdit.completion.assetId,
        jobs,
        objects,
        processor,
      })
    ).status,
    'succeeded',
  );
  phase = 'seed-verification';
  const counts = await db
    .prepare(
      "SELECT (SELECT count(*) FROM photos) photos,(SELECT count(*) FROM photo_assets) assets,(SELECT count(*) FROM image_processing_jobs WHERE status='succeeded') succeeded",
    )
    .first();
  assert.deepEqual({ ...counts }, { photos: 8, assets: 27, succeeded: 9 });
  await writeFile(
    join(root, '.local/studio-review-seed-proof.json'),
    JSON.stringify(
      {
        status: 'passed_isolated_real_api_seed',
        checkedAt: new Date().toISOString(),
        origin,
        workspaceId: workspace.id,
        projectId: project.id,
        albumId: album.id,
        migrations: files.length,
        ...counts,
        outbound: false,
        remoteCredentials: false,
        browserDirectUpload: false,
        comparisonPhotoId: baseline.id,
        readyVersions: 2,
      },
      null,
      2,
    ) + '\n',
  );
  const banner =
    '<style>body{padding-top:40px!important}.guest-album-header{top:40px!important}.studio-sidebar{top:40px;height:calc(100dvh - 40px)}.kino-photo-detail-overlay{top:40px}.kino-photo-detail-dialog{max-height:calc(100dvh - 56px)}#review-banner{position:fixed;z-index:2147483647;top:0;left:0;right:0;min-height:40px;padding:10px;background:#20312e;color:#f6f5f2;text-align:center;font:12px Arial;box-sizing:border-box}@media(max-width:760px){.studio-sidebar{top:0;height:auto}}.guest-studio [class~="fixed"][class~="inset-0"]{top:40px!important}</style><aside id="review-banner">本機真實 API 驗收・隔離測試資料・非雲端 OAuth</aside>';
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== host) {
        res.writeHead(421);
        res.end();
        return;
      }
      const url = new URL(req.url, origin);
      if (url.pathname === '/__review/login') {
        if (
          req.method !== 'GET' ||
          url.search ||
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers['sec-fetch-site'] === 'cross-site'
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.writeHead(302, {
          'Set-Cookie':
            cookie + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400',
          Location: '/dashboard',
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      if (
        ['GET', 'HEAD'].includes(req.method) &&
        (/^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname) ||
          url.pathname === '/' ||
          url.pathname === '/dashboard' ||
          url.pathname.startsWith('/dashboard/') ||
          url.pathname.startsWith('/guest/'))
      ) {
        const isAsset = url.pathname.startsWith('/assets/');
        try {
          const file = join(
            root,
            '.static',
            isAsset ? url.pathname.slice(1) : 'index.html',
          );
          const bytes = await readFile(file);
          const type = !isAsset
            ? 'text/html; charset=utf-8'
            : file.endsWith('.css')
              ? 'text/css'
              : file.endsWith('.svg')
                ? 'image/svg+xml'
                : 'application/javascript';
          res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(
            req.method === 'HEAD'
              ? undefined
              : isAsset
                ? bytes
                : bytes.toString('utf8').replace('<body>', '<body>' + banner),
          );
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }
      if (url.pathname.startsWith('/__review/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const headers = new Headers();
      for (const key of [
        'accept',
        'content-type',
        'cookie',
        'origin',
        'range',
        'if-none-match',
        'user-agent',
        'sec-fetch-site',
        'x-kino-expected-actor',
        'x-kino-expected-session',
        'x-kino-annotation-read-capabilities',
        'x-kino-history-generation',
      ])
        if (typeof req.headers[key] === 'string')
          headers.set(key, req.headers[key]);
      headers.set('CF-Connecting-IP', '127.0.0.1');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const upstream = await worker.fetch(
        new Request(origin + url.pathname + url.search, {
          method: req.method,
          headers,
          ...(body.length ? { body } : {}),
        }),
      );
      const outputHeaders = {};
      for (const [k, v] of upstream.headers)
        if (
          ![
            'set-cookie',
            'content-length',
            'content-encoding',
            'transfer-encoding',
            'connection',
          ].includes(k)
        )
          outputHeaders[k] = v;
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) outputHeaders['set-cookie'] = cookies;
      if (upstream.headers.get('content-type')?.includes('text/html')) {
        outputHeaders['cache-control'] = 'no-store';
        res.writeHead(upstream.status, outputHeaders);
        res.end((await upstream.text()).replace('<body>', '<body>' + banner));
      } else {
        res.writeHead(upstream.status, outputHeaders);
        if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
        else res.end();
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { code: 'LOCAL_REVIEW_UNAVAILABLE' } }),
        );
      } else res.destroy();
    }
  });
  server.listen(4180, '127.0.0.1', () =>
    console.log(
      JSON.stringify({
        status: 'ready',
        url: origin + '/__review/login',
        workspaceId: workspace.id,
        projectId: project.id,
        albumId: album.id,
        ...counts,
      }),
    ),
  );
  for (const event of ['SIGINT', 'SIGTERM'])
    process.once(event, () =>
      server.close(() => void mf.dispose().then(() => process.exit(0))),
    );
} catch (error) {
  const message = String(error?.message ?? 'error')
    .replace(/[a-f0-9]{32,}/gi, '[redacted]')
    .replaceAll(token, '[redacted]')
    .replaceAll(secret, '[redacted]');
  console.error(
    JSON.stringify({
      status: 'failed',
      phase,
      name: error?.name,
      message,
      frames: error?.stack?.split('\n').slice(1, 3),
    }),
  );
  await mf?.dispose();
  process.exitCode = 1;
}
