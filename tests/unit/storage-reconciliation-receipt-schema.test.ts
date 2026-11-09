import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve('apps/worker/migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
const proposalPath = resolve(
  'apps/worker/migration-proposals/0070_storage_reconciliation.sql',
);
const proposal = readFileSync(proposalPath, 'utf8');
const maxSafeInteger = 9_007_199_254_740_991;

type Fixture = {
  db: DatabaseSync;
  actor: string;
  session: string;
  workspace: string;
};

type ReceiptValues = {
  id: string;
  workspace_id: string;
  storage_node_id: string;
  actor_id: string;
  session_id: string;
  epoch: number;
  inventory_revision: string;
  object_count: number;
  confirmed_bytes: number;
  pages: number;
  started_at_ms: number;
  completed_at_ms?: number;
};

function nowMs(db: DatabaseSync): number {
  return (
    db
      .prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms")
      .get() as { now_ms: number }
  ).now_ms;
}

function epoch(db: DatabaseSync): number {
  return (
    db
      .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
      .get() as {
      epoch: number;
    }
  ).epoch;
}

function fixture(): Fixture {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationFiles)
    db.exec(readFileSync(resolve(migrationDirectory, name), 'utf8'));
  db.exec(proposal);

  // These are the existing bootstrap and workspace command paths; identity/session IDs are not UUID contracts.
  const actor = 'owner-better-auth-subject';
  const session = 'owner-session-from-better-auth';
  const workspace = randomUUID();
  db.prepare(
    'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
  ).run(actor, 'github-subject-for-reconciliation');
  const now = Date.now();
  db.prepare(
    'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
  ).run(session, randomUUID(), actor, now + 3_600_000, now, now);
  db.prepare(
    'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
  ).run(actor, randomUUID(), session, 'Receipt schema fixture', workspace);
  return { db, actor, session, workspace };
}

function receiptValues(f: Fixture): ReceiptValues {
  return {
    id: randomUUID(),
    workspace_id: f.workspace,
    storage_node_id: 'primary',
    actor_id: f.actor,
    session_id: f.session,
    epoch: epoch(f.db),
    inventory_revision: 'a'.repeat(64),
    object_count: 0,
    confirmed_bytes: 0,
    pages: 1,
    started_at_ms: nowMs(f.db) - 1_000,
  };
}

function insertReceipt(
  f: Fixture,
  overrides: Partial<ReceiptValues> = {},
  conflict: '' | ' OR REPLACE' | ' OR IGNORE' = '',
) {
  const values = { ...receiptValues(f), ...overrides };
  const entries = Object.entries(values).filter(
    (entry) => entry[1] !== undefined,
  );
  const columns = entries.map(([column]) => column).join(',');
  const placeholders = entries.map(() => '?').join(',');
  return f.db
    .prepare(
      `INSERT${conflict} INTO storage_reconciliation_receipts(${columns}) VALUES(${placeholders})`,
    )
    .run(...(entries.map(([, value]) => value) as SQLInputValue[]));
}

function createAlbum(f: Fixture) {
  const project = randomUUID();
  const album = randomUUID();
  f.db
    .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
    .run(project, f.workspace, 'Receipt fixture project');
  f.db
    .prepare(
      'INSERT INTO albums(id,workspace_id,project_id,name) VALUES(?,?,?,?)',
    )
    .run(album, f.workspace, project, 'Receipt fixture album');
  return { project, album };
}

