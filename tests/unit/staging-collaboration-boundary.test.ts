import { describe, expect, it } from 'vitest';
import {
  freehandAnnotationsCapability,
  guestFeedbackCapability,
  guestHistoryCapability,
  guestTagsCapability,
  guestVersionComparisonCapability,
  ownerAnnotationProcessingCapability,
  ownerCommentsCapability,
  ownerHistoryCapability,
  photoVersionsCapability,
  photographerRecommendationsCapability,
  projectVersioningCapability,
  versionUploadCapability,
  type WorkerEnv,
  configuration,
} from '../../apps/worker/src/config';
import {
  stagingCollaborationValidationEnabled,
  STAGING_GUEST_SCOPE,
  stagingGuestValidationEnabled,
} from '../../apps/worker/src/staging-guest-scope';
import {
  stagingGuestAllowedPermissionNames,
  stagingGuestPermissionMaskSupported,
  stagingGuestPermissionsSupported,
} from '../../apps/worker/src/staging-guest-permissions';
import {
  guestPermissionBit,
  guestPermissionNames,
  type GuestPermission,
} from '../../packages/contracts/src/guest-access';
import {
  stagingCollaborationGuestRequestAllowed,
  stagingCollaborationOwnerRequestAllowed,
} from '../../apps/worker/src/staging-collaboration-boundary';

it('limits Oracle settings and activity routes to the exact methods and scoped albums', () => {
  expect(
    stagingCollaborationOwnerRequestAllowed(
      'GET',
      '/api/v1/storage/oracle-policy',
    ),
  ).toBe(true);
  expect(
    stagingCollaborationOwnerRequestAllowed(
      'PUT',
      '/api/v1/storage/oracle-policy',
    ),
  ).toBe(true);
  expect(
    stagingCollaborationOwnerRequestAllowed(
      'DELETE',
      '/api/v1/storage/oracle-policy',
    ),
  ).toBe(false);
  const path = '/api/v1/albums/' + STAGING_GUEST_SCOPE.albumId + '/activity';
  expect(stagingCollaborationOwnerRequestAllowed('GET', path)).toBe(true);
  expect(stagingCollaborationOwnerRequestAllowed('POST', path)).toBe(false);
  const guest =
    '/api/guest/albums/' + STAGING_GUEST_SCOPE.albumId + '/activity';
  expect(stagingCollaborationGuestRequestAllowed('POST', guest)).toBe(true);
  expect(stagingCollaborationGuestRequestAllowed('GET', guest)).toBe(false);
  expect(
    stagingCollaborationGuestRequestAllowed(
      'POST',
      guest.replace(
        STAGING_GUEST_SCOPE.albumId,
        '11111111-1111-4111-8111-111111111111',
      ),
    ),
  ).toBe(false);
});

