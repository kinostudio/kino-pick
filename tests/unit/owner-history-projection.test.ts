import { describe, expect, it } from 'vitest';
import {
  OWNER_HISTORY_PROJECTED_ACTIONS,
  projectOwnerHistoryDetails,
} from '../../apps/worker/src/owner-history-projection';

const id = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const commentId = '33333333-3333-4333-8333-333333333333';
const occurredAt = '2026-10-28T12:30:00.000Z';

function project(action: string, before: unknown, after: unknown) {
  return projectOwnerHistoryDetails(
    action,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
  );
}

describe('Owner history detail projection', () => {
  it('registers emitted product action families and the two export actions', () => {
    expect(OWNER_HISTORY_PROJECTED_ACTIONS).toEqual(
      expect.arrayContaining([
        'workspace.created',
        'project.created',
        'project.renamed',
        'project.archived',
        'project.restored',
        'album.created',
        'album.renamed',
        'album.protection_changed',
        'album.archived',
        'album.restored',
        'project.versioning_mode_changed',
        'upload.reserved',
        'upload.authorized',
        'upload.completed',
        'upload.cancelled',
        'upload.expired',
        'upload.capability_fenced',
        'upload.needs_review',
        'owner.external_intent_claimed',
        'processing.enqueued',
        'processing.running',
        'processing.retryable',
        'processing.needs_review',
        'processing.succeeded',
        'processing.abandoned',
        'photo.version.created',
        'photo.version_current_changed',
        'share.created',
        'share.scope_sealed',
        'share.revoked',
        'guest.session_created',
        'guest.session_revoked',
        'security.guest_kdf_acquired',
        'security.guest_kdf_released',
        'selection.added',
        'selection.removed',
        'selection.version_changed',
        'selection.submitted',
        'selection.reopened',
        'selection.round_initialized',
        'selection.policy_changed',
        'selection.policy_configuration_changed',
        'rating.set',
        'rating.cleared',
        'favorite.added',
        'favorite.removed',
        'tag.added',
        'tag.removed',
        'shared_review.created',
        'shared_review.reopened',
        'shared_selection.added',
        'shared_selection.removed',
        'shared_selection.version_changed',
        'shared_selection.submitted',
        'download.requested',
        'download.generated',
        'version_approval.requested',
        'version_approval.confirmed',
        'comment.create',
        'comment.edit',
        'comment.delete',
        'comment.resolve',
        'comment.reopen',
        'owner.comment_reply_created',
        'owner.comment_reply_edited',
        'owner.comment_reply_deleted',
        'owner.comment_processing_changed',
        'annotation.created',
        'annotation.updated',
        'annotation.deleted',
        'annotation.resolved',
        'annotation.reopened',
        'owner.annotation_created',
        'owner.annotation_updated',
        'owner.annotation_deleted',
        'owner.annotation_resolved',
        'owner.annotation_reopened',
        'owner.annotation_processing_changed',
        'owner_history.export_started',
        'owner_history.export_completed',
      ]),
    );
    expect(new Set(OWNER_HISTORY_PROJECTED_ACTIONS).size).toBe(
      OWNER_HISTORY_PROJECTED_ACTIONS.length,
    );
    expect(OWNER_HISTORY_PROJECTED_ACTIONS).not.toContain(
      'processing.unsupported',
    );
  });

  it('keeps known metadata and strips raw request, credential, URL, object-key and hash fields', () => {
    const result = project('upload.authorized', null, {
      uploadSessionId: id,
      expiresAt: occurredAt,
      contentType: 'image/jpeg',
      expectedBytes: 1234,
      sha256: 'a'.repeat(64),
      signedUrl: 'https://private.example/signed',
      objectKey: 'private/workspace/photo/original',
      token: 'bearer',
      requestJson: {
        password: 'secret',
        mediaUrl: 'https://private.example/photo',
      },
    });
    expect(result).toEqual({
      status: 'available',
      before: null,
      after: {
        uploadSessionId: id,
        expiresAt: occurredAt,
        contentType: 'image/jpeg',
        expectedBytes: 1234,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /sha256|signedUrl|objectKey|bearer|password|mediaUrl|requestJson/i,
    );
  });

  it('projects CRUD and version-mode fields without leaking unknown source fields', () => {
    expect(
      project(
        'project.renamed',
        {
          id,
          workspaceId: id,
          name: 'Before',
          status: 'draft',
          versioningMode: 'manual',
          revision: 1,
          createdAt: occurredAt,
          secret: 'no',
        },
        {
          id,
          workspaceId: id,
          name: 'After',
          status: 'draft',
          versioningMode: 'manual',
          revision: 2,
          createdAt: occurredAt,
          requestJson: { signedUrl: 'private' },
        },
      ),
    ).toEqual({
      status: 'available',
      before: {
        id,
        workspaceId: id,
        name: 'Before',
        status: 'draft',
        versioningMode: 'manual',
        revision: 1,
        createdAt: occurredAt,
      },
      after: {
        id,
        workspaceId: id,
        name: 'After',
        status: 'draft',
        versioningMode: 'manual',
        revision: 2,
        createdAt: occurredAt,
      },
    });
    expect(
      project(
        'project.versioning_mode_changed',
        { mode: 'manual', revision: 2, raw: 'discard' },
        { mode: 'assisted', revision: 3, raw: 'discard' },
      ),
    ).toEqual({
      status: 'available',
      before: { mode: 'manual', revision: 2 },
      after: { mode: 'assisted', revision: 3 },
    });
  });

  it('preserves project and album names up to 160 Unicode code points', () => {
    const name160 = '🙂'.repeat(160);
    const name161 = '🙂'.repeat(161);
    expect(
      project('project.created', null, {
        id,
        workspaceId: id,
        name: name160,
        status: 'draft',
        versioningMode: 'manual',
        revision: 1,
        createdAt: occurredAt,
      }),
    ).toMatchObject({ status: 'available', after: { name: name160 } });
    expect(
      project('album.created', null, {
        id,
        workspaceId: id,
        projectId: id,
        name: name160,
        state: 'draft',
        isPinned: false,
        legalHold: false,
        revision: 1,
        createdAt: occurredAt,
      }),
    ).toMatchObject({ status: 'available', after: { name: name160 } });

    expect(
      project('project.created', null, {
        id,
        workspaceId: id,
        name: name161,
        status: 'draft',
        versioningMode: 'manual',
        revision: 1,
        createdAt: occurredAt,
      }),
    ).toEqual({ status: 'invalid', before: null, after: null });
    expect(
      project('album.created', null, {
        id,
        workspaceId: id,
        projectId: id,
        name: name161,
        state: 'draft',
        isPinned: false,
        legalHold: false,
        revision: 1,
        createdAt: occurredAt,
      }),
    ).toEqual({ status: 'invalid', before: null, after: null });
  });

  it('projects upload lifecycle and version metadata while dropping checksums and storage keys', () => {
    expect(
      project('upload.reserved', null, {
        id,
        workspaceId: id,
        projectId: id,
        albumId: id,
        originalFilename: 'portrait.jpg',
        expectedBytes: 1234,
        reservedBytes: 1234,
        status: 'reserved',
        expiresAt: occurredAt,
        createdAt: occurredAt,
        objectKey: 'private/key',
      }).after,
    ).toEqual({
      id,
      workspaceId: id,
      projectId: id,
      albumId: id,
      originalFilename: 'portrait.jpg',
      expectedBytes: 1234,
      reservedBytes: 1234,
      status: 'reserved',
      expiresAt: occurredAt,
      createdAt: occurredAt,
    });

    expect(
      project('photo.version.created', null, {
        versionId,
        versionNo: 2,
        parentVersionId: id,
        status: 'private',
        changeType: 'new_retouch',
        changeNote: 'Retouch approved',
        labels: ['warm'],
        actualBytes: 54321,
        contentType: 'image/jpeg',
        sha256: 'b'.repeat(64),
        width: 2400,
        height: 1600,
        assetId: commentId,
        objectKey: 'private/photo/version',
      }).after,
    ).toEqual({
      versionId,
      versionNo: 2,
      parentVersionId: id,
      status: 'private',
      changeType: 'new_retouch',
      changeNote: 'Retouch approved',
      labels: ['warm'],
      actualBytes: 54321,
      contentType: 'image/jpeg',
      width: 2400,
      height: 1600,
      assetId: commentId,
    });
  });

  it('projects processing transitions without output hashes or private storage paths', () => {
    const result = project(
      'processing.succeeded',
      { status: 'running', reservedBytes: 16_777_216, leaseEpoch: 1 },
      {
        status: 'succeeded',
        reservedBytes: 0,
        leaseEpoch: 1,
        reason: null,
        outputs: [
          {
            kind: 'thumbnail',
            bytes: 1234,
            mime: 'image/jpeg',
            width: 320,
            height: 200,
            sha256: 'c'.repeat(64),
            objectKey: 'private/derived/thumbnail',
            url: 'https://private.example/thumbnail',
          },
          {
            kind: 'preview',
            bytes: 2345,
            mime: 'image/jpeg',
            width: 1200,
            height: 750,
            sha256: 'd'.repeat(64),
          },
        ],
      },
    );
    expect(result.status).toBe('available');
    expect(result.after).toEqual({
      status: 'succeeded',
      reservedBytes: 0,
      leaseEpoch: 1,
      reason: null,
      outputs: [
        {
          kind: 'thumbnail',
          bytes: 1234,
          mime: 'image/jpeg',
          width: 320,
          height: 200,
        },
        {
          kind: 'preview',
          bytes: 2345,
          mime: 'image/jpeg',
          width: 1200,
          height: 750,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /sha256|objectKey|private\.example/i,
    );
  });

  it('projects selection, rating, favorite, tag and shared-review detail fields', () => {
    expect(
      project(
        'selection.added',
        { selected: false, versionId: null, selectedAt: null },
        {
          selected: true,
          versionId,
          selectedAt: occurredAt,
          requestJson: { bearer: 'secret' },
        },
      ).after,
    ).toEqual({ selected: true, versionId, selectedAt: occurredAt });
    expect(
      project(
        'rating.set',
        { photoId: id, stars: null, versionId: null, updatedAt: null },
        {
          photoId: id,
          stars: 5,
          versionId,
          updatedAt: occurredAt,
        },
      ).after,
    ).toEqual({ photoId: id, stars: 5, versionId, updatedAt: occurredAt });
    expect(
      project('favorite.added', null, {
        photoId: id,
        favored: true,
        versionId,
        updatedAt: occurredAt,
      }).after,
    ).toEqual({ photoId: id, favored: true, versionId, updatedAt: occurredAt });
    expect(
      project('tag.added', null, {
        tagId: commentId,
        label: 'Family',
        present: true,
        versionId,
        updatedAt: occurredAt,
      }).after,
    ).toEqual({
      tagId: commentId,
      label: 'Family',
      present: true,
      versionId,
      updatedAt: occurredAt,
    });
    expect(
      project('shared_review.created', null, {
        reviewId: id,
        title: 'Selections',
        memberCount: 2,
        roundNo: 1,
        revision: 0,
        status: 'open',
        guestIds: [id, versionId],
      }).after,
    ).toEqual({
      reviewId: id,
      title: 'Selections',
      memberCount: 2,
      roundNo: 1,
      revision: 0,
      status: 'open',
    });
    const legacyDownload = {
      reviewId: id,
      submissionId: versionId,
      format: 'csv',
      selectedCount: 3,
    };
    const projectedDownload = project(
      'download.generated',
      null,
      legacyDownload,
    );
    expect(projectedDownload).toEqual({
      status: 'available',
      before: null,
      after: legacyDownload,
    });
    expect(
      project('download.generated', null, {
        ...legacyDownload,
        signedUrl: 'https://private.example/signed',
      }),
    ).toEqual({ status: 'invalid', before: null, after: null });
  });

  it('preserves comment bodies and strict annotation geometry/style while stripping nested extras', () => {
    const body = '🙂'.repeat(2_000);
    expect(
      project(
        'comment.edit',
        {
          commentId,
          revision: 1,
          state: 'open',
          body: 'Before',
        },
        {
          commentId,
          revision: 2,
          state: 'open',
          body,
          rawRequest: { token: 'secret' },
        },
      ),
    ).toMatchObject({
      status: 'available',
      after: { commentId, revision: 2, state: 'open', body },
    });

    expect(
      project('owner.comment_reply_created', null, {
        commentId,
        revision: 1,
        state: 'open',
        body: 'Owner reply',
        parentCommentId: id,
        requestJson: { url: 'private' },
      }).after,
    ).toEqual({
      commentId,
      revision: 1,
      state: 'open',
      body: 'Owner reply',
      parentCommentId: id,
    });

    const annotation = project('annotation.created', null, {
      annotationId: commentId,
      revision: 1,
      state: 'open',
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 120,
        y: 340,
        privateUrl: 'private',
      },
      style: { color: 'amber', credential: 'secret' },
      commentId: id,
      sessionSecret: 'secret',
    });
    expect(annotation.after).toEqual({
      annotationId: commentId,
      revision: 1,
      state: 'open',
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 120,
        y: 340,
      },
      style: { color: 'amber' },
      commentId: id,
    });
  });

  it('projects independent Owner comment/annotation processing and invite credential metadata', () => {
    expect(
      project(
        'owner.comment_processing_changed',
        {
          commentId,
          state: 'open',
          revision: 0,
          commentRevision: null,
          contentRevision: null,
        },
        {
          commentId,
          state: 'in_progress',
          revision: 1,
          commentRevision: 2,
          contentRevision: 2,
        },
      ),
    ).toMatchObject({
      status: 'available',
      after: { state: 'in_progress', revision: 1 },
    });

    expect(
      project('owner.annotation_processing_changed', null, {
        ownerId: id,
        annotationId: commentId,
        inviteId: versionId,
        workspaceId: id,
        projectId: id,
        albumId: id,
        photoId: id,
        versionId,
        state: 'resolved',
        revision: 2,
        annotationRevision: 3,
        contentRevision: 4,
        updatedAtMs: 100,
        secret: 'discard',
      }).after,
    ).toEqual({
      ownerId: id,
      annotationId: commentId,
      inviteId: versionId,
      workspaceId: id,
      projectId: id,
      albumId: id,
      photoId: id,
      versionId,
      state: 'resolved',
      revision: 2,
      annotationRevision: 3,
      contentRevision: 4,
      updatedAtMs: 100,
    });

    expect(
      project('share.created', null, {
        inviteId: id,
        accessMode: 'generated_password',
        permissionsMask: 1024,
        expiresAtMs: 123456,
        maxUses: null,
        passwordVerifier: 'secret',
        token: 'secret',
        bearerUrl: 'private',
      }).after,
    ).toEqual({
      inviteId: id,
      accessMode: 'generated_password',
      permissionsMask: 1024,
      expiresAtMs: 123456,
      maxUses: null,
    });
  });

  it('projects fixed version approval scope while stripping private invitation and session fields', () => {
    const request = project('version_approval.requested', null, {
      approvalRequestId: id,
      photoId: commentId,
      versionId,
      headRevision: 7,
      inviteCount: 2,
      inviteIds: [id, versionId],
      inviteId: id,
      guestId: id,
      guestSessionId: id,
      sessionId: 'private-session',
      requestId: 'private-request',
      token: 'bearer',
      signedUrl: 'https://private.example/signed',
    });
    expect(request).toEqual({
      status: 'available',
      before: null,
      after: {
        approvalRequestId: id,
        photoId: commentId,
        versionId,
        headRevision: 7,
        inviteCount: 2,
      },
    });
    expect(JSON.stringify(request)).not.toMatch(
      /"(?:inviteIds?|guestId|guestSessionId|sessionId|requestId|token|signedUrl)"/i,
    );

    const confirmation = project('version_approval.confirmed', null, {
      approvalRequestId: id,
      photoId: commentId,
      versionId,
      inviteId: id,
      guestId: id,
      guestSessionId: id,
      sessionId: 'private-session',
      requestId: 'private-request',
      token: 'bearer',
    });
    expect(confirmation).toEqual({
      status: 'available',
      before: null,
      after: { approvalRequestId: id, photoId: commentId, versionId },
    });
    expect(JSON.stringify(confirmation)).not.toMatch(
      /"(?:inviteId|guestId|guestSessionId|sessionId|requestId|token)"/i,
    );
    expect(
      project('version_approval.confirmed', null, {
        approvalRequestId: id,
        photoId: commentId,
      }),
    ).toEqual({ status: 'invalid', before: null, after: null });
  });

  it('keeps migration-only round initialization and explicit export metadata bounded', () => {
    expect(
      project(
        'selection.round_initialized',
        {
          inviteId: id,
          guestId: versionId,
          roundNo: 2,
          selectionRevision: 0,
        },
        {
          inviteId: id,
          guestId: versionId,
          roundNo: 2,
          selectionRevision: 1,
          secret: 'discard',
        },
      ).after,
    ).toEqual({
      inviteId: id,
      guestId: versionId,
      roundNo: 2,
      selectionRevision: 1,
    });

    const exportStarted = project('owner_history.export_started', null, {
      generationId: id,
      format: 'json',
      snapshotRowId: '123',
      filters: {
        projectId: id,
        action: 'photo.version.created',
        snapshotToken: 'secret',
      },
      snapshotToken: 'secret',
    });
    expect(exportStarted.after).toEqual({
      generationId: id,
      format: 'json',
      snapshotRowId: '123',
      filters: { projectId: id, action: 'photo.version.created' },
    });
    const maxActionFilter = 'a'.repeat(128);
    expect(
      project('owner_history.export_started', null, {
        generationId: id,
        format: 'csv',
        snapshotRowId: '123',
        filters: { action: maxActionFilter },
      }).after,
    ).toEqual({
      generationId: id,
      format: 'csv',
      snapshotRowId: '123',
      filters: { action: maxActionFilter },
    });
    expect(
      project('owner_history.export_started', null, {
        generationId: id,
        format: 'csv',
        snapshotRowId: '123',
        filters: { action: 'a'.repeat(129) },
      }),
    ).toEqual({ status: 'invalid', before: null, after: null });

    expect(
      project('owner_history.export_completed', null, {
        generationId: id,
        format: 'csv',
        snapshotRowId: '123',
        filters: {},
        count: 12,
        body: 'discard',
      }),
    ).toEqual({
      status: 'available',
      before: null,
      after: {
        generationId: id,
        format: 'csv',
        snapshotRowId: '123',
        filters: {},
        count: 12,
      },
    });
  });

  it('omits unknown actions and fails closed on malformed recognized JSON, types or oversize data', () => {
    expect(
      project('future.secret_action', null, { password: 'secret' }),
    ).toEqual({ status: 'omitted', before: null, after: null });
    expect(project('rating.set', null, { stars: '5' })).toEqual({
      status: 'invalid',
      before: null,
      after: null,
    });
    expect(projectOwnerHistoryDetails('comment.edit', '{', '{}')).toEqual({
      status: 'invalid',
      before: null,
      after: null,
    });
    expect(
      projectOwnerHistoryDetails(
        'comment.edit',
        null,
        JSON.stringify({ body: 'x'.repeat(32_769) }),
      ),
    ).toEqual({ status: 'invalid', before: null, after: null });
  });

  it('accepts legitimate NULL sides for creation and lifecycle events', () => {
    expect(
      project('workspace.created', null, {
        id,
        name: 'Main',
        quotaBytes: 1_000,
      }),
    ).toEqual({
      status: 'available',
      before: null,
      after: { id, name: 'Main', quotaBytes: 1_000 },
    });
    expect(project('owner.signed_in', null, null)).toEqual({
      status: 'available',
      before: null,
      after: null,
    });
  });
});
