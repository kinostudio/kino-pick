import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { D1OwnerAnnotationsRepository } from '../../apps/worker/src/owner-annotations';
import {
  ownerAnnotationItemSchema,
  ownerAnnotationReadQuerySchema,
  ownerAnnotationsCapabilitiesSchema,
  ownerAnnotationsPageSchema,
} from '../../packages/contracts/src/owner-annotations';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const timestamp = '2026-10-28T10:00:00.000Z';
const geometry = {
  type: 'point' as const,
  coordinateSpace: 'normalized_1e6' as const,
  x: 250_000,
  y: 750_000,
};
const style = { color: 'amber' as const };
const liveItem = {
  annotationId: id(1),
  photoId: id(2),
  versionId: id(3),
  authorGuestId: id(4),
  revision: 1,
  geometry,
  style,
  commentId: id(5),
  state: 'open' as const,
  authorLabel: '來賓 A',
  canEdit: false as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const ownerId = id(10);
const sessionId = id(11);
const albumId = id(6);
const inviteId = id(12);
const pageRow = (overrides: Record<string, unknown> = {}) => ({
  actorId: ownerId,
  workspaceId: id(13),
  projectId: id(14),
  albumId,
  inviteId,
  authorizedPhotoId: liveItem.photoId,
  authorizedVersionId: liveItem.versionId,
  guestWatermark: 31,
  processingWatermark: 17,
  annotationId: liveItem.annotationId,
  photoId: liveItem.photoId,
  versionId: liveItem.versionId,
  authorGuestId: liveItem.authorGuestId,
  revision: 4,
  geometryJson: JSON.stringify(geometry),
  styleJson: JSON.stringify(style),
  commentId: liveItem.commentId,
  state: 'open',
  authorLabel: liveItem.authorLabel,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdAtMs: 1_798_200_000_000,
  processingState: 'resolved',
  processingRevision: 3,
  processingAnnotationRevision: 2,
  processingContentRevision: 1,
  processingUpdatedAtMs: 1_798_200_050_000,
  processingStale: 0,
  ...overrides,
});

function fakeD1(
  resultRows: Record<string, unknown>[],
  sqlQueries: string[] = [],
  ownerAuthorized = true,
): D1Database {
  return {
    prepare: (sql: string) => {
      sqlQueries.push(sql);
      return {
        bind: () => ({
          first: async () => {
            if (sql.includes('AS containsFreehand')) {
              const firstRow = resultRows[0];
              return {
                authorized: 1,
                containsFreehand: 0,
                guestWatermark: firstRow?.guestWatermark ?? 31,
                ownerWatermark: null,
                processingWatermark: firstRow?.processingWatermark ?? 17,
              };
            }
            return ownerAuthorized ? { authorized: 1 } : null;
          },
          all: async () => ({ results: resultRows }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe('Owner annotation reads', () => {
  it('checks the current Owner session before running invite-scoped reads', async () => {
    const queries: string[] = [];
    const reader = new D1OwnerAnnotationsRepository(fakeD1([], queries, false));

    await expect(
      reader.read(
        ownerId,
        sessionId,
        albumId,
        liveItem.photoId,
        liveItem.versionId,
        { inviteId },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED', status: 403 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain('containsFreehand');
  });

  it('requires an explicit invitation and keeps the read selector strict', () => {
    expect(
      ownerAnnotationReadQuerySchema.safeParse({ inviteId: id(6) }).success,
    ).toBe(true);
    expect(ownerAnnotationReadQuerySchema.safeParse({}).success).toBe(false);
    expect(
      ownerAnnotationReadQuerySchema.safeParse({
        inviteId: id(6),
        cursor: 'page-2',
      }).success,
    ).toBe(true);
    expect(
      ownerAnnotationReadQuerySchema.safeParse({
        inviteId: id(6),
        annotationId: id(1),
      }).success,
    ).toBe(true);
    expect(
      ownerAnnotationReadQuerySchema.safeParse({
        inviteId: id(6),
        cursor: 'page-2',
        annotationId: id(1),
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationReadQuerySchema.safeParse({
        inviteId: id(6),
        cursor: 'x'.repeat(1025),
      }).success,
    ).toBe(false);
    for (const injected of [
      { actorId: id(7) },
      { guestId: id(7) },
      { sessionId: 'private-session' },
      { workspaceId: id(7) },
      { inviteToken: 'private-token' },
    ])
      expect(
        ownerAnnotationReadQuerySchema.safeParse({
          inviteId: id(6),
          ...injected,
        }).success,
      ).toBe(false);
  });

  it('exposes the guest author identity with a literal readonly claim', () => {
    const parsed = ownerAnnotationItemSchema.safeParse(liveItem);
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.processing).toEqual({
        state: 'open',
        revision: 0,
        annotationRevision: null,
        contentRevision: null,
        updatedAt: null,
        stale: false,
      });
    expect(
      ownerAnnotationItemSchema.safeParse({ ...liveItem, canEdit: true })
        .success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...liveItem, isMine: true })
        .success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...liveItem, sessionId: id(8) })
        .success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({
        ...liveItem,
        inviteToken: 'secret',
      }).success,
    ).toBe(false);
  });

  it('keeps processing acknowledgement within the source annotation revision', () => {
    const processing = {
      state: 'resolved' as const,
      revision: 2,
      annotationRevision: 1,
      contentRevision: 1,
      updatedAt: timestamp,
      stale: false,
    };
    expect(
      ownerAnnotationItemSchema.safeParse({ ...liveItem, processing }).success,
    ).toBe(true);
    expect(
      ownerAnnotationItemSchema.safeParse({
        ...liveItem,
        processing: { ...processing, annotationRevision: 2 },
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({
        ...liveItem,
        processing: {
          ...processing,
          annotationRevision: 1,
          contentRevision: 2,
        },
      }).success,
    ).toBe(false);
  });

  it('requires geometry and style for live states and redacts deleted tombstones', () => {
    for (const state of ['open', 'resolved'] as const)
      expect(
        ownerAnnotationItemSchema.safeParse({ ...liveItem, state }).success,
      ).toBe(true);
    const tombstone = {
      ...liveItem,
      revision: 2,
      state: 'deleted' as const,
      geometry: null,
      style: null,
      commentId: null,
    };
    expect(ownerAnnotationItemSchema.safeParse(tombstone).success).toBe(true);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...tombstone, geometry }).success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...tombstone, style }).success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...tombstone, commentId: id(5) })
        .success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...liveItem, geometry: null })
        .success,
    ).toBe(false);
    expect(
      ownerAnnotationItemSchema.safeParse({ ...liveItem, style: null }).success,
    ).toBe(false);
  });

  it('keeps every page item in the selected photo/version scope and unique', () => {
    const page = {
      inviteId: id(6),
      photoId: id(2),
      versionId: id(3),
      items: [liveItem],
      nextCursor: null,
    };
    expect(ownerAnnotationsPageSchema.safeParse(page).success).toBe(true);
    expect(
      ownerAnnotationsPageSchema.safeParse({
        ...page,
        items: [{ ...liveItem, photoId: id(9) }],
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationsPageSchema.safeParse({
        ...page,
        items: [{ ...liveItem, versionId: id(9) }],
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationsPageSchema.safeParse({
        ...page,
        items: [liveItem, liveItem],
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationsPageSchema.safeParse({
        ...page,
        items: Array.from({ length: 25 }, (_, index) => ({
          ...liveItem,
          annotationId: id(index + 1),
        })),
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationsPageSchema.safeParse({ ...page, privateSession: 'x' })
        .success,
    ).toBe(false);
  });

  it('advertises only the independent capability bit', () => {
    expect(
      ownerAnnotationsCapabilitiesSchema.safeParse({ enabled: true }).success,
    ).toBe(true);
    expect(
      ownerAnnotationsCapabilitiesSchema.safeParse({ enabled: false }).success,
    ).toBe(true);
    expect(
      ownerAnnotationsCapabilitiesSchema.safeParse({
        enabled: true,
        canAnnotate: true,
      }).success,
    ).toBe(false);
  });

  it('joins and projects a full-scope Guest processing snapshot without leaking its internal watermark', async () => {
    const queries: string[] = [];
    const reader = new D1OwnerAnnotationsRepository(
      fakeD1([pageRow()], queries),
    );
    const page = await reader.read(
      ownerId,
      sessionId,
      albumId,
      liveItem.photoId,
      liveItem.versionId,
      { inviteId },
    );

    expect(page.items[0]?.processing).toEqual({
      state: 'resolved',
      revision: 3,
      annotationRevision: 2,
      contentRevision: 1,
      updatedAt: new Date(1_798_200_050_000).toISOString(),
      stale: false,
    });
    expect(JSON.stringify(page)).not.toContain(ownerId);
    expect(JSON.stringify(page)).not.toContain(sessionId);
    const sql = queries.join('\n').replace(/\s+/gu, ' ');
    for (const scopeJoin of [
      'ps.annotation_id=x.id AND ps.invite_id=x.invite_id',
      'ps.workspace_id=x.workspace_id AND ps.project_id=x.project_id',
      'ps.album_id=x.album_id AND ps.photo_id=x.photo_id',
      'ps.version_id=x.version_id',
    ])
      expect(sql).toContain(scopeJoin);
    expect(sql).not.toContain('current_content_revision');
  });

  it('projects the synthetic initial processing snapshot for an unprocessed Guest annotation', async () => {
    const reader = new D1OwnerAnnotationsRepository(
      fakeD1([
        pageRow({
          processingState: 'open',
          processingRevision: 0,
          processingAnnotationRevision: null,
          processingContentRevision: null,
          processingUpdatedAtMs: null,
          processingStale: 0,
        }),
      ]),
    );
    const page = await reader.read(
      ownerId,
      sessionId,
      albumId,
      liveItem.photoId,
      liveItem.versionId,
      { inviteId },
    );

    expect(page.items[0]?.processing).toEqual({
      state: 'open',
      revision: 0,
      annotationRevision: null,
      contentRevision: null,
      updatedAt: null,
      stale: false,
    });
  });

  it('binds Owner-read cursors to independent Guest and processing watermarks', async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      pageRow({
        annotationId:
          '88888888-8888-4888-8888-' +
          (index + 1).toString(16).padStart(12, '0'),
        createdAtMs: 1_798_200_000_000 + index,
      }),
    );
    const reader = new D1OwnerAnnotationsRepository(fakeD1(rows));
    const page = await reader.read(
      ownerId,
      sessionId,
      albumId,
      liveItem.photoId,
      liveItem.versionId,
      { inviteId },
    );
    expect(page.items).toHaveLength(24);
    expect(page.nextCursor).toBeTruthy();
    const cursor = JSON.parse(
      Buffer.from(page.nextCursor!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(cursor).toMatchObject({
      schemaVersion: 2,
      guestWatermark: 31,
      processingWatermark: 17,
    });
    expect(cursor).not.toHaveProperty('watermark');

    for (const watermarkPatch of [
      { guestWatermark: 32 },
      { processingWatermark: 18 },
    ]) {
      const changedRows = rows.map((value) => ({
        ...value,
        ...watermarkPatch,
      }));
      const changedReader = new D1OwnerAnnotationsRepository(
        fakeD1(changedRows),
      );
      await expect(
        changedReader.read(
          ownerId,
          sessionId,
          albumId,
          liveItem.photoId,
          liveItem.versionId,
          { inviteId, cursor: page.nextCursor! },
        ),
      ).rejects.toMatchObject({
        code: 'ANNOTATION_HISTORY_CHANGED',
        status: 409,
      });
    }
  });
});
