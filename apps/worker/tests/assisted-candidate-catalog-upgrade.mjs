import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
function canonical(value) {
  if (value instanceof ArrayBuffer)
    return { blob: Buffer.from(value).toString('base64') };
  if (ArrayBuffer.isView(value))
    return {
      blob: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString('base64'),
    };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
async function tableNames(db) {
  return (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
  ).results
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') &&
        !name.startsWith('_') &&
        name !== 'd1_migrations',
    );
}
async function snapshot(db, names) {
  const result = {};
  for (const name of names) {
    const rows = (
      await db.prepare('SELECT * FROM ' + quote(name)).all()
    ).results
      .map((row) => JSON.stringify(canonical(row)))
      .sort();
    result[name] = {
      count: rows.length,
      hash: createHash('sha256').update(rows.join('\n')).digest('hex'),
    };
  }
  return result;
}
export async function verifyAssistedCandidateCatalogUpgrade({ db, source50 }) {
  assert.equal(typeof source50, 'string');
  assert.ok(source50.trim());
  const names = await tableNames(db);
  assert.equal(names.length, 119);
  const before = await snapshot(db, names);
  assert.ok(
    Object.values(before).some((row) => row.count > 0),
    'populated upgrade required',
  );
  const objects = (
    await db
      .prepare(
        'SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
      )
      .all()
  ).results;
  const sequences = (
    await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()
  ).results;
  await db.exec(source50);
  assert.deepEqual(await tableNames(db), names);
  assert.deepEqual(
    await snapshot(db, names),
    before,
    'all119 old table hashes/counts unchanged',
  );
  assert.deepEqual(
    (await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all())
      .results,
    sequences,
  );
  const after = (
    await db
      .prepare(
        'SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
      )
      .all()
  ).results;
  for (const object of objects)
    assert.deepEqual(
      after.find((row) => row.type === object.type && row.name === object.name),
      object,
      'old schema changed: ' + object.name,
    );
  const oldKeys = new Set(objects.map((row) => row.type + ':' + row.name));
  const added = after.filter((row) => !oldKeys.has(row.type + ':' + row.name));
  assert.equal(added.length, 1);
  assert.equal(added[0].type, 'index');
  assert.equal(added[0].name, 'photos_assisted_catalog_scope_id');
  assert.equal(added[0].tbl_name, 'photos');
  const index = (
    await db
      .prepare("PRAGMA index_info('photos_assisted_catalog_scope_id')")
      .all()
  ).results;
  assert.deepEqual(
    index.map((row) => row.name),
    ['workspace_id', 'project_id', 'album_id', 'id'],
  );
  // An unforced plan proves SQLite chooses the scoped keyset seek. This is
  // structural local D1 evidence, not edge CPU, latency or free-tier evidence.
  const plan = await db
    .prepare(
      [
        'EXPLAIN QUERY PLAN SELECT p.id FROM photos AS p',
        'WHERE p.workspace_id=?1 AND p.project_id=?2 AND p.album_id=?3',
        'AND p.id COLLATE BINARY > ?4 COLLATE BINARY',
        'ORDER BY p.id COLLATE BINARY LIMIT 25',
      ].join(' '),
    )
    .bind(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '',
    )
    .all();
  assert.equal(plan.success, true);
  const planDetails = plan.results.map((row) => String(row.detail));
  assert.ok(
    planDetails.some(
      (detail) =>
        /SEARCH p USING (?:COVERING )?INDEX photos_assisted_catalog_scope_id/u.test(
          detail,
        ) &&
        /workspace_id=\? AND project_id=\? AND album_id=\? AND id>\?/u.test(
          detail,
        ),
    ),
    'native D1 must choose the scoped BINARY ID range seek',
  );
  assert.equal(
    planDetails.some((detail) => /USE TEMP B-TREE FOR ORDER BY/u.test(detail)),
    false,
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
}
