import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { WorkspaceRepository } from '../../packages/db/src/workspaces';
import { decodeWorkspaceCursor } from '../../packages/db/src/workspace-cursor';
import type { Database } from '../../packages/db/src/database.types';

it('drops revoked membership rows between snapshots while advancing raw page cursor', async () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `aaaaaaaa-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
    owner_user_id: '22222222-2222-4222-8222-222222222222',
    name: `Revoked ${i}`,
    quota_bytes: 8000000000,
    created_at: '2026-10-23T00:00:00.123456Z',
  }));
  const requests: URL[] = [];
  const client = createClient<Database>(
    'http://127.0.0.1:54329',
    'sb_publishable_test',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          const url = new URL(String(input));
          requests.push(url);
          // A deterministic revocation interleaving: first snapshot sees rows;
          // second snapshot sees the already-revoked membership as absent.
          return Response.json(
            url.pathname.endsWith('/workspaces') ? rows : [],
          );
        },
      },
    },
  );
  const result = await new WorkspaceRepository(client, {
    id: actorId,
    provider: 'google',
  }).list();
  expect(result.workspaces).toEqual([]);
  expect(result.nextCursor).not.toBeNull();
  expect(decodeWorkspaceCursor(result.nextCursor!)).toEqual({
    id: rows[23]!.id,
    createdAt: rows[23]!.created_at,
  });
  expect(requests).toHaveLength(2);
  expect(requests[1]!.searchParams.get('workspace_id')).toBe(
    `in.(${rows
      .slice(0, 24)
      .map((r) => r.id)
      .join(',')})`,
  );
  expect(requests[1]!.searchParams.get('user_id')).toBe(`eq.${actorId}`);
});
