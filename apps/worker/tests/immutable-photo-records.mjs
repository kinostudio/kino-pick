import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

async function tableRows(db, table, orderBy) {
  return (
    await db
      .prepare(
        `SELECT * FROM ${quote(table)} ORDER BY ${orderBy.map(quote).join(', ')}`,
      )
      .all()
  ).results;
}

async function immutableTableSnapshot(db) {
  return {
    photoVersions: await tableRows(db, 'photo_versions', ['id']),
    photoAssets: await tableRows(db, 'photo_assets', ['id']),
    processingOutputs: await tableRows(db, 'image_processing_outputs', [
      'job_id',
      'kind',
    ]),
    auditEvents: await tableRows(db, 'audit_events', ['event_id']),
    foreignKeyCheck: (await db.prepare('PRAGMA foreign_key_check').all())
      .results,
  };
}

async function rejectsImmutableReplace(db, table, row, error, label) {
  const columns = Object.keys(row);
  const sql =
    `INSERT OR REPLACE INTO ${quote(table)}(` +
    columns.map(quote).join(',') +
    ') VALUES(' +
    columns.map(() => '?').join(',') +
    ')';
  const before = await immutableTableSnapshot(db);
  assert.deepEqual(
    before.foreignKeyCheck,
    [],
    `${label}: baseline foreign keys`,
  );

  await assert.rejects(
    db
      .prepare(sql)
      .bind(...columns.map((column) => row[column]))
      .run(),
    new RegExp(error, 'u'),
    label,
  );

  assert.deepEqual(
    await immutableTableSnapshot(db),
    before,
    `${label}: immutable records, audit, or foreign keys changed`,
  );
}

function nextVersionFrom(latest) {
  const row = {
    ...latest,
    version_no: latest.version_no + 1,
    parent_version_id: latest.id,
    status: 'private',
  };
  return row;
}

async function freshAssetObjectKey(db, photoId) {
  const scope = await db
    .prepare('SELECT workspace_id,project_id,album_id FROM photos WHERE id=?')
    .bind(photoId)
    .first();
  assert.ok(scope, 'photo asset fixtures require an existing photo');
  return `${scope.workspace_id}/${scope.project_id}/${scope.album_id}/immutable-check/${randomUUID()}`;
}

export async function immutablePhotoRecordChecks({ db, check }) {
  await check(
    'Immutable photo versions, assets, and processing slots reject REPLACE',
    async () => {
      const versions = await tableRows(db, 'photo_versions', ['id']);
      const version = versions[0];
      assert.ok(version, 'requires a populated photo_versions fixture');

      // Use a different photo's latest version so the duplicate ID is the only
      // uniqueness conflict in this attempt; the next version has a valid parent.
      const otherLatest = await db
        .prepare(
          `SELECT v.* FROM photo_versions v
           WHERE v.photo_id<>? AND NOT EXISTS (
             SELECT 1 FROM photo_versions newer
             WHERE newer.photo_id=v.photo_id AND newer.version_no>v.version_no
           )
           ORDER BY v.id LIMIT 1`,
        )
        .bind(version.photo_id)
        .first();
      assert.ok(
        otherLatest,
        'requires a second photo with a populated latest version for an isolated version primary-key case',
      );
      const pkVersion = nextVersionFrom(otherLatest);
      pkVersion.id = version.id;
      await rejectsImmutableReplace(
        db,
        'photo_versions',
        pkVersion,
        'IMMUTABLE_PHOTO_VERSION',
        'photo_versions primary-key replacement with changed scope and metadata',
      );
      await rejectsImmutableReplace(
        db,
        'photo_versions',
        {
          ...version,
          source_hash_sha256: 'f'.repeat(64),
          byte_size: version.byte_size + 1,
        },
        'IMMUTABLE_PHOTO_VERSION',
        'photo_versions same-ID same-photo replacement with changed metadata',
      );

      await rejectsImmutableReplace(
        db,
        'photo_versions',
        { ...version, id: randomUUID(), source_hash_sha256: 'f'.repeat(64) },
        'IMMUTABLE_PHOTO_VERSION',
        'photo_versions alternate (photo_id, version_no) replacement with a fresh ID',
      );

      const nullVersion = nextVersionFrom(otherLatest);
      nullVersion.id = null;
      await rejectsImmutableReplace(
        db,
        'photo_versions',
        nullVersion,
        'IMMUTABLE_PHOTO_VERSION',
        'photo_versions null-ID insert with an unused version number',
      );

      const asset = await db
        .prepare(
          `SELECT a.* FROM photo_assets a
           WHERE a.asset_kind='original' AND NOT EXISTS (
             SELECT 1 FROM photo_assets d
             WHERE d.version_id=a.version_id AND d.asset_kind='delivery'
           )
           ORDER BY a.id LIMIT 1`,
        )
        .first();
      assert.ok(
        asset,
        'requires a populated original asset whose version has no delivery asset',
      );

      const pkAsset = {
        ...asset,
        asset_kind: 'delivery',
        object_key: await freshAssetObjectKey(db, asset.photo_id),
      };
      await rejectsImmutableReplace(
        db,
        'photo_assets',
        pkAsset,
        'IMMUTABLE_PHOTO_ASSET',
        'photo_assets primary-key replacement with an unused kind and fresh object key',
      );

      await rejectsImmutableReplace(
        db,
        'photo_assets',
        {
          ...asset,
          id: randomUUID(),
          object_key: await freshAssetObjectKey(db, asset.photo_id),
        },
        'IMMUTABLE_PHOTO_ASSET',
        'photo_assets alternate (version_id, asset_kind) replacement with a fresh ID and key',
      );

      await rejectsImmutableReplace(
        db,
        'photo_assets',
        { ...asset, id: randomUUID(), asset_kind: 'delivery' },
        'IMMUTABLE_PHOTO_ASSET',
        'photo_assets alternate object-key replacement with an unused kind and fresh ID',
      );

      await rejectsImmutableReplace(
        db,
        'photo_assets',
        {
          ...asset,
          id: null,
          asset_kind: 'delivery',
          object_key: await freshAssetObjectKey(db, asset.photo_id),
        },
        'IMMUTABLE_PHOTO_ASSET',
        'photo_assets null-ID insert with an unused kind and fresh key',
      );

      const slots = (
        await db
          .prepare(
            `SELECT o.job_id,o.kind,o.asset_id,o.object_key,o.max_bytes,j.status AS fixture_status
             FROM image_processing_outputs o
             JOIN image_processing_jobs j ON j.id=o.job_id
             WHERE j.status IN ('queued','unsupported')
             ORDER BY CASE j.status WHEN 'queued' THEN 0 ELSE 1 END,o.job_id,o.kind`,
          )
          .all()
      ).results;
      const byStatus = new Map();
      for (const slot of slots) {
        if (!byStatus.has(slot.fixture_status))
          byStatus.set(slot.fixture_status, slot);
      }
      assert.ok(
        byStatus.size > 0,
        'requires at least one populated processing output slot whose job is queued or unsupported',
      );
      for (const [status, slot] of byStatus) {
        const output = {
          job_id: slot.job_id,
          kind: slot.kind,
          asset_id: slot.asset_id,
          object_key: slot.object_key,
          max_bytes: slot.max_bytes,
        };
        await rejectsImmutableReplace(
          db,
          'image_processing_outputs',
          { ...output, asset_id: randomUUID() },
          'IMMUTABLE_PROCESSING_OUTPUT',
          `processing output (${status}) slot replacement with a changed asset ID`,
        );
      }
    },
  );
}