function createAsset(
  f: Fixture,
  bytes = 100,
  assetKind: 'original' | 'preview' = 'preview',
) {
  const { project, album } = createAlbum(f);
  const photo = randomUUID();
  const version = randomUUID();
  const asset = randomUUID();
  const key = `${f.workspace}/${project}/${album}/${photo}/original`;
  const checksum = 'b'.repeat(64);
  f.db
    .prepare(
      'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
    )
    .run(photo, f.workspace, project, album, 'source.jpg');
  f.db
    .prepare(
      'INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,?,?,?,?,?,1,1,?)',
    )
    .run(
      version,
      f.workspace,
      photo,
      1,
      f.actor,
      checksum,
      bytes,
      'image/jpeg',
      'current',
    );
  f.db
    .prepare(
      'INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      asset,
      f.workspace,
      photo,
      version,
      'primary',
      assetKind,
      key,
      bytes,
      'image/jpeg',
      checksum,
      'private',
    );
  f.db
    .prepare("UPDATE storage_nodes SET used_bytes=? WHERE id='primary'")
    .run(bytes);
  f.db
    .prepare(
      'UPDATE workspace_storage_usage SET used_bytes=? WHERE workspace_id=?',
    )
    .run(bytes, f.workspace);
  return { project, album, photo, version, asset, key, checksum, bytes };
}

