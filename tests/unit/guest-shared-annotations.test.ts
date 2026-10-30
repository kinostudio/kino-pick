import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { D1GuestSharedAnnotationReader } from '../../apps/worker/src/guest-annotation-shared-read';

const viewerGuestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const caseDistinctAuthorId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const albumId = '11111111-1111-4111-8111-111111111111';
const photoId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const inviteId = '44444444-4444-4444-8444-444444444444';
const workspaceId = '55555555-5555-4555-8555-555555555555';
const projectId = '66666666-6666-4666-8666-666666666666';
const sessionId = '77777777-7777-4777-8777-777777777777';
const annotationId = '88888888-8888-4888-8888-888888888888';
const commentId = '99999999-9999-4999-8999-999999999999';
const secret = 'd'.repeat(64);

function row(overrides: Record<string, unknown> = {}) {
  const authorType = overrides.authorType ?? 'guest';
  const isGuestAuthor = authorType === 'guest';
  return {
    sessionId,
    guestId: viewerGuestId,
    inviteId,
    workspaceId,
    projectId,
    authorizedAlbumId: albumId,
    authorizedPhotoId: photoId,
    authorizedVersionId: versionId,
    permissionsMask: 128,
    guestWatermark: 0,
    ownerWatermark: 0,
    processingWatermark: 0,
    authorType,
    annotationId,
    photoId,
    versionId,
    authorGuestId: caseDistinctAuthorId,
    revision: 1,
    geometryJson: JSON.stringify({
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: 250_000,
      y: 350_000,
    }),
    styleJson: JSON.stringify({ color: 'amber' }),
    commentId,
    state: 'open',
    authorLabel: 'Case distinct peer',
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    createdAtMs: 1_798_200_000_000,
    processingState: isGuestAuthor ? 'open' : null,
    processingRevision: isGuestAuthor ? 0 : null,
    processingAnnotationRevision: null,
    processingContentRevision: null,
    processingUpdatedAtMs: null,
    processingStale: isGuestAuthor ? 0 : null,
    ...overrides,
  };
}

function fakeD1(
  resultRows: Record<string, unknown> | Record<string, unknown>[],
  sqlQueries: string[] = [],
): D1Database {
  const results = Array.isArray(resultRows) ? resultRows : [resultRows];
  const firstPageRow = results[0];
  const hasFreehand = results.some((candidate) => {
    if (typeof candidate.geometryJson !== 'string') return false;
    try {
      return (
        (JSON.parse(candidate.geometryJson) as { type?: unknown }).type ===
        'freehand'
      );
    } catch {
      return false;
    }
  });
  const preflight = {
    authorized:
      firstPageRow?.sessionId === sessionId &&
      firstPageRow.guestId === viewerGuestId &&
      firstPageRow.inviteId === inviteId &&
      firstPageRow.workspaceId === workspaceId &&
      firstPageRow.projectId === projectId &&
      firstPageRow.authorizedAlbumId === albumId &&
      firstPageRow.authorizedPhotoId === photoId &&
      firstPageRow.authorizedVersionId === versionId &&
      typeof firstPageRow.permissionsMask === 'number' &&
      (firstPageRow.permissionsMask & 128) !== 0
        ? 1
        : 0,
    containsFreehand: hasFreehand ? 1 : 0,
    guestWatermark:
      typeof firstPageRow?.guestWatermark === 'number'
        ? firstPageRow.guestWatermark
        : 0,
    ownerWatermark:
      typeof firstPageRow?.ownerWatermark === 'number'
        ? firstPageRow.ownerWatermark
        : 0,
    processingWatermark:
      typeof firstPageRow?.processingWatermark === 'number'
        ? firstPageRow.processingWatermark
        : 0,
  };
  return {
    prepare: (sql: string) => {
      sqlQueries.push(sql);
      return {
        bind: () => ({
          first: async () => preflight,
          all: async () => ({ results }),
        }),
      };
    },
  } as unknown as D1Database;
}

async function readShared(
  overrides: Record<string, unknown> = {},
  sqlQueries: string[] = [],
) {
  const reader = new D1GuestSharedAnnotationReader(
    fakeD1(row(overrides), sqlQueries),
  );
  return reader.readShared(secret, albumId, photoId, versionId, {});
}

