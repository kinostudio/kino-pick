import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

type DatabaseSnapshot = {
  tableCount: number;
  totalRows: number;
  tableHashes: Record<string, { count: number; sha256: string }>;
  schemaSha256: string;
  foreignKeySchemaSha256: string;
  sqliteSequence: { count: number; sha256: string };
};

const helperUrl = new URL(
  '../../apps/worker/tools/rehearse-hosted-d1-restore.mjs',
  import.meta.url,
).href;
const { snapshotDatabase } = (await import(helperUrl)) as {
  snapshotDatabase: (database: DatabaseSync) => DatabaseSnapshot;
};

describe('hosted restore catalog snapshot scope', () => {
  it('includes sqliteX product objects, excludes _cf metadata, and retains sequences', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        'CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);' +
          "INSERT INTO products(value) VALUES('first');",
      );
      const baseline = snapshotDatabase(database);
      expect(baseline.tableCount).toBe(1);
      expect(baseline.totalRows).toBe(1);
      expect(baseline.tableHashes.products?.count).toBe(1);
      expect(baseline.sqliteSequence.count).toBe(1);
      expect(baseline.sqliteSequence.sha256).toMatch(/^[a-f0-9]{64}$/u);

      database.exec(
        'CREATE TABLE sqliteX_untracked (id INTEGER PRIMARY KEY, value TEXT NOT NULL);' +
          "INSERT INTO sqliteX_untracked VALUES(1,'initial');",
      );
      const withCustomTable = snapshotDatabase(database);
      expect(withCustomTable.tableCount).toBe(2);
      expect(withCustomTable.totalRows).toBe(2);
      expect(withCustomTable.tableHashes.sqliteX_untracked?.count).toBe(1);
      expect(withCustomTable.schemaSha256).not.toBe(baseline.schemaSha256);
      expect(withCustomTable.sqliteSequence).toEqual(baseline.sqliteSequence);

      database.exec("UPDATE sqliteX_untracked SET value='changed' WHERE id=1;");
      const changedRow = snapshotDatabase(database);
      expect(changedRow.tableHashes.sqliteX_untracked?.sha256).not.toBe(
        withCustomTable.tableHashes.sqliteX_untracked?.sha256,
      );
      expect(changedRow.schemaSha256).toBe(withCustomTable.schemaSha256);

      database.exec(
        'CREATE TABLE _cf_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);' +
          "INSERT INTO _cf_metadata VALUES('internal','ignored');",
      );
      const withPlatformMetadata = snapshotDatabase(database);
      expect(withPlatformMetadata.tableCount).toBe(2);
      expect(withPlatformMetadata.totalRows).toBe(2);
      expect(withPlatformMetadata.tableHashes).not.toHaveProperty(
        '_cf_metadata',
      );
      expect(withPlatformMetadata.schemaSha256).toBe(changedRow.schemaSha256);
      expect(withPlatformMetadata.sqliteSequence).toEqual(
        baseline.sqliteSequence,
      );

      database.exec(
        'CREATE VIEW sqliteX_untracked_view AS SELECT value FROM sqliteX_untracked;',
      );
      const withCustomView = snapshotDatabase(database);
      expect(withCustomView.tableCount).toBe(withPlatformMetadata.tableCount);
      expect(withCustomView.totalRows).toBe(withPlatformMetadata.totalRows);
      expect(withCustomView.schemaSha256).not.toBe(
        withPlatformMetadata.schemaSha256,
      );
      expect(withCustomView.sqliteSequence).toEqual(baseline.sqliteSequence);

      database.exec("INSERT INTO products(value) VALUES('second');");
      const advancedSequence = snapshotDatabase(database);
      expect(advancedSequence.sqliteSequence.count).toBe(1);
      expect(advancedSequence.sqliteSequence.sha256).not.toBe(
        baseline.sqliteSequence.sha256,
      );
      expect(advancedSequence.tableHashes.products?.count).toBe(2);
    } finally {
      database.close();
    }
  });
});
