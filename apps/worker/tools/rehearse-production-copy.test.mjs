import assert from 'node:assert/strict';
import test from 'node:test';
import {
  restoreProductionExport,
  splitProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';

test('reorders export safely, preserves SQLite metadata, and rejects unknown SQL', () => {
  const source = [
    'PRAGMA foreign_keys=OFF;',
    'CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id));',
    'INSERT INTO child VALUES(1,1);',
    'CREATE TABLE parent(id INTEGER PRIMARY KEY);',
    'INSERT INTO parent VALUES(1);',
    'CREATE TABLE sqliteX_app(value TEXT);',
    "INSERT INTO sqliteX_app VALUES('kept');",
    'CREATE TABLE _cf_internal(value TEXT);',
    "INSERT INTO _cf_internal VALUES('excluded');",
    'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at INTEGER);',
    "INSERT INTO d1_migrations VALUES(1,'0001_fixture.sql',1);",
    'CREATE TABLE sequence_test(id INTEGER PRIMARY KEY AUTOINCREMENT);',
    'INSERT INTO sequence_test(id) VALUES(1);',
    'ANALYZE sqlite_schema;',
    "INSERT INTO sqlite_stat1(tbl,idx,stat) VALUES('parent','', '1');",
    'CREATE TABLE future_table(id INTEGER PRIMARY KEY);',
    'CREATE TRIGGER child_after_insert AFTER INSERT ON child BEGIN INSERT INTO future_table VALUES(NEW.id); END;',
  ].join('\n');
  const normalized = splitProductionExport(source);
  assert.ok(
    normalized.sql.indexOf('CREATE TABLE parent') <
      normalized.sql.indexOf('INSERT INTO child'),
  );
  assert.ok(
    normalized.sql.indexOf('CREATE TABLE future_table') <
      normalized.sql.indexOf('CREATE TRIGGER child_after_insert'),
  );
  assert.ok(
    normalized.sql.indexOf('ANALYZE sqlite_schema') <
      normalized.sql.indexOf('INSERT INTO sqlite_stat1'),
  );

  const restored = restoreProductionExport(source);
  try {
    assert.equal(restored.integrityCheck, 'ok');
    assert.equal(restored.foreignKeyViolations, 0);
    const snapshot = summarizeProductionDatabase(restored.db);
    assert.equal(snapshot.tableHashes.sqliteX_app.count, 1);
    assert.equal(Object.hasOwn(snapshot.tableHashes, '_cf_internal'), false);
    assert.equal(snapshot.migrationLedger.count, 1);
    assert.equal(snapshot.sqliteSequence.count, 1);
    assert.equal(snapshot.sqliteInternalTables.sqlite_stat1.count, 1);
  } finally {
    restored.db.close();
  }

  assert.throws(
    () => splitProductionExport('DROP TABLE child;'),
    (error) => error.code === 'EXPORT_SQL_UNSUPPORTED_DROP_TABLE',
  );
});
