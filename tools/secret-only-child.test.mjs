import assert from 'node:assert/strict';
import test from 'node:test';
import { secretOnlyChild } from './check-production-release.mjs';

const db = { name: 'DB', type: 'd1', id: 'db' };
const auth = { name: 'BETTER_AUTH_SECRET', type: 'secret_text' };
const googleId = { name: 'GOOGLE_CLIENT_ID', type: 'secret_text' };
const googleSecret = { name: 'GOOGLE_CLIENT_SECRET', type: 'secret_text' };
const runtime = { compatibility_date: '2026-01-01', usage_model: 'standard' };
const base = {
  id: '11111111-1111-4111-8111-111111111111',
  annotations: { 'workers/message': 'Kino Pick production source abc' },
  resources: {
    script: { etag: 'e1' },
    script_runtime: runtime,
    bindings: [db, auth],
  },
};
const withGoogle = [db, auth, googleId, googleSecret];
const child = ({ trigger = 'secret', ...resources } = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  annotations: { 'workers/triggered_by': trigger },
  resources: { ...base.resources, bindings: withGoogle, ...resources },
});

test('accepts a secret-only child adding allow-listed Google secrets', () => {
  assert.equal(secretOnlyChild(child(), base), true);
});

test('rejects code, binding, runtime, trigger or secret-set drift', () => {
  const other = { name: 'OTHER', type: 'secret_text' };
  const movedDb = { ...db, id: 'other' };
  const laterRuntime = { ...runtime, compatibility_date: '2026-02-01' };
  const drifted = [
    base,
    child({ trigger: 'upload' }),
    child({ script: { etag: 'e2' } }),
    child({ script_runtime: laterRuntime }),
    child({ bindings: [...withGoogle, other] }),
    child({ bindings: [db, googleId, googleSecret] }),
    child({ bindings: [movedDb, auth, googleId, googleSecret] }),
  ];
  for (const live of drifted) assert.equal(secretOnlyChild(live, base), false);
});