function reserveUpload(f: Fixture) {
  const { project, album } = createAlbum(f);
  const uploadSession = randomUUID();
  const request = randomUUID();
  const now = Date.now();
  const key = `${f.workspace}/${project}/${album}/${uploadSession}/original`;
  f.db
    .prepare(
      `INSERT INTO upload_requests(
        actor_id,request_id,operation,payload_json,session_id,upload_session_id,
        workspace_id,project_id,album_id,storage_node_id,object_key,
        original_filename,expected_bytes,created_at_ms
      ) VALUES(?,?,'upload.reserved',?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      f.actor,
      request,
      JSON.stringify({
        workspaceId: f.workspace,
        projectId: project,
        albumId: album,
        originalFilename: 'pending.jpg',
        expectedBytes: 1,
        contentType: 'image/jpeg',
        sha256: 'c'.repeat(64),
      }),
      f.session,
      uploadSession,
      f.workspace,
      project,
      album,
      'primary',
      key,
      'pending.jpg',
      1,
      now,
    );
  return { uploadSession, request, key, project, album };
}

describe('0070 storage reconciliation receipt proposal', () => {
  it('stays proposal-only and installs all 48 source invalidators on schema 69', () => {
    expect(migrationFiles).toHaveLength(69);
    expect(migrationFiles.at(-1)).toBe('0069_inherited_share_expiry.sql');
    const db = new DatabaseSync(':memory:');
    try {
      for (const name of migrationFiles)
        db.exec(readFileSync(resolve(migrationDirectory, name), 'utf8'));
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN('storage_inventory_clock','storage_reconciliation_receipts')",
          )
          .get(),
      ).toEqual({ n: 0 });
      db.exec(proposal);
      expect(
        db.prepare('SELECT id,epoch FROM storage_inventory_clock').all(),
      ).toEqual([{ id: 1, epoch: 0 }]);

      const sourceTables = [
        'owners',
        'owner_sessions',
        'workspaces',
        'storage_nodes',
        'workspace_storage_usage',
        'photo_assets',
        'photos',
        'manual_album_deletion_jobs',
        'manual_album_deletion_items',
        'upload_sessions',
        'upload_key_fences',
        'upload_authorizations',
        'image_processing_jobs',
        'storage_reservations',
        'upload_completions',
        'upload_version_completions',
      ];
      const actual = db
        .prepare(
          "SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' AND name LIKE 'storage_inventory_clock_%'",
        )
        .all() as Array<{ name: string; tbl_name: string; sql: string }>;
      expect(actual).toHaveLength(51);
      for (const table of sourceTables)
        for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
          const trigger = actual.find(
            (item) =>
              item.tbl_name === table &&
              item.sql.includes(`AFTER ${operation}`),
          );
          expect(trigger, `${table} ${operation} invalidator`).toBeDefined();
          expect(trigger?.sql).toContain(
            'UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1',
          );
        }
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'storage_inventory_clock_%' AND tbl_name IN('storage_reconciliation_receipts','audit_events')",
          )
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }

    const f = fixture();
    try {
      const afterCommands = epoch(f.db);
      expect(afterCommands).toBeGreaterThan(0);
      f.db
        .prepare('UPDATE owner_sessions SET expiresAt=expiresAt+1 WHERE id=?')
        .run(f.session);
      expect(epoch(f.db)).toBe(afterCommands + 1);
      f.db
        .prepare(
          "UPDATE storage_nodes SET priority=priority+1 WHERE id='primary'",
        )
        .run();
      expect(epoch(f.db)).toBe(afterCommands + 2);
    } finally {
      f.db.close();
    }
  }, 30_000);

  it('accepts a real empty primary receipt, audits safe metadata, and stays immutable', () => {
    const f = fixture();
    try {
      const before = epoch(f.db);
      const values = receiptValues(f);
      insertReceipt(f, values);
      expect(epoch(f.db)).toBe(before);
      expect(
        f.db
          .prepare(
            'SELECT id,workspace_id,storage_node_id,actor_id,session_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms,completed_at_ms FROM storage_reconciliation_receipts',
          )
          .get(),
      ).toMatchObject({
        ...values,
        completed_at_ms: expect.any(Number),
      });
      expect(
        f.db
          .prepare('PRAGMA foreign_key_list(storage_reconciliation_receipts)')
          .all(),
      ).toEqual([]);
      const audit = f.db
        .prepare(
          "SELECT actor_type,actor_id,session_id,workspace_id,action,after_json,request_id FROM audit_events WHERE action='storage.reconciled'",
        )
        .get() as {
        actor_type: string;
        actor_id: string;
        session_id: string;
        workspace_id: string;
        action: string;
        after_json: string;
        request_id: string;
      };
      expect(audit).toMatchObject({
        actor_type: 'user',
        actor_id: f.actor,
        session_id: f.session,
        workspace_id: f.workspace,
        action: 'storage.reconciled',
        request_id: values.id,
      });
      expect(Object.keys(JSON.parse(audit.after_json))).toEqual([
        'storageNodeId',
        'epoch',
        'inventoryRevision',
        'objectCount',
        'confirmedBytes',
        'pages',
        'startedAtMs',
        'completedAtMs',
      ]);

      expect(() =>
        f.db
          .prepare(
            'UPDATE storage_reconciliation_receipts SET epoch=epoch WHERE id=?',
          )
          .run(values.id),
      ).toThrow('STORAGE_RECONCILIATION_RECEIPT_IMMUTABLE');
      expect(() =>
        f.db
          .prepare('DELETE FROM storage_reconciliation_receipts WHERE id=?')
          .run(values.id),
      ).toThrow('STORAGE_RECONCILIATION_RECEIPT_IMMUTABLE');
      expect(() => insertReceipt(f, values, ' OR REPLACE')).toThrow(
        'STORAGE_RECONCILIATION_RECEIPT_IMMUTABLE',
      );
      expect(() =>
        f.db
          .prepare(
            `INSERT OR REPLACE INTO storage_reconciliation_receipts(
              rowid,id,workspace_id,storage_node_id,actor_id,session_id,epoch,
              inventory_revision,object_count,confirmed_bytes,pages,started_at_ms
            ) VALUES(1,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            values.id,
            values.workspace_id,
            values.storage_node_id,
            values.actor_id,
            values.session_id,
            values.epoch,
            values.inventory_revision,
            values.object_count,
            values.confirmed_bytes,
            values.pages,
            values.started_at_ms,
          ),
      ).toThrow();
      expect(
        f.db
          .prepare('SELECT count(*) AS n FROM storage_reconciliation_receipts')
          .get(),
      ).toEqual({ n: 1 });
      expect(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='storage.reconciled'",
          )
          .get(),
      ).toEqual({ n: 1 });

      f.db.prepare('DELETE FROM owner_sessions WHERE id=?').run(f.session);
      expect(
        f.db
          .prepare(
            'SELECT session_id FROM storage_reconciliation_receipts WHERE id=?',
          )
          .get(values.id),
      ).toEqual({ session_id: f.session });
    } finally {
      f.db.close();
    }
  }, 30_000);

  it('checks the counted objects and projected physical bytes against D1', () => {
    const f = fixture();
    try {
      const object = createAsset(f);
      const values = receiptValues(f);
      expect(() =>
        insertReceipt(f, {
          ...values,
          object_count: 1,
          confirmed_bytes: object.bytes,
        }),
      ).not.toThrow();
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          object_count: 0,
          confirmed_bytes: 0,
        }),
      ).toThrow('STORAGE_RECONCILIATION_INVENTORY_MISMATCH');
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          object_count: 1,
          confirmed_bytes: object.bytes + 1,
        }),
      ).toThrow('STORAGE_RECONCILIATION_INVENTORY_MISMATCH');
    } finally {
      f.db.close();
    }
  }, 30_000);

  it('rejects reservations, live upload grants, queued processing, and deleting jobs', () => {
    const reserved = fixture();
    try {
      reserved.db
        .prepare("UPDATE storage_nodes SET reserved_bytes=1 WHERE id='primary'")
        .run();
      expect(() => insertReceipt(reserved)).toThrow(
        'STORAGE_RECONCILIATION_PENDING',
      );
      reserved.db
        .prepare("UPDATE storage_nodes SET reserved_bytes=0 WHERE id='primary'")
        .run();
      reserved.db
        .prepare(
          'UPDATE workspace_storage_usage SET reserved_bytes=1 WHERE workspace_id=?',
        )
        .run(reserved.workspace);
      expect(() => insertReceipt(reserved)).toThrow(
        'STORAGE_RECONCILIATION_PENDING',
      );
    } finally {
      reserved.db.close();
    }

    const reservation = fixture();
    try {
      reserveUpload(reservation);
      reservation.db
        .prepare("UPDATE storage_nodes SET reserved_bytes=0 WHERE id='primary'")
        .run();
      reservation.db
        .prepare(
          'UPDATE workspace_storage_usage SET reserved_bytes=0 WHERE workspace_id=?',
        )
        .run(reservation.workspace);
      expect(
        reservation.db
          .prepare(
            'SELECT count(*) AS n FROM pending_upload_storage_reservations',
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(() => insertReceipt(reservation)).toThrow(
        'STORAGE_RECONCILIATION_PENDING',
      );
    } finally {
      reservation.db.close();
    }

    const authorization = fixture();
    try {
      const { uploadSession, key, project, album } =
        reserveUpload(authorization);
      const now = Date.now();
      authorization.db
        .prepare(
          'INSERT INTO upload_authorizations(upload_session_id,actor_id,request_id,session_id,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          uploadSession,
          authorization.actor,
          randomUUID(),
          authorization.session,
          now,
          now + 60_000,
          'image/jpeg',
          'c'.repeat(64),
        );
      const cancelRequest = randomUUID();
      const cancelPayload = JSON.stringify({ uploadSessionId: uploadSession });
      authorization.db
        .prepare(
          `INSERT INTO owner_external_intents(
            actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,
            upload_session_id,storage_node_id,original_object_key,payload_json,created_at_ms
          ) VALUES(?,?,'upload.cancelled',?,?,?,?,?,'primary',?,?,?)`,
        )
        .run(
          authorization.actor,
          cancelRequest,
          authorization.session,
          authorization.workspace,
          project,
          album,
          uploadSession,
          key,
          cancelPayload,
          now,
        );
      authorization.db
        .prepare(
          `INSERT INTO upload_key_fences(
            upload_session_id,object_key,reason,actor_type,actor_id,session_id,
            request_id,occurred_at_ms
          ) VALUES(?,?,'cancel','user',?,?,?,?)`,
        )
        .run(
          uploadSession,
          key,
          authorization.actor,
          authorization.session,
          cancelRequest,
          now,
        );
      authorization.db
        .prepare(
          `INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms)
           VALUES(?,?,'upload.cancelled',?,?,?,?)`,
        )
        .run(
          authorization.actor,
          cancelRequest,
          cancelPayload,
          authorization.session,
          uploadSession,
          now,
        );
      expect(
        authorization.db
          .prepare(
            'SELECT count(*) AS n FROM pending_upload_storage_reservations',
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(() => insertReceipt(authorization)).toThrow(
        'STORAGE_RECONCILIATION_PENDING',
      );
    } finally {
      authorization.db.close();
    }

    const processing = fixture();
    try {
      const object = createAsset(processing, 100, 'original');
      expect(
        processing.db
          .prepare('SELECT status FROM image_processing_jobs WHERE id=?')
          .get(object.asset),
      ).toEqual({ status: 'queued' });
      expect(() =>
        insertReceipt(processing, {
          ...receiptValues(processing),
          object_count: 1,
          confirmed_bytes: object.bytes,
        }),
      ).toThrow('STORAGE_RECONCILIATION_PENDING');
    } finally {
      processing.db.close();
    }

    const deleting = fixture();
    try {
      const object = createAsset(deleting);
      deleting.db
        .prepare(
          `INSERT INTO manual_album_deletion_jobs(
            id,actor_id,session_id,request_id,workspace_id,project_id,album_id,
            expected_revision,confirmation_name,policy_snapshot,created_at_ms,
            inventory_count,bytes_before,status
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'deleting')`,
        )
        .run(
          randomUUID(),
          deleting.actor,
          deleting.session,
          randomUUID(),
          deleting.workspace,
          object.project,
          object.album,
          1,
          'Receipt fixture album',
          JSON.stringify({
            reason: 'manual',
            graceHours: 0,
            minimumRetentionDays: 0,
            confirmed: true,
          }),
          Date.now(),
          1,
          object.bytes,
        );
      expect(() =>
        insertReceipt(deleting, {
          ...receiptValues(deleting),
          object_count: 1,
          confirmed_bytes: object.bytes,
        }),
      ).toThrow('STORAGE_RECONCILIATION_PENDING');
    } finally {
      deleting.db.close();
    }
  }, 30_000);

  it('rejects stale or ABA epochs, foreign scope, invalid timing, and malformed bounds', () => {
    const f = fixture();
    try {
      const saved = receiptValues(f);
      insertReceipt(f, saved);
      f.db
        .prepare(
          "UPDATE storage_nodes SET priority=priority+1 WHERE id='primary'",
        )
        .run();
      expect(epoch(f.db)).toBe(saved.epoch + 1);
      expect(() =>
        insertReceipt(f, { ...receiptValues(f), epoch: saved.epoch }),
      ).toThrow('STORAGE_RECONCILIATION_EPOCH_STALE');
      expect(() =>
        f.db
          .prepare('UPDATE storage_inventory_clock SET epoch=? WHERE id=1')
          .run(saved.epoch),
      ).toThrow('STORAGE_INVENTORY_CLOCK_INVALID');

      const foreignActor = randomUUID();
      const foreignWorkspace = randomUUID();
      const now = Date.now();
      f.db
        .prepare(
          'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .run(
          foreignActor,
          'Foreign fixture',
          `foreign-${foreignActor}@fixture.invalid`,
          now,
          now,
        );
      f.db
        .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
        .run(foreignWorkspace, 'Foreign receipt workspace', foreignActor);
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          workspace_id: foreignWorkspace,
        }),
      ).toThrow('STORAGE_RECONCILIATION_OWNER_SCOPE_INVALID');
      expect(() =>
        insertReceipt(f, { ...receiptValues(f), actor_id: 'other-owner' }),
      ).toThrow('STORAGE_RECONCILIATION_OWNER_SCOPE_INVALID');
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          session_id: 'missing-session',
        }),
      ).toThrow('STORAGE_RECONCILIATION_OWNER_SCOPE_INVALID');
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          storage_node_id: 'missing-node',
        }),
      ).toThrow('STORAGE_RECONCILIATION_OWNER_SCOPE_INVALID');

      const expired = 'expired-owner-session';
      f.db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .run(expired, randomUUID(), f.actor, Date.now() - 10_000, now, now);
      expect(() =>
        insertReceipt(f, { ...receiptValues(f), session_id: expired }),
      ).toThrow('STORAGE_RECONCILIATION_OWNER_SCOPE_INVALID');

      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          started_at_ms: nowMs(f.db) + 10_000,
        }),
      ).toThrow('STORAGE_RECONCILIATION_RECEIPT_TIME_INVALID');
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          started_at_ms: nowMs(f.db) - 400_000,
        }),
      ).toThrow('STORAGE_RECONCILIATION_RECEIPT_TIME_INVALID');
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          completed_at_ms: nowMs(f.db) - 10_000,
        }),
      ).toThrow('STORAGE_RECONCILIATION_RECEIPT_TIME_INVALID');

      expect(() =>
        insertReceipt(f, { ...receiptValues(f), object_count: 1.5 }),
      ).toThrow();
      expect(() =>
        insertReceipt(f, { ...receiptValues(f), object_count: 20_001 }),
      ).toThrow();
      expect(() =>
        insertReceipt(f, { ...receiptValues(f), pages: 65 }),
      ).toThrow();
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          confirmed_bytes: maxSafeInteger + 1,
        }),
      ).toThrow();
      expect(() =>
        insertReceipt(f, {
          ...receiptValues(f),
          inventory_revision: 'A'.repeat(64),
        }),
      ).toThrow();
    } finally {
      f.db.close();
    }
  }, 30_000);

  it('protects the singleton clock and rolls source writes back at overflow', () => {
    const f = fixture();
    try {
      f.db.exec('PRAGMA recursive_triggers=OFF');
      const before = epoch(f.db);
      expect(() =>
        f.db
          .prepare(
            'UPDATE storage_inventory_clock SET epoch=epoch-1 WHERE id=1',
          )
          .run(),
      ).toThrow('STORAGE_INVENTORY_CLOCK_INVALID');
      expect(() =>
        f.db
          .prepare(
            'UPDATE storage_inventory_clock SET epoch=epoch+2 WHERE id=1',
          )
          .run(),
      ).toThrow('STORAGE_INVENTORY_CLOCK_INVALID');
      expect(() =>
        f.db.prepare('DELETE FROM storage_inventory_clock WHERE id=1').run(),
      ).toThrow('STORAGE_INVENTORY_CLOCK_IMMUTABLE');
      expect(() =>
        f.db
          .prepare(
            'INSERT OR REPLACE INTO storage_inventory_clock(id,epoch) VALUES(1,0)',
          )
          .run(),
      ).toThrow('STORAGE_INVENTORY_CLOCK_INVALID');
      expect(epoch(f.db)).toBe(before);

      const guard = f.db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='storage_inventory_clock_update_guard'",
        )
        .get() as { sql: string };
      f.db.exec('DROP TRIGGER storage_inventory_clock_update_guard');
      f.db
        .prepare('UPDATE storage_inventory_clock SET epoch=? WHERE id=1')
        .run(maxSafeInteger);
      f.db.exec(guard.sql);
      const priority = (
        f.db
          .prepare("SELECT priority FROM storage_nodes WHERE id='primary'")
          .get() as { priority: number }
      ).priority;
      expect(() =>
        f.db
          .prepare(
            "UPDATE storage_nodes SET priority=priority+1 WHERE id='primary'",
          )
          .run(),
      ).toThrow('STORAGE_INVENTORY_CLOCK_INVALID');
      expect(epoch(f.db)).toBe(maxSafeInteger);
      expect(
        f.db
          .prepare("SELECT priority FROM storage_nodes WHERE id='primary'")
          .get(),
      ).toEqual({ priority });
    } finally {
      f.db.close();
    }
  }, 30_000);
});
