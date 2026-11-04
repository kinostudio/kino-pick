import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { test } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { projectOwnerHistoryDetails } from '../src/owner-history-projection';
import { photoPinRoutes } from '../src/photo-pin-routes';
import { D1GalleryRepository } from '../src/gallery';

const applyMigration = async (db: D1Database, source: string) =>
  db.batch(unstable_splitSqlQuery(source).map((sql) => db.prepare(sql)));

const uuid = () => randomUUID().toLowerCase();
const origin = 'http://127.0.0.1:8799';
const config = {
  APP_ENV: 'local',
  APP_URL: origin,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
};
type TestEnvironment = {
  Bindings: typeof config & { DB: D1Database };
  Variables: { ownerId: string; sessionId: string };
};
type TestApp = Hono<TestEnvironment>;
type ApiBody = {
  error?: { code: string };
  enabled?: boolean;
  photo?: {
    photoId: string;
    albumId: string;
    isPinned: boolean;
    revision: number;
  };
  changed?: boolean;
  eventId?: string | null;
  photos?: Array<{
    id: string;
    createdAt: string;
    isPinned?: boolean;
    pinRevision?: number;
  }>;
  nextCursor?: string | null;
};

test('photo pin Owner API, native D1 ledger, gallery projection, and cursor', async () => {
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'photo-pin-test',
          modules: true,
          script:
            'export default { fetch() { return new Response(null, { status: 404 }); } };',
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          bindings: config,
          d1Databases: { DB: 'photo-pin-test' },
        },
      ],
    }),
  );

  try {
    const db = await miniflare.getD1Database('DB', 'photo-pin-test');
    const migrationFiles = (await readdir(resolve('apps/worker/migrations')))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    assert.equal(migrationFiles.length, 60);
    assert.equal(migrationFiles.at(-1), '0060_photo_pins.sql');
    for (const migration of migrationFiles.slice(0, -1))
      await applyMigration(
        db,
        await readFile(resolve('apps/worker/migrations', migration), 'utf8'),
      );

    const ownerId = uuid();
    const otherActor = uuid();
    const sessionId = 'Opaque.Owner.Session.' + uuid();
    const workspaceId = uuid();
    const projectId = uuid();
    const albumId = uuid();
    const secondAlbumId = uuid();
    const requestWorkspaceId = uuid();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
      )
      .bind(ownerId, 'photo-pins-' + uuid())
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(sessionId, uuid(), ownerId, now + 3_600_000, now, now)
      .run();
    await db
      .prepare(
        'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
      )
      .bind(
        ownerId,
        requestWorkspaceId,
        sessionId,
        'Pin API fixture',
        workspaceId,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
      )
      .bind(projectId, workspaceId, 'Pin API fixture')
      .run();
    await db.batch([
      db
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Pin API fixture','active')",
        )
        .bind(albumId, workspaceId, projectId),
      db
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Other pin album','active')",
        )
        .bind(secondAlbumId, workspaceId, projectId),
    ]);

    // Two gallery records cover pinned-first ordering and the cross-group cursor boundary.
    const galleryPhotoIds = Array.from({ length: 2 }, uuid);
    const rollbackPhotoId = uuid();
    const versionIds = new Map<string, string>();
    const albumFor = (photoId: string) =>
      photoId === rollbackPhotoId ? secondAlbumId : albumId;
    for (let index = 0; index < galleryPhotoIds.length + 1; index++) {
      const photoId =
        index < galleryPhotoIds.length
          ? galleryPhotoIds[index]!
          : rollbackPhotoId;
      const versionId = uuid();
      versionIds.set(photoId, versionId);
      const photoAlbumId = albumFor(photoId);
      const createdAt = new Date(now + index * 1000).toISOString();
      await db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          photoId,
          workspaceId,
          projectId,
          photoAlbumId,
          `pin-${index + 1}.jpg`,
          createdAt,
        )
        .run();
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,?,?,17,'image/jpeg',1,1,'private')",
        )
        .bind(versionId, workspaceId, photoId, ownerId, 'b'.repeat(64))
        .run();
      const objectKey = `${workspaceId}/${projectId}/${photoAlbumId}/${photoId}/original`;
      await db
        .prepare(
          `INSERT INTO photo_assets(
            id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,
            object_key,byte_size,mime,checksum_sha256,state
          ) VALUES(?,?,?,?,?,'original',?,17,'image/jpeg',?,'private')`,
        )
        .bind(
          uuid(),
          workspaceId,
          photoId,
          versionId,
          'primary',
          objectKey,
          'b'.repeat(64),
        )
        .run();
    }
    // Upgrade populated 0059 data; every existing row and schema object must survive.
    type SchemaRow = {
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    };
    const oldSchema: SchemaRow[] = (
      await db
        .prepare(
          'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',
        )
        .all()
    ).results;
    const oldTables = oldSchema
      .filter((row) => row.type === 'table' && row.name !== '_cf_METADATA')
      .map((row) => String(row.name));
    const snapshotRows = async () =>
      Promise.all(
        oldTables.map(async (name) => {
          const quoted = '"' + name.replaceAll('"', '""') + '"';
          const rows: Record<string, unknown>[] = (
            await db.prepare('SELECT * FROM ' + quoted).all()
          ).results;
          return rows.map((row) => JSON.stringify(row)).sort();
        }),
      );
    const beforeUpgrade = await snapshotRows();
    await applyMigration(
      db,
      await readFile(
        resolve('apps/worker/migrations/0060_photo_pins.sql'),
        'utf8',
      ),
    );
    assert.deepEqual(await snapshotRows(), beforeUpgrade);
    const afterSchema: SchemaRow[] = (
      await db
        .prepare(
          'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',
        )
        .all()
    ).results;
    assert.deepEqual(
      afterSchema.filter((row) =>
        oldSchema.some((old) => old.type === row.type && old.name === row.name),
      ),
      oldSchema,
    );
    assert.deepEqual(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
      [],
    );
    const photoId = galleryPhotoIds[0]!;

    const makeApi = (actor: string, session: string) => {
      const app = new Hono<TestEnvironment>();
      app.use('*', async (c, next) => {
        c.set('ownerId', actor);
        c.set('sessionId', session);
        await next();
      });
      app.get('/api/v1/albums/:albumId/photos', async (c) => {
        try {
          const query = new URL(c.req.url).searchParams;
          if (
            [...query.keys()].some((key) => key !== 'cursor') ||
            query.getAll('cursor').length > 1
          )
            return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
          return c.json(
            await new D1GalleryRepository(
              c.env.DB,
              c.get('ownerId'),
              c.get('sessionId'),
            ).list(c.req.param('albumId'), query.get('cursor') ?? undefined),
          );
        } catch {
          return c.json({ error: { code: 'GALLERY_UNAVAILABLE' } }, 503);
        }
      });
      app.route('/', photoPinRoutes);
      return app;
    };
    const ownerApi = makeApi(ownerId, sessionId);
    const env = { DB: db, ...config };
    const context = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;
    const request = async (
      app: TestApp,
      path: string,
      method = 'GET',
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await app.fetch(
        new Request(origin + path, {
          method,
          headers: {
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
        context,
      );
      return { response, value: (await response.json()) as ApiBody };
    };
    const setPin = (target: string, body: unknown, extraHeaders = {}) =>
      request(ownerApi, `/api/v1/photos/${target}/pin`, 'PUT', body, {
        Origin: origin,
        'X-Kino-Expected-Actor': ownerId,
        'X-Kino-Expected-Session': sessionId,
        ...extraHeaders,
      });
    const countForRequest = async (table: string, reqId: string) =>
      Number(
        (
          await db
            .prepare(
              `SELECT count(*) AS n FROM ${table} WHERE ${table === 'photo_pin_commands' ? 'actor_id=? AND request_id=?' : 'command_id IN (SELECT id FROM photo_pin_commands WHERE actor_id=? AND request_id=?)'}`,
            )
            .bind(ownerId, reqId)
            .first()
        ).n,
      );

    const capability = await request(
      ownerApi,
      '/api/v1/photo-pins/capabilities',
    );
    assert.equal(capability.response.status, 200);
    assert.deepEqual(capability.value, { enabled: true });

    const invalidOrigin = await setPin(
      photoId,
      { requestId: uuid(), expectedRevision: 0, isPinned: true },
      { Origin: 'https://attacker.invalid' },
    );
    assert.equal(invalidOrigin.response.status, 403);
    assert.equal(invalidOrigin.value.error?.code, 'FORBIDDEN_ORIGIN');
    const changedIdentity = await setPin(
      photoId,
      { requestId: uuid(), expectedRevision: 0, isPinned: true },
      { 'X-Kino-Expected-Actor': otherActor },
    );
    assert.equal(changedIdentity.response.status, 409);
    assert.equal(changedIdentity.value.error?.code, 'OWNER_IDENTITY_CHANGED');
    const noSession = await request(
      makeApi(otherActor, sessionId),
      `/api/v1/photos/${photoId}/pin`,
      'PUT',
      { requestId: uuid(), expectedRevision: 0, isPinned: true },
      {
        Origin: origin,
        'X-Kino-Expected-Actor': otherActor,
        'X-Kino-Expected-Session': sessionId,
      },
    );
    assert.equal(noSession.response.status, 403);
    assert.equal(noSession.value.error?.code, 'OWNER_REQUIRED');

    const absentPhoto = await setPin(uuid(), {
      requestId: uuid(),
      expectedRevision: 0,
      isPinned: true,
    });
    assert.equal(absentPhoto.response.status, 404);
    assert.equal(absentPhoto.value.error?.code, 'NOT_FOUND');
    const invalidContentType = await request(
      ownerApi,
      `/api/v1/photos/${photoId}/pin`,
      'PUT',
      { requestId: uuid(), expectedRevision: 0, isPinned: true },
      {
        Origin: origin,
        'Content-Type': 'text/plain',
        'X-Kino-Expected-Actor': ownerId,
        'X-Kino-Expected-Session': sessionId,
      },
    );
    assert.equal(invalidContentType.response.status, 400);
    const invalidQuery = await request(
      ownerApi,
      `/api/v1/photos/${photoId}/pin?debug=1`,
      'PUT',
      { requestId: uuid(), expectedRevision: 0, isPinned: true },
      {
        Origin: origin,
        'X-Kino-Expected-Actor': ownerId,
        'X-Kino-Expected-Session': sessionId,
      },
    );
    assert.equal(invalidQuery.response.status, 400);

    const badScopeRequestId = uuid();
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO photo_pin_commands(
            id,actor_id,session_id,request_id,workspace_id,project_id,album_id,
            photo_id,expected_revision,is_pinned,created_at_ms
          ) VALUES(?,?,?,?,?,?,?,?,0,1,?)`,
        )
        .bind(
          uuid(),
          ownerId,
          sessionId,
          badScopeRequestId,
          workspaceId,
          uuid(),
          albumId,
          photoId,
          Date.now(),
        )
        .run(),
      /NOT_FOUND/u,
    );
    assert.equal(
      await countForRequest('photo_pin_commands', badScopeRequestId),
      0,
    );
    const badAlbumRequestId = uuid();
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO photo_pin_commands(
            id,actor_id,session_id,request_id,workspace_id,project_id,album_id,
            photo_id,expected_revision,is_pinned,created_at_ms
          ) VALUES(?,?,?,?,?,?,?,?,0,1,?)`,
        )
        .bind(
          uuid(),
          ownerId,
          sessionId,
          badAlbumRequestId,
          workspaceId,
          projectId,
          secondAlbumId,
          photoId,
          Date.now(),
        )
        .run(),
      /NOT_FOUND/u,
    );
    assert.equal(
      await countForRequest('photo_pin_commands', badAlbumRequestId),
      0,
    );
    const duplicateRequestId = requestWorkspaceId;
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO photo_pin_commands(
            id,actor_id,session_id,request_id,workspace_id,project_id,album_id,
            photo_id,expected_revision,is_pinned,created_at_ms
          ) VALUES(?,?,?,?,?,?,?,?,0,1,?)`,
        )
        .bind(
          uuid(),
          ownerId,
          sessionId,
          duplicateRequestId,
          workspaceId,
          projectId,
          albumId,
          photoId,
          Date.now(),
        )
        .run(),
      /REQUEST_ID_CONFLICT/u,
    );
    assert.equal(
      await countForRequest('photo_pin_commands', duplicateRequestId),
      0,
    );

    const noOpRequestId = uuid();
    const noOpBody = {
      requestId: noOpRequestId,
      expectedRevision: 0,
      isPinned: false,
    };
    const noOp = await setPin(photoId, noOpBody);
    assert.equal(noOp.response.status, 200);
    assert.deepEqual(noOp.value, {
      photo: { photoId, albumId, isPinned: false, revision: 0 },
      changed: false,
      eventId: null,
    });
    const noOpReplay = await setPin(photoId, noOpBody);
    assert.deepEqual(noOpReplay.value, noOp.value);
    const noOpProjection = await db
      .prepare('SELECT photo_id FROM photo_pin_states WHERE photo_id=?')
      .bind(photoId)
      .first();
    assert.equal(noOpProjection, null);
    assert.equal(await countForRequest('photo_pin_results', noOpRequestId), 1);

    const pinRequestId = uuid();
    const pinBody = {
      requestId: pinRequestId,
      expectedRevision: 0,
      isPinned: true,
    };
    const pin = await setPin(photoId, pinBody);
    assert.equal(pin.response.status, 200);
    assert.deepEqual(pin.value.photo, {
      photoId,
      albumId,
      isPinned: true,
      revision: 1,
    });
    assert.equal(pin.value.changed, true);
    const replay = await setPin(photoId, pinBody);
    assert.deepEqual(replay.value, pin.value);
    const conflict = await setPin(photoId, { ...pinBody, isPinned: false });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.value.error?.code, 'REQUEST_ID_CONFLICT');

    const pageResponse = await request(
      ownerApi,
      `/api/v1/albums/${albumId}/photos`,
    );
    assert.equal(pageResponse.response.status, 200);
    const firstPage = pageResponse.value as {
      photos: Array<{
        id: string;
        createdAt: string;
        isPinned?: boolean;
        pinRevision?: number;
      }>;
      nextCursor: string | null;
    };
    assert.equal(firstPage.photos.length, 2);
    assert.equal(firstPage.photos[0]?.id, photoId);
    assert.equal(firstPage.photos[0]?.isPinned, true);
    assert.equal(firstPage.photos[0]?.pinRevision, 1);
    assert.equal(firstPage.nextCursor, null);
    const pinBoundaryCursor = Buffer.from(
      JSON.stringify({
        createdAt: firstPage.photos[0]!.createdAt,
        id: firstPage.photos[0]!.id,
        isPinned: firstPage.photos[0]!.isPinned,
      }),
      'utf8',
    ).toString('base64url');
    const secondPageResponse = await request(
      ownerApi,
      `/api/v1/albums/${albumId}/photos?cursor=${encodeURIComponent(pinBoundaryCursor)}`,
    );
    assert.equal(secondPageResponse.response.status, 200);
    const secondPage = secondPageResponse.value as typeof firstPage;
    assert.equal(secondPage.photos.length, 1);
    const seen = [...firstPage.photos, ...secondPage.photos].map(
      (item) => item.id,
    );
    assert.equal(new Set(seen).size, galleryPhotoIds.length);
    assert.deepEqual(new Set(seen), new Set(galleryPhotoIds));

    const stale = await setPin(photoId, {
      requestId: uuid(),
      expectedRevision: 0,
      isPinned: false,
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.value.error?.code, 'PHOTO_PIN_REVISION_CONFLICT');
    const unpinRequestId = uuid();
    const unpin = await setPin(photoId, {
      requestId: unpinRequestId,
      expectedRevision: 1,
      isPinned: false,
    });
    assert.equal(unpin.response.status, 200);
    assert.deepEqual(unpin.value.photo, {
      photoId,
      albumId,
      isPinned: false,
      revision: 2,
    });
    const afterUnpin = await request(
      ownerApi,
      `/api/v1/albums/${albumId}/photos`,
    );
    const unpinnedPage = afterUnpin.value as typeof firstPage;
    const unpinnedTarget = unpinnedPage.photos.find(
      (item) => item.id === photoId,
    );
    assert.equal(unpinnedTarget?.isPinned, false);
    assert.equal(unpinnedTarget?.pinRevision, 2);

    const eventRows = (
      await db
        .prepare(
          `SELECT action,before_json,after_json,event_id FROM audit_events
            WHERE photo_id=? AND action IN('photo.pinned','photo.unpinned')
            ORDER BY rowid`,
        )
        .bind(photoId)
        .all()
    ).results;
    assert.equal(eventRows.length, 2);
    assert.equal(eventRows[0]?.action, 'photo.pinned');
    assert.equal(eventRows[1]?.action, 'photo.unpinned');
    assert.equal(
      projectOwnerHistoryDetails(
        String(eventRows[0]?.action),
        String(eventRows[0]?.before_json),
        String(eventRows[0]?.after_json),
      ).status,
      'available',
    );
    const ownerHistoryUi = await readFile(
      resolve('apps/web/target-ui/owner-history.tsx'),
      'utf8',
    );
    assert.match(ownerHistoryUi, /'photo\.pinned': '置頂照片'/u);
    assert.match(ownerHistoryUi, /'photo\.unpinned': '取消照片置頂'/u);
    assert.equal(
      projectOwnerHistoryDetails(
        String(eventRows[1]?.action),
        String(eventRows[1]?.before_json),
        String(eventRows[1]?.after_json),
      ).status,
      'available',
    );

    const expiredSessionId = 'expired.' + uuid();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(expiredSessionId, uuid(), ownerId, Date.now() - 1, now, now)
      .run();
    const expiredReq = uuid();
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO photo_pin_commands(
            id,actor_id,session_id,request_id,workspace_id,project_id,album_id,
            photo_id,expected_revision,is_pinned,created_at_ms
          ) VALUES(?,?,?,?,?,?,?,?,0,1,?)`,
        )
        .bind(
          uuid(),
          ownerId,
          expiredSessionId,
          expiredReq,
          workspaceId,
          projectId,
          albumId,
          photoId,
          Date.now(),
        )
        .run(),
      /OWNER_REQUIRED/u,
    );
    assert.equal(await countForRequest('photo_pin_commands', expiredReq), 0);

    const rollbackReq = uuid();
    await applyMigration(
      db,
      `CREATE TRIGGER photo_pin_test_abort_audit BEFORE INSERT ON audit_events
        WHEN NEW.action='photo.pinned'
        BEGIN SELECT RAISE(ABORT,'INJECTED_PHOTO_PIN_AUDIT_FAILURE'); END;`,
    );
    try {
      const failed = await setPin(rollbackPhotoId, {
        requestId: rollbackReq,
        expectedRevision: 0,
        isPinned: true,
      });
      assert.equal(failed.response.status, 503);
      assert.equal(failed.value.error?.code, 'PHOTO_PINS_UNAVAILABLE');
      assert.equal(await countForRequest('photo_pin_commands', rollbackReq), 0);
      assert.equal(await countForRequest('photo_pin_results', rollbackReq), 0);
      const rollbackState = await db
        .prepare('SELECT photo_id FROM photo_pin_states WHERE photo_id=?')
        .bind(rollbackPhotoId)
        .first();
      assert.equal(rollbackState, null);
    } finally {
      await db.exec('DROP TRIGGER photo_pin_test_abort_audit');
    }
    const retry = await setPin(rollbackPhotoId, {
      requestId: rollbackReq,
      expectedRevision: 0,
      isPinned: true,
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.value.photo?.isPinned, true);

    const command = await db
      .prepare(
        'SELECT c.id,r.event_id FROM photo_pin_commands c JOIN photo_pin_results r ON r.command_id=c.id WHERE c.request_id=?',
      )
      .bind(pinRequestId)
      .first();
    assert.ok(command?.id && command?.event_id);
    await assert.rejects(
      db
        .prepare('UPDATE photo_pin_commands SET is_pinned=0 WHERE id=?')
        .bind(command.id)
        .run(),
      /APPEND_ONLY_PHOTO_PIN_COMMAND/u,
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM photo_pin_commands WHERE id=?')
        .bind(command.id)
        .run(),
      /APPEND_ONLY_PHOTO_PIN_COMMAND/u,
    );
    await assert.rejects(
      db
        .prepare('UPDATE photo_pin_results SET changed=0 WHERE command_id=?')
        .bind(command.id)
        .run(),
      /APPEND_ONLY_PHOTO_PIN_RESULT/u,
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM photo_pin_results WHERE command_id=?')
        .bind(command.id)
        .run(),
      /APPEND_ONLY_PHOTO_PIN_RESULT/u,
    );
    await assert.rejects(
      db
        .prepare('UPDATE photo_pin_states SET revision=0 WHERE photo_id=?')
        .bind(photoId)
        .run(),
      /PHOTO_PIN_COMMAND_REQUIRED/u,
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM photo_pin_states WHERE photo_id=?')
        .bind(photoId)
        .run(),
      /APPEND_ONLY_PHOTO_PIN_STATE/u,
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM audit_events WHERE event_id=?')
        .bind(command.event_id)
        .run(),
      /APPEND_ONLY_AUDIT/u,
    );

    // In an older 0059-compatible schema, a stale cursor may still contain
    // the 0060 pin group. The fallback must ignore that group and advance by
    // the legacy date/UUID ordering rather than restarting the gallery.
    const secondPin = await setPin(galleryPhotoIds[1]!, {
      requestId: uuid(),
      expectedRevision: 0,
      isPinned: true,
    });
    assert.equal(secondPin.response.status, 200);
    const legacyCursor = Buffer.from(
      JSON.stringify({
        createdAt: new Date(now + 1000).toISOString(),
        id: galleryPhotoIds[1],
        isPinned: true,
      }),
      'utf8',
    ).toString('base64url');
    await db.exec('DROP TABLE photo_pin_states');
    const legacyCompatiblePage = await request(
      ownerApi,
      `/api/v1/albums/${albumId}/photos?cursor=${encodeURIComponent(legacyCursor)}`,
    );
    assert.equal(
      legacyCompatiblePage.response.status,
      200,
      JSON.stringify(legacyCompatiblePage.value),
    );
    const legacyPhotos = (
      legacyCompatiblePage.value as { photos: Array<{ id: string }> }
    ).photos;
    assert.equal(legacyPhotos.length, 1);
    assert.equal(legacyPhotos[0]?.id, galleryPhotoIds[0]);
    assert.equal('isPinned' in legacyPhotos[0]!, false);
    const digest = async (path: string) =>
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    await mkdir('apps/worker/.local', { recursive: true });
    await writeFile(
      'apps/worker/.local/photo-pins-upgrade-proof.json',
      JSON.stringify(
        {
          status: 'passed_native_populated_0059_to_0060',
          sourceSchemaVersion: 59,
          targetSchemaVersion: 60,
          oldTablesPreserved: oldTables.length,
          foreignKeyViolations: 0,
          runnerSha256: await digest(
            'apps/worker/tests/photo-pins-api.test.ts',
          ),
          migration60Sha256: createHash('sha256')
            .update(
              (
                await readFile(
                  'apps/worker/migrations/0060_photo_pins.sql',
                  'utf8',
                )
              ).replaceAll('\r\n', '\n'),
            )
            .digest('hex'),
          remoteCloudflare: false,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await miniflare.dispose();
  }
});
