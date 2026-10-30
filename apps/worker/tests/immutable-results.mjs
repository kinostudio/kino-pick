import assert from 'node:assert/strict';

const tables = [
  {
    table: 'guest_selection_results',
    key: 'command_id',
    error: 'IMMUTABLE_GUEST_SELECTION_RESULT',
  },
  {
    table: 'guest_feedback_results',
    key: 'command_id',
    error: 'IMMUTABLE_GUEST_FEEDBACK_RESULT',
  },
  {
    table: 'guest_selection_submission_results',
    key: 'submission_id',
    error: 'IMMUTABLE_GUEST_SELECTION_SUBMISSION_RESULT',
  },
  {
    table: 'selection_policy_results',
    key: 'command_id',
    error: 'IMMUTABLE_SELECTION_POLICY_RESULT',
  },
  {
    table: 'selection_policy_configuration_results',
    key: 'command_id',
    error: 'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT',
  },
  {
    table: 'shared_review_owner_results',
    key: 'command_id',
    error: 'IMMUTABLE_SHARED_REVIEW_OWNER_RESULT',
  },
  {
    table: 'shared_review_guest_results',
    key: 'command_id',
    error: 'IMMUTABLE_SHARED_REVIEW_GUEST_RESULT',
  },
];
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

export async function assertImmutableResultInsertIntegrity(
  db,
  table,
  key,
  error,
) {
  const before = (
    await db
      .prepare('SELECT * FROM ' + quote(table) + ' ORDER BY ' + quote(key))
      .all()
  ).results;
  const original = before.find((row) => row.event_id !== null);
  assert.ok(original, table + ' requires a real non-noop result fixture');
  const columns = Object.keys(original);
  const insert =
    'INSERT OR REPLACE INTO ' +
    quote(table) +
    '(' +
    columns.map(quote).join(',') +
    ') VALUES(' +
    columns.map(() => '?').join(',') +
    ')';
  // Exercise the primary key and alternate event_id, plus standalone null-key rejection.
  const attempts = [
    {
      ...original,
      [key]: crypto.randomUUID(),
      result_json: JSON.stringify({ tampered: true }),
    },
    { ...original, result_json: JSON.stringify({ tampered: true }) },
    {
      ...original,
      [key]: null,
      result_json: JSON.stringify({ tampered: true }),
    },
    { ...original, [key]: null, event_id: null },
  ];
  for (const attempt of attempts) {
    await assert.rejects(
      db
        .prepare(insert)
        .bind(...columns.map((column) => attempt[column]))
        .run(),
      new RegExp(error, 'u'),
    );
    assert.deepEqual(
      (
        await db
          .prepare('SELECT * FROM ' + quote(table) + ' ORDER BY ' + quote(key))
          .all()
      ).results,
      before,
    );
  }
}

export async function immutableResultChecks({ db, check }) {
  await check(
    'Immutable result history rejects primary-key and alternate event-key replacement',
    async () => {
      const auditBefore = (
        await db.prepare('SELECT * FROM audit_events ORDER BY event_id').all()
      ).results;
      const auditSample = auditBefore[0];
      assert.ok(auditSample);
      for (const eventId of [null, '', auditSample.event_id]) {
        const columns = Object.keys(auditSample);
        const copy = { ...auditSample, event_id: eventId };
        await assert.rejects(
          db
            .prepare(
              'INSERT OR REPLACE INTO audit_events(' +
                columns.map(quote).join(',') +
                ') VALUES(' +
                columns.map(() => '?').join(',') +
                ')',
            )
            .bind(...columns.map((column) => copy[column]))
            .run(),
          /APPEND_ONLY_AUDIT/u,
        );
      }
      for (const entry of tables.filter(
        (entry) => entry.table !== 'selection_policy_results',
      ))
        await assertImmutableResultInsertIntegrity(
          db,
          entry.table,
          entry.key,
          entry.error,
        );
      assert.deepEqual(
        (await db.prepare('SELECT * FROM audit_events ORDER BY event_id').all())
          .results,
        auditBefore,
      );
      assert.deepEqual(
        (await db.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
    },
  );
}
