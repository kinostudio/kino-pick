import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function kdfPermitChecks({
  db,
  mf,
  owner,
  session,
  check,
  post,
  body,
}) {
  const worker = await mf.getWorker('storage-test');
  const invoke = (extra = {}) =>
    worker.fetch('http://localhost/test-kdf-permit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: owner,
        session,
        requestId: randomUUID(),
        delay: 100,
        ...extra,
      }),
    });
  const held = async () =>
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM kdf_permits p WHERE NOT EXISTS(SELECT 1 FROM kdf_permit_releases r WHERE r.permit_id=p.id)',
        )
        .first()
    ).n;
  const acquire = async () => {
    const id = randomUUID();
    await db
      .prepare(
        'INSERT INTO kdf_permits(id,actor_id,session_id,request_id,acquired_at_ms) VALUES(?,?,?,?,0)',
      )
      .bind(id, owner, session, randomUUID())
      .run();
    return id;
  };
  const release = (id) =>
    db
      .prepare(
        'INSERT INTO kdf_permit_releases(permit_id) VALUES(?) ON CONFLICT(permit_id) DO NOTHING',
      )
      .bind(id)
      .run();
  await check(
    'Persistent KDF single-slot concurrency permits exactly one caller and releases after settlement',
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => invoke({ delay: 700 })),
      );
      assert.equal(responses.filter((r) => r.status === 200).length, 1);
      assert.equal(responses.filter((r) => r.status === 503).length, 7);
      assert.equal(await held(), 0);
      assert.equal((await invoke({ fail: true, delay: 0 })).status, 503);
      assert.equal(await held(), 0);
    },
  );
  await check(
    'Held KDF denies real password issuer, survives time, permits link-only and cannot be freed by old release',
    async () => {
      const previous = await acquire();
      await release(previous);
      const current = await acquire();
      await release(previous);
      assert.equal(await held(), 1);
      assert.equal((await post(body('generated_password'))).status, 503);
      assert.equal((await post(body('link_only'))).status, 200);
      assert.equal((await invoke()).status, 503);
      assert.equal(await held(), 1);
      await release(current);
      assert.equal((await invoke({ delay: 0 })).status, 200);
    },
  );
  await check(
    'KDF acquire/release audit failures roll back and release failure stops real invitation commit',
    async () => {
      await db.exec(
        "CREATE TRIGGER test_kdf_acquire_fail BEFORE INSERT ON audit_events WHEN NEW.action='security.kdf_acquired' BEGIN SELECT RAISE(ABORT,'TEST_AUDIT'); END;",
      );
      try {
        assert.equal((await invoke({ delay: 0 })).status, 503);
        assert.equal(await held(), 0);
      } finally {
        await db.exec('DROP TRIGGER test_kdf_acquire_fail');
      }
      const input = body('generated_password');
      await db.exec(
        "CREATE TRIGGER test_kdf_release_fail BEFORE INSERT ON audit_events WHEN NEW.action='security.kdf_released' BEGIN SELECT RAISE(ABORT,'TEST_AUDIT'); END;",
      );
      try {
        assert.equal((await post(input)).status, 503);
        assert.equal(await held(), 1);
        assert.equal(
          await db
            .prepare(
              'SELECT 1 FROM invite_creation_commands WHERE request_id=?',
            )
            .bind(input.requestId)
            .first(),
          null,
        );
      } finally {
        await db.exec('DROP TRIGGER test_kdf_release_fail');
      }
      // Privileged fixture repair only after awaited native work and request have settled.
      const stuck = await db
        .prepare(
          'SELECT p.id FROM kdf_permits p WHERE NOT EXISTS(SELECT 1 FROM kdf_permit_releases r WHERE r.permit_id=p.id)',
        )
        .first();
      await release(stuck.id);
      assert.equal(await held(), 0);
      await assert.rejects(
        db.prepare('DELETE FROM kdf_permits WHERE id=?').bind(stuck.id).run(),
        /IMMUTABLE_KDF_PERMIT/,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE kdf_permit_releases SET released_at_ms=0 WHERE permit_id=?',
          )
          .bind(stuck.id)
          .run(),
        /IMMUTABLE_KDF_RELEASE/,
      );
      assert.equal(
        (await invoke({ session: 'invalid', delay: 0 })).status,
        503,
      );
      assert.equal(await held(), 0);
    },
  );
}