describe('shared Guest annotation projection', () => {
  it('preserves case-sensitive Guest identity and redacts a peer comment link without can_comment', async () => {
    const page = await readShared({
      authorGuestId: caseDistinctAuthorId,
      permissionsMask: 128,
    });
    const item = page.items[0];

    expect(page.guestId).toBe(viewerGuestId);
    expect(item).toMatchObject({
      annotationId,
      authorLabel: 'Case distinct peer',
      isMine: false,
      commentId: null,
      processing: {
        state: 'open',
        revision: 0,
        annotationRevision: null,
        contentRevision: null,
        updatedAt: null,
        stale: false,
      },
    });
    expect(item).not.toHaveProperty('authorGuestId');
    expect(JSON.stringify(page)).not.toContain(caseDistinctAuthorId);
  });

  it('keeps the current author link visible without can_comment', async () => {
    const page = await readShared({
      authorGuestId: viewerGuestId,
      permissionsMask: 128,
    });

    expect(page.items[0]).toMatchObject({
      isMine: true,
      commentId,
    });
  });

  it('shows a peer comment identifier only when the invite grants can_comment', async () => {
    const page = await readShared({
      authorGuestId: caseDistinctAuthorId,
      permissionsMask: 128 | 256,
    });

    expect(page.items[0]).toMatchObject({
      isMine: false,
      commentId,
    });
  });

  it('projects Owner annotations as non-mine and redacts Owner comment links without can_comment', async () => {
    const page = await readShared({
      authorType: 'owner',
      authorGuestId: null,
      authorLabel: '攝影師',
      permissionsMask: 128,
    });

    expect(page.items[0]).toMatchObject({
      annotationId,
      authorType: 'owner',
      authorLabel: '攝影師',
      isMine: false,
      commentId: null,
      processing: null,
    });
    expect(page.items[0]).not.toHaveProperty('authorGuestId');
    expect(page.items[0]).not.toHaveProperty('authorUserId');
    expect(JSON.stringify(page)).not.toContain(caseDistinctAuthorId);

    const commentEnabledPage = await readShared({
      authorType: 'owner',
      authorGuestId: null,
      authorLabel: '攝影師',
      permissionsMask: 128 | 256,
    });
    expect(commentEnabledPage.items[0]).toMatchObject({
      authorType: 'owner',
      isMine: false,
      commentId,
      processing: null,
    });
  });

  it('projects Guest processing snapshots without exposing identity or content watermarks', async () => {
    const processingUpdatedAtMs = 1_798_200_050_000;
    const sqlQueries: string[] = [];
    const page = await readShared(
      {
        revision: 4,
        processingState: 'resolved',
        processingRevision: 3,
        processingAnnotationRevision: 2,
        processingContentRevision: 1,
        processingUpdatedAtMs,
        processingStale: 0,
      },
      sqlQueries,
    );
    expect(page.items[0]?.processing).toEqual({
      state: 'resolved',
      revision: 3,
      annotationRevision: 2,
      contentRevision: 1,
      updatedAt: new Date(processingUpdatedAtMs).toISOString(),
      stale: false,
    });
    expect(JSON.stringify(page.items[0]?.processing)).not.toContain(
      viewerGuestId,
    );
    expect(JSON.stringify(page.items[0]?.processing)).not.toContain(sessionId);
    const sql = sqlQueries.join('\n').replace(/\s+/gu, ' ');
    for (const scopeJoin of [
      'ps.annotation_id=x.annotationId',
      'ps.invite_id=av.inviteId AND ps.workspace_id=av.workspaceId',
      'ps.project_id=av.projectId AND ps.album_id=av.albumId',
      'ps.photo_id=av.photoId AND ps.version_id=av.versionId',
    ])
      expect(sql).toContain(scopeJoin);
    expect(sql).not.toContain('current_content_revision');

    const stalePage = await readShared({
      revision: 5,
      processingState: 'in_progress',
      processingRevision: 4,
      processingAnnotationRevision: 2,
      processingContentRevision: 1,
      processingUpdatedAtMs,
      processingStale: 1,
    });
    expect(stalePage.items[0]?.processing?.stale).toBe(true);
  });

  it('rejects processing acknowledgements beyond the annotation or content revision', async () => {
    await expect(
      readShared({
        revision: 2,
        processingRevision: 1,
        processingAnnotationRevision: 3,
        processingContentRevision: 2,
        processingUpdatedAtMs: 1_798_200_050_000,
        processingStale: 0,
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      readShared({
        revision: 3,
        processingRevision: 1,
        processingAnnotationRevision: 2,
        processingContentRevision: 3,
        processingUpdatedAtMs: 1_798_200_050_000,
        processingStale: 0,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('uses a version-three cursor with independent Guest, Owner, and processing watermarks', async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      row({
        annotationId:
          '88888888-8888-4888-8888-' +
          (index + 1).toString(16).padStart(12, '0'),
        createdAtMs: 1_798_200_000_000 + index,
        guestWatermark: 31,
        ownerWatermark: 17,
        processingWatermark: 11,
      }),
    );
    const reader = new D1GuestSharedAnnotationReader(fakeD1(rows));
    const page = await reader.readShared(
      secret,
      albumId,
      photoId,
      versionId,
      {},
    );
    expect(page.items).toHaveLength(24);
    expect(page.nextCursor).toBeTruthy();

    const cursorJson = Buffer.from(page.nextCursor!, 'base64url').toString(
      'utf8',
    );
    const cursor = JSON.parse(cursorJson) as Record<string, unknown>;
    expect(cursor).toMatchObject({
      schemaVersion: 3,
      guestWatermark: 31,
      ownerWatermark: 17,
      processingWatermark: 11,
    });
    expect(cursor).not.toHaveProperty('watermark');

    for (const changedWatermark of [
      'guestWatermark',
      'ownerWatermark',
      'processingWatermark',
    ] as const) {
      const changedRows = rows.map((value) => ({
        ...value,
        [changedWatermark]: (value[changedWatermark] as number) + 1,
      }));
      const changedReader = new D1GuestSharedAnnotationReader(
        fakeD1(changedRows),
      );
      await expect(
        changedReader.readShared(secret, albumId, photoId, versionId, {
          cursor: page.nextCursor,
        }),
      ).rejects.toMatchObject({
        code: 'ANNOTATION_HISTORY_CHANGED',
        status: 409,
      });
    }
  });
});