const base = {
  APP_ENV: 'staging',
  APP_URL: STAGING_GUEST_SCOPE.origin,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  STAGING_GUEST_VALIDATION: 'true',
  R2_ACCOUNT_ID: STAGING_GUEST_SCOPE.accountId,
  R2_BUCKET_NAME: STAGING_GUEST_SCOPE.bucket,
};
const collaboration = {
  ...base,
  STAGING_COLLABORATION_VALIDATION: 'true',
  DIRECT_UPLOAD_ENABLED: 'true',
  CLOUDFLARE_IMAGE_PROCESSING_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_SELECTION_ENABLED: 'true',
  ALBUM_ACTIVATION_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  PHOTO_VERSION_UPLOADS_ENABLED: 'true',
  PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'true',
  GUEST_VERSION_COMPARISON_ENABLED: 'true',
  GUEST_FEEDBACK_ENABLED: 'true',
  GUEST_TAGS_ENABLED: 'true',
  GUEST_HISTORY_ENABLED: 'true',
  GUEST_COMMENTS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'true',
  OWNER_COMMENTS_ENABLED: 'true',
  OWNER_COMMENT_PROCESSING_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  OWNER_ANNOTATION_PROCESSING_ENABLED: 'true',
  OWNER_HISTORY_ENABLED: 'true',
  PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
};
const workerEnv = (env: object) => env as unknown as WorkerEnv;
const disabledPermissions = Object.fromEntries(
  guestPermissionNames.map((name) => [name, false]),
) as Record<GuestPermission, boolean>;
const fixedPhoto = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fixedVersion = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const foreignAlbum = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('bounded collaboration validation profile', () => {
  it('requires its own opt-in on top of the exact existing B Guest scope', () => {
    expect(stagingGuestValidationEnabled(base)).toBe(true);
    expect(stagingCollaborationValidationEnabled(base)).toBe(false);
    expect(stagingCollaborationValidationEnabled(collaboration)).toBe(true);

    for (const overrides of [
      { STAGING_COLLABORATION_VALIDATION: 'false' },
      { STAGING_GUEST_VALIDATION: 'false' },
      { APP_ENV: 'production' },
      { APP_URL: STAGING_GUEST_SCOPE.origin + '/' },
      { R2_ACCOUNT_ID: 'another-account' },
      { R2_BUCKET_NAME: 'another-bucket' },
    ]) {
      expect(
        stagingCollaborationValidationEnabled({
          ...collaboration,
          ...overrides,
        }),
      ).toBe(false);
    }
  });

  it('keeps collaboration services closed on the older Guest-only profile', () => {
    expect(() =>
      configuration({
        ...base,
        GUEST_TAGS_ENABLED: 'true',
      } as unknown as WorkerEnv),
    ).toThrow('GUEST_TAGS_LOCAL_ONLY');
    expect(() =>
      configuration({
        ...base,
        PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
      } as unknown as WorkerEnv),
    ).toThrow(
      'PHOTOGRAPHER_RECOMMENDATIONS_LOCAL_OR_COLLABORATION_STAGING_ONLY',
    );
    expect(() =>
      configuration({
        ...collaboration,
        MATCHING_RULES_ENABLED: 'true',
      } as unknown as WorkerEnv),
    ).toThrow('MATCHING_RULES_LOCAL_ONLY');
  });

  it('enables only the opted-in service capabilities for the scoped profile', () => {
    const env = workerEnv(collaboration);
    expect(configuration(env).STAGING_COLLABORATION_VALIDATION).toBe('true');
    expect(photoVersionsCapability(env)).toBe(true);
    expect(versionUploadCapability(env)).toBe(true);
    expect(projectVersioningCapability(env)).toBe(true);
    expect(guestVersionComparisonCapability(env)).toBe(true);
    expect(guestFeedbackCapability(env)).toBe(true);
    expect(guestTagsCapability(env)).toBe(true);
    expect(guestHistoryCapability(env)).toBe(true);
    expect(ownerCommentsCapability(env)).toBe(true);
    expect(ownerAnnotationProcessingCapability(env)).toBe(true);
    expect(ownerHistoryCapability(env)).toBe(true);
    expect(freehandAnnotationsCapability(env)).toBe(true);
    expect(photographerRecommendationsCapability(env)).toBe(true);
  });

  it('expands invitation permissions only for enabled collaboration services', () => {
    const basePermissions = {
      ...base,
      GUEST_EXCHANGE_ENABLED: 'true',
      GUEST_SELECTION_ENABLED: 'true',
    };
    expect(
      [...stagingGuestAllowedPermissionNames(basePermissions)].sort(),
    ).toEqual(['can_select', 'can_submit', 'can_view']);

    const allowed = stagingGuestAllowedPermissionNames(collaboration);
    expect([...allowed].sort()).toEqual([...guestPermissionNames].sort());
    expect(
      stagingGuestPermissionMaskSupported(
        collaboration,
        guestPermissionBit('can_annotate') |
          guestPermissionBit('can_compare_versions'),
      ),
    ).toBe(true);

    const noTags = { ...collaboration, GUEST_TAGS_ENABLED: 'false' };
    const request = { ...disabledPermissions, can_tag: true };
    expect(stagingGuestPermissionsSupported(noTags, request)).toBe(false);
    expect(
      stagingGuestPermissionMaskSupported(
        noTags,
        guestPermissionBit('can_tag'),
      ),
    ).toBe(false);
  });
});

