import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freehandAnnotationSchemaCapability } from '../../apps/worker/src/freehand-annotation-schema.ts';

const migrationDirectory = resolve('apps/worker/migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
  .sort();

function schemaAt(version: 58 | 69): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  for (const name of migrationFiles) {
    if (Number(name.slice(0, 4)) > version) break;
    database.exec(readFileSync(resolve(migrationDirectory, name), 'utf8'));
  }
  return database;
}

function triggerSql(database: DatabaseSync, name: string): string {
  const row = database
    .prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?')
    .get('trigger', name) as { sql: string | null } | undefined;
  expect(row?.sql).toBeTruthy();
  return row!.sql!;
}

function replaceTrigger(
  database: DatabaseSync,
  name: string,
  sql: string,
): void {
  database.exec(`DROP TRIGGER "${name}"`);
  database.exec(sql);
}

function d1Adapter(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let parameters: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          parameters = values;
          return this;
        },
        async all<T>() {
          return {
            results: database
              .prepare(sql)
              .all(...(parameters as never[])) as T[],
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('freehand annotation schema capability on schema 69', () => {
  it('accepts the exact existing schema 58 and updated schema 69 guards', async () => {
    const schema58 = schemaAt(58);
    const schema69 = schemaAt(69);
    try {
      expect(
        await freehandAnnotationSchemaCapability(d1Adapter(schema58)),
      ).toBe(true);
      expect(
        await freehandAnnotationSchemaCapability(d1Adapter(schema69)),
      ).toBe(true);
    } finally {
      schema58.close();
      schema69.close();
    }
  });

  it('rejects the old Guest guard installed into schema 69', async () => {
    const schema58 = schemaAt(58);
    const schema69 = schemaAt(69);
    try {
      replaceTrigger(
        schema69,
        'guest_annotation_command_guard',
        triggerSql(schema58, 'guest_annotation_command_guard'),
      );
      expect(
        await freehandAnnotationSchemaCapability(d1Adapter(schema69)),
      ).toBe(false);
    } finally {
      schema58.close();
      schema69.close();
    }
  });

  it('rejects the schema 69 Guest guard when installed into schema 58', async () => {
    const schema58 = schemaAt(58);
    const schema69 = schemaAt(69);
    try {
      replaceTrigger(
        schema58,
        'guest_annotation_command_guard',
        triggerSql(schema69, 'guest_annotation_command_guard'),
      );
      expect(
        await freehandAnnotationSchemaCapability(d1Adapter(schema58)),
      ).toBe(false);
    } finally {
      schema58.close();
      schema69.close();
    }
  });

  it('rejects an altered Owner guard even when the Guest guard is exact', async () => {
    const schema69 = schemaAt(69);
    try {
      const original = triggerSql(
        schema69,
        'owner_annotation_command_insert_guard',
      );
      const altered = original.replace(
        'OWNER_IDENTITY_CHANGED',
        'OWNER_IDENTITY_CHANGED_',
      );
      expect(altered).not.toBe(original);
      replaceTrigger(
        schema69,
        'owner_annotation_command_insert_guard',
        altered,
      );
      expect(
        triggerSql(schema69, 'owner_annotation_command_insert_guard'),
      ).toBe(altered);
      expect(
        await freehandAnnotationSchemaCapability(d1Adapter(schema69)),
      ).toBe(false);
    } finally {
      schema69.close();
    }
  });

  it('fails closed when the schema query errors', async () => {
    const failedQuery = {
      prepare() {
        throw new Error('sqlite_master unavailable');
      },
    } as unknown as D1Database;
    expect(await freehandAnnotationSchemaCapability(failedQuery)).toBe(false);
  });
});
