import assert from 'node:assert/strict';
import test from 'node:test';
import { secretOnlyChild } from './check-production-release.mjs';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  annotations: { 'workers/message': 'Kino Pick production source abc' },
  resources: {
    script: { etag: 'e1' },
    script_runtime: { compatibility_date: '2026-01-01', usage_model: 'standard' },
    bindings: [
      { name: 'DB', type: 'd1', id: 'db' },
      { name: 'BETTER_AUTH_SECRET', type: 'secret_text' },
    ],
  },
};
const child = (patch = {}) => ({
  ...base,
  id: '22222222-2222-4222-8222-222222222222',
  annotations: { 'workers/triggered_by': 'secret' },
  ...patch,
  resources: { ...base.resources, ...(patch.resources ?? {}) },
});
const withGoogle = [
  ...base.resources.bindings,
  { name: 'GOOGLE_CLIENT_ID', type: 'secret_text' },
  { name: 'GOOGLE_CLIENT_SECRET', type: 'secret_text' },
];

test('accepts a secret-only child adding allow-listed Google secrets', () => {
  assert.equal(secretOnlyChild(child({ resources: { bindings: withGoogle } }), base), true);
});

test('rejects code, binding, runtime, trigger or secret-set drift', () => {
  const g = { bindings: withGoogle };
  assert.equal(secretOnlyChild(base, base), false);
  assert.equal(secretOnlyChild(child({ resources: { ...g, script: { etag: 'e2' } } }), base), false);
  assert.equal(secretOnlyChild(child({ annotations: { 'workers/triggered_by': 'upload' }, resources: g }), base), false);
  assert.equal(secretOnlyChild(child({ resources: { ...g, script_runtime: { compatibility_date: '2026-02-01', usage_model: 'standard' } } }), base), false);
  assert.equal(secretOnlyChild(child({ resources: { bindings: [...withGoogle, { name: 'OTHER', type: 'secret_text' }] } }), base), false);
  assert.equal(secretOnlyChild(child({ resources: { bindings: [{ name: 'DB', type: 'd1', id: 'db' }] } }), base), false);
  assert.equal(secretOnlyChild(child({ resources: { bindings: [{ name: 'DB', type: 'd1', id: 'other' }, ...withGoogle.slice(1)] } }), base), false);
});
