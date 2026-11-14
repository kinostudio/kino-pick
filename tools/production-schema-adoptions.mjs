// Production schema adoptions after the 2026-11-12 cutover (schema 67).
// Each later migration is applied to the live D1 only with recorded evidence:
// a pre-apply Time Travel bookmark, unchanged data in every pre-existing table,
// zero foreign-key violations and the exact before/after product schema hash.
// Release gates use the last adoption's after-hash as the expected live schema.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ADOPTIONS_PATH = 'docs/releases/production-schema-adoptions.json';
export const BASELINE_MIGRATION_COUNT = 67;
export const BASELINE_LAST_MIGRATION = '0067_delivery_zip_tickets.sql';
const LIVE_DB_ID = '65d2286e-f2ac-4ad2-90e2-4b31e2f24251';

const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const hex64 = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/**
 * @param {unknown} record parsed adoptions document
 * @param {{ names: string[], fileSha256: Record<string,string>, baselineSchemaSha256: string }} local
 * @returns {{ expectedMigrationCount: number, expectedSchemaSha256: string, adoptedNames: string[] }}
 */
export function validateSchemaAdoptions(record, local) {
  const names = [...local.names].sort();
  need(
    names.length >= BASELINE_MIGRATION_COUNT &&
      names[BASELINE_MIGRATION_COUNT - 1] === BASELINE_LAST_MIGRATION &&
      names.every(
        (name, i) =>
          /^\d{4}_.+\.sql$/.test(name) && +name.slice(0, 4) === i + 1,
      ),
    'ADOPTION_LOCAL_ORDER',
  );
  need(hex64(local.baselineSchemaSha256), 'ADOPTION_BASELINE_HASH');
  const adoptions = record?.adoptions;
  need(
    record?.schemaVersion === 1 &&
      record.baseline?.migrationCount === BASELINE_MIGRATION_COUNT &&
      record.baseline.lastMigration === BASELINE_LAST_MIGRATION &&
      record.baseline.productSchemaSha256 === local.baselineSchemaSha256 &&
      Array.isArray(adoptions),
    'ADOPTION_RECORD',
  );
  need(
    names.length === BASELINE_MIGRATION_COUNT + adoptions.length,
    'ADOPTION_UNRECORDED_MIGRATION',
  );
  let previous = local.baselineSchemaSha256;
  adoptions.forEach((item, index) => {
    const name = names[BASELINE_MIGRATION_COUNT + index];
    need(item?.name === name, 'ADOPTION_NAME');
    need(
      hex64(item.sha256) && item.sha256 === local.fileSha256[name],
      'ADOPTION_FILE_HASH',
    );
    need(
      item.databaseId === LIVE_DB_ID &&
        item.schemaSha256Before === previous &&
        hex64(item.schemaSha256After) &&
        item.schemaSha256After !== previous &&
        Number.isInteger(item.productSchemaObjectCountAfter) &&
        item.productSchemaObjectCountAfter > 0,
      'ADOPTION_SCHEMA_CHAIN',
    );
    need(
      typeof item.timeTravelBookmarkBefore === 'string' &&
        item.timeTravelBookmarkBefore.length > 0 &&
        item.preExistingTableDataUnchanged === true &&
        item.foreignKeyViolations === 0 &&
        item.ledgerRecorded === true &&
        item.localRehearsalSchemaSha256After === item.schemaSha256After,
      'ADOPTION_EVIDENCE',
    );
    previous = item.schemaSha256After;
  });
  return {
    expectedMigrationCount: names.length,
    expectedSchemaSha256: previous,
    adoptedNames: names.slice(BASELINE_MIGRATION_COUNT),
  };
}

export async function readSchemaAdoptions(root, names) {
  let record;
  try {
    record = JSON.parse(await readFile(resolve(root, ADOPTIONS_PATH), 'utf8'));
  } catch {
    throw new Error('ADOPTION_READ');
  }
  const fileSha256 = {};
  for (const name of names.slice(BASELINE_MIGRATION_COUNT))
    fileSha256[name] = createHash('sha256')
      .update(await readFile(resolve(root, 'apps/worker/migrations', name)))
      .digest('hex');
  return { record, fileSha256 };
}