describe('exact collaboration route allowlists', () => {
  it('admits the selected Guest and Owner routes and blocks adjacent features', () => {
    expect(
      stagingCollaborationGuestRequestAllowed(
        'GET',
        '/api/guest/albums/' + STAGING_GUEST_SCOPE.albumId + '/photos',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationGuestRequestAllowed(
        'POST',
        '/api/guest/albums/' +
          STAGING_GUEST_SCOPE.albumId +
          '/annotations/commands',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationGuestRequestAllowed(
        'GET',
        '/api/guest/albums/' + foreignAlbum + '/photos',
      ),
    ).toBe(false);
    expect(
      stagingCollaborationGuestRequestAllowed(
        'PUT',
        '/api/guest/albums/' +
          STAGING_GUEST_SCOPE.albumId +
          '/photos/' +
          fixedPhoto +
          '/tags',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationGuestRequestAllowed(
        'DELETE',
        '/api/guest/albums/' + STAGING_GUEST_SCOPE.albumId + '/selection',
      ),
    ).toBe(false);

    expect(
      stagingCollaborationOwnerRequestAllowed(
        'GET',
        '/api/v1/albums/' +
          STAGING_GUEST_SCOPE.albumId +
          '/photographer-recommendations',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'POST',
        '/api/v1/photos/' +
          fixedPhoto +
          '/versions/' +
          fixedVersion +
          '/complete',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'GET',
        '/api/v1/albums/' + foreignAlbum + '/selection-policy',
      ),
    ).toBe(false);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'POST',
        '/api/v1/version-approvals/commands',
      ),
    ).toBe(false);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'GET',
        '/api/v1/photographer-recommendations/capabilities',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'GET',
        '/api/v1/photo-pins/capabilities',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'PUT',
        '/api/v1/photos/' + fixedPhoto + '/pin',
      ),
    ).toBe(true);
    expect(
      stagingCollaborationOwnerRequestAllowed(
        'POST',
        '/api/v1/photos/' + fixedPhoto + '/pin',
      ),
    ).toBe(false);
  });
});

it('allows only Owner POST to an exact-version processing retry route', () => {
  const path =
    '/api/v1/photos/00000000-0000-4000-8000-000000000002/versions/00000000-0000-4000-8000-000000000003/processing-retry';
  expect(stagingCollaborationOwnerRequestAllowed('POST', path)).toBe(true);
  expect(stagingCollaborationOwnerRequestAllowed('GET', path)).toBe(false);
  expect(stagingCollaborationOwnerRequestAllowed('POST', path + '/other')).toBe(
    false,
  );
  expect(stagingCollaborationGuestRequestAllowed('POST', path)).toBe(false);
});

it('exposes only exact scoped image-processing policy GET/POST', () => {
  const path =
    '/api/v1/workspaces/' +
    STAGING_GUEST_SCOPE.workspaceId +
    '/image-processing-policy';
  for (const method of ['GET', 'POST'])
    expect(stagingCollaborationOwnerRequestAllowed(method, path)).toBe(true);
  for (const method of ['PUT', 'DELETE', 'PATCH'])
    expect(stagingCollaborationOwnerRequestAllowed(method, path)).toBe(false);
  expect(
    stagingCollaborationOwnerRequestAllowed(
      'GET',
      path.replace(
        STAGING_GUEST_SCOPE.workspaceId,
        '11111111-1111-4111-8111-111111111111',
      ),
    ),
  ).toBe(false);
  expect(stagingCollaborationOwnerRequestAllowed('GET', path + '/extra')).toBe(
    false,
  );
});

it('admits managed project invitation GET and POST while rejecting unrelated methods and approval writes', () => {
  const target = {
    ...STAGING_GUEST_SCOPE,
    projectId: '11111111-1111-4111-8111-111111111111',
  };
  const path = '/api/v1/projects/' + target.projectId + '/invites';
  expect(stagingCollaborationOwnerRequestAllowed('GET', path, target)).toBe(
    true,
  );
  expect(stagingCollaborationOwnerRequestAllowed('POST', path, target)).toBe(
    true,
  );
  for (const method of ['PUT', 'DELETE'])
    expect(stagingCollaborationOwnerRequestAllowed(method, path, target)).toBe(
      false,
    );
  expect(stagingCollaborationGuestRequestAllowed('GET', path)).toBe(false);
  expect(
    stagingCollaborationOwnerRequestAllowed(
      'GET',
      '/api/v1/version-approvals/capabilities',
    ),
  ).toBe(true);
  expect(
    stagingCollaborationOwnerRequestAllowed(
      'POST',
      '/api/v1/version-approvals/capabilities',
    ),
  ).toBe(false);
});

it('structurally routes an explicit managed Guest album while preserving the default fence and methods', () => {
  const album = '11111111-1111-4111-8111-111111111111';
  const path = '/api/guest/albums/' + album + '/photos';
  expect(stagingCollaborationGuestRequestAllowed('GET', path)).toBe(false);
  expect(stagingCollaborationGuestRequestAllowed('GET', path, album)).toBe(
    true,
  );
  expect(stagingCollaborationGuestRequestAllowed('DELETE', path, album)).toBe(
    false,
  );
  expect(
    stagingCollaborationGuestRequestAllowed('GET', path + '/extra', album),
  ).toBe(false);
});
