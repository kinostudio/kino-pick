import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';

type SchemaRow = { type: string; name: string; sql: string | null };

const {
  validateApprovedDeliverySchema,
  validateAlbumRetentionPolicy0068Schema,
} = createRequire(import.meta.url)(
  '../../tools/check-staging-collaboration-release.mjs',
) as {
  validateApprovedDeliverySchema: (
    rows: SchemaRow[],
    migrationSql: string,
    inheritedSql?: string,
  ) => unknown;
  validateAlbumRetentionPolicy0068Schema: (
    rows: SchemaRow[],
    migrationSql: string,
    inheritedSql?: string,
  ) => unknown;
};

const directory = resolve('apps/worker/migrations');
const migrationFiles = readdirSync(directory)
  .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
  .sort();
const migration66 = readFileSync(
  resolve(directory, '0066_approved_deliveries.sql'),
  'utf8',
);
const migration68 = readFileSync(
  resolve(directory, '0068_album_retention_policy_configuration.sql'),
  'utf8',
);
const migration69 = readFileSync(
  resolve(directory, '0069_inherited_share_expiry.sql'),
  'utf8',
);
const database = new DatabaseSync(':memory:');
for (const name of migrationFiles)
  database.exec(readFileSync(resolve(directory, name), 'utf8'));
afterAll(() => database.close());

function migrationObjects(source: string): Array<[string, string]> {
  return [...source.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?(\w+)\s+([^\s(;]+)/giu)]
    .map<[string, string]>((match) => {
      const type = match[1];
      const name = match[2];
      if (type === undefined || name === undefined)
        throw new Error('Invalid CREATE statement match');
      return [type.toLowerCase(), name];
    })
    .sort(
      ([typeA, nameA], [typeB, nameB]) =>
        typeA.localeCompare(typeB) || nameA.localeCompare(nameB),
    );
}

function finalCatalogRows(source: string): SchemaRow[] {
  const names = new Set(migrationObjects(source).map(([, name]) => name));
  return (
    database
      .prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL')
      .all() as SchemaRow[]
  )
    .filter((row) => names.has(row.name))
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    );
}

const approvedDeliveryRows = finalCatalogRows(migration66);
const retentionRows = finalCatalogRows(migration68);

function tamperCreateTrigger(
  source: string,
  name: string,
  replace: (statement: string) => string,
): string {
  const pattern = new RegExp(
    '^CREATE\\s+TRIGGER\\s+' + name + '\\b[\\s\\S]*?^END\\s*;',
    'gim',
  );
  const matches = [...source.matchAll(pattern)];
  expect(matches).toHaveLength(1);
  const statement = matches[0]?.[0];
  if (statement === undefined)
    throw new Error('Expected exactly one CREATE TRIGGER statement');
  return source.replace(statement, replace(statement));
}

function alterRow(rows: SchemaRow[], name: string): SchemaRow[] {
  return rows.map((row) =>
    row.name === name ? { ...row, sql: row.sql + ' -- altered' } : row,
  );
}

describe('0069 overrides for retained 0066 and 0068 schema gates', () => {
  it('accepts both actual schema 69 catalogs with only their specified overrides', () => {
    expect(migrationFiles).toHaveLength(69);
    expect(migrationFiles.at(-1)).toBe('0069_inherited_share_expiry.sql');
    expect(approvedDeliveryRows).toHaveLength(8);
    expect(retentionRows).toHaveLength(migrationObjects(migration68).length);
    expect(() =>
      validateApprovedDeliverySchema(
        approvedDeliveryRows,
        migration66,
        migration69,
      ),
    ).not.toThrow();
    expect(() =>
      validateAlbumRetentionPolicy0068Schema(
        retentionRows,
        migration68,
        migration69,
      ),
    ).not.toThrow();
  });

  it('keeps the historical two-argument validators strict against schema 69', () => {
    expect(() =>
      validateApprovedDeliverySchema(approvedDeliveryRows, migration66),
    ).toThrow();
    expect(() =>
      validateAlbumRetentionPolicy0068Schema(retentionRows, migration68),
    ).toThrow();
  });

  it('rejects tampering with an unoverridden legacy object or an allowed override', () => {
    expect(() =>
      validateApprovedDeliverySchema(
        alterRow(approvedDeliveryRows, 'approved_delivery_revoke_guard'),
        migration66,
        migration69,
      ),
    ).toThrow();
    expect(() =>
      validateApprovedDeliverySchema(
        approvedDeliveryRows,
        migration66,
        tamperCreateTrigger(
          migration69,
          'approved_delivery_publish_guard',
          (statement) => statement.replace('NEW.event_id', 'NEW.request_id'),
        ),
      ),
    ).toThrow();

    expect(() =>
      validateAlbumRetentionPolicy0068Schema(
        alterRow(retentionRows, 'album_retention_policy_command_guard'),
        migration68,
        migration69,
      ),
    ).toThrow();
    expect(() =>
      validateAlbumRetentionPolicy0068Schema(
        retentionRows,
        migration68,
        tamperCreateTrigger(
          migration69,
          'album_retention_policy_command_apply',
          (statement) =>
            statement.replace('NEW.inactive_days', 'NEW.cleanup_allowed'),
        ),
      ),
    ).toThrow();
  });

  it('rejects missing or extra objects in both final schema subsets', () => {
    const extra: SchemaRow = {
      type: 'trigger',
      name: 'unapproved_schema_object',
      sql: 'CREATE TRIGGER unapproved_schema_object',
    };
    for (const rows of [
      approvedDeliveryRows.slice(1),
      [...approvedDeliveryRows, extra],
    ])
      expect(() =>
        validateApprovedDeliverySchema(rows, migration66, migration69),
      ).toThrow();
    for (const rows of [retentionRows.slice(1), [...retentionRows, extra]])
      expect(() =>
        validateAlbumRetentionPolicy0068Schema(rows, migration68, migration69),
      ).toThrow();
  });
});
