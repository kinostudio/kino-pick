import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const canonical = (value) => {
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
};
async function snapshot(db, tables) {
  const entries = [];
  for (const table of tables) {
    const result = await db.prepare('SELECT * FROM ' + quote(table)).all();
    assert.equal(result.success, true);
    const rows = result.results
      .map((row) => JSON.stringify(canonical(row)))
      .sort();
    entries.push([
      table,
      {
        count: rows.length,
        hash: createHash('sha256').update(rows.join('\n')).digest('hex'),
      },
    ]);
  }
  return Object.fromEntries(entries);
}
export async function verifyMatchingFilenameIndexUpgrade({ db, source49 }) {
  assert.equal(typeof source49, 'string');
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name!='d1_migrations' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);
  assert.equal(names.length, 118);
  const before = await snapshot(db, names);
  assert.ok(
    Object.values(before).reduce((n, row) => n + row.count, 0) > 0,
    'populated upgrade required',
  );
  const schema = (
    await db
      .prepare(
        'SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
      )
      .all()
  ).results;
  const sequences = (
    await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()
  ).results;
  await db.exec(source49);
  assert.deepEqual(
    await snapshot(db, names),
    before,
    'every old table row count and canonical content hash unchanged',
  );
  assert.deepEqual(
    (await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all())
      .results,
    sequences,
  );
  const after = (
    await db
      .prepare(
        'SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
      )
      .all()
  ).results;
  for (const object of schema)
    assert.deepEqual(
      after.find((row) => row.type === object.type && row.name === object.name),
      object,
      'existing schema and guards unchanged',
    );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  const afterNames = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name!='d1_migrations' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);
  assert.equal(afterNames.length, 119);
  const newTable = afterNames.find((name) => !names.includes(name));
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM ' + quote(newTable)).first())
      .n,
    0,
  );
}
