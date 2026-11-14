import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchemaAdoptions } from './production-schema-adoptions.mjs';

const base = 'a'.repeat(64);
const after = 'b'.repeat(64);
const file = 'c'.repeat(64);
const names = Array.from({ length: 67 }, (_, i) =>
  i === 66
    ? '0067_delivery_zip_tickets.sql'
    : String(i + 1).padStart(4, '0') + '_m.sql',
);
const adoption = {
  name: '0068_album_retention_settings.sql',
  sha256: file,
  databaseId: '65d2286e-f2ac-4ad2-90e2-4b31e2f24251',
  schemaSha256Before: base,
  schemaSha256After: after,
  productSchemaObjectCountAfter: 1209,
  localRehearsalSchemaSha256After: after,
  timeTravelBookmarkBefore: 'bookmark',
  preExistingTableDataUnchanged: true,
  foreignKeyViolations: 0,
  ledgerRecorded: true,
};
const record = (adoptions) => ({
  schemaVersion: 1,
  baseline: {
    migrationCount: 67,
    lastMigration: '0067_delivery_zip_tickets.sql',
    productSchemaSha256: base,
  },
  adoptions,
});
const local = (extra = []) => ({
  names: [...names, ...extra],
  fileSha256: { '0068_album_retention_settings.sql': file },
  baselineSchemaSha256: base,
});

test('baseline with no adoptions keeps the cutover schema', () => {
  const result = validateSchemaAdoptions(record([]), local());
  assert.equal(result.expectedMigrationCount, 67);
  assert.equal(result.expectedSchemaSha256, base);
});

test('a recorded adoption moves the expected schema forward', () => {
  const result = validateSchemaAdoptions(
    record([adoption]),
    local(['0068_album_retention_settings.sql']),
  );
  assert.equal(result.expectedMigrationCount, 68);
  assert.equal(result.expectedSchemaSha256, after);
});

test('rejects unrecorded, tampered or evidence-less migrations', () => {
  const extra = ['0068_album_retention_settings.sql'];
  assert.throws(() => validateSchemaAdoptions(record([]), local(extra)), {
    message: 'ADOPTION_UNRECORDED_MIGRATION',
  });
  assert.throws(
    () =>
      validateSchemaAdoptions(
        record([{ ...adoption, sha256: 'd'.repeat(64) }]),
        local(extra),
      ),
    { message: 'ADOPTION_FILE_HASH' },
  );
  assert.throws(
    () =>
      validateSchemaAdoptions(
        record([{ ...adoption, schemaSha256Before: 'e'.repeat(64) }]),
        local(extra),
      ),
    { message: 'ADOPTION_SCHEMA_CHAIN' },
  );
  for (const field of [
    'timeTravelBookmarkBefore',
    'preExistingTableDataUnchanged',
    'ledgerRecorded',
  ])
    assert.throws(
      () =>
        validateSchemaAdoptions(
          record([{ ...adoption, [field]: undefined }]),
          local(extra),
        ),
      { message: 'ADOPTION_EVIDENCE' },
    );
  assert.throws(
    () =>
      validateSchemaAdoptions(
        record([{ ...adoption, localRehearsalSchemaSha256After: base }]),
        local(extra),
      ),
    { message: 'ADOPTION_EVIDENCE' },
  );
  assert.throws(
    () =>
      validateSchemaAdoptions(record([adoption]), {
        ...local(extra),
        baselineSchemaSha256: 'f'.repeat(64),
      }),
    { message: 'ADOPTION_RECORD' },
  );
});
