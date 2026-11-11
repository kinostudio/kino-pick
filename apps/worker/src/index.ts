import { productionRuntimeAllowed } from './production-runtime';
import { verifyProductionGatewayRequest } from './production-gateway';
import { stagingGuestAllowedPermissionNames } from './staging-guest-permissions';
import { readPhotographerRecommendationBadges } from './photographer-recommendations';
import { photographerRecommendationRoutes } from './photographer-recommendation-routes';
import { photoPinRoutes } from './photo-pin-routes';
import { importCompletedUploadMetadata } from './photographer-metadata-import';
import { D1AlbumActivationRepository } from './album-activation';
import {
  stagingGuestApiScope,
  stagingOwnerSelectionScope,
} from './staging-guest-boundary';
import {
  guestCoreRuntimeAllowed,
  stagingGuestValidationEnabled,
  stagingCollaborationValidationEnabled,
  STAGING_GUEST_SCOPE,
} from './staging-guest-scope';
import { processingSourceLimit } from '../../../packages/image-processing/src/recipes';
import { projectMatchingRulesRoutes } from './project-matching-rules-routes';
import { matchingRuleIndexRoutes } from './matching-rule-index-routes';
import { assistedCandidateCatalogRoutes } from './assisted-candidate-catalog-routes';
import { matchingFilenameIndexRoutes } from './matching-filename-index-routes';
import { ownerHistoryRoutes } from './owner-history-routes';
import { annotationProcessingRoutes } from './annotation-processing-routes';
import { ownerAnnotationAuthoringRoutes } from './owner-annotation-authoring-routes';
import { ownerAnnotationRoutes } from './owner-annotation-routes';
import { guestAnnotationRoutes } from './guest-annotation-routes';
import { commentProcessingRoutes } from './comment-processing-routes';
import { ownerCommentRoutes } from './owner-comment-routes';
import { D1GuestCommentsRepository } from './guest-comments';
import {
  guestCommentsCapabilitiesSchema,
  guestCommentCommandSchema,
  guestCommentReadQuerySchema,
} from '../../../packages/contracts/src/guest-comments';
import { resolvedUploadRoutes } from './resolved-upload-routes';
import { resolvedBatchUploadCapabilitiesSchema } from '../../../packages/contracts/src/resolved-batch-uploads';
import { projectVersioningRoutes } from './project-versioning-routes';
import { versionUploadRoutes } from './version-upload-routes';
import { D1PhotoVersionHeadsRepository } from './photo-version-heads';
import {
  photoVersionsCapabilitiesSchema,
  setCurrentPhotoVersionSchema,
} from '../../../packages/contracts/src/photo-versions';
import { D1GuestHistoryRepository } from './guest-history';
import {
  guestHistoryCapabilitiesSchema,
  guestHistoryQuerySchema,
} from '../../../packages/contracts/src/guest-history';
import { D1GuestTagsRepository } from './guest-tags';
import {
  guestTagPhotoIdsSchema,
  guestTagCapabilitiesSchema,
  guestTagRequestSchema,
} from '../../../packages/contracts/src/guest-tags';
import { selectionPolicyConfigurationRoutes } from './selection-policy-configuration-routes';
import { sharedReviewRoutes } from './shared-review-routes';
import { D1SelectionPolicyRepository } from './selection-policy';
import { D1GuestFeedbackRepository } from './guest-feedback';
import {
  guestFeedbackPhotoIdsSchema,
  guestFeedbackCapabilitiesSchema,
} from '../../../packages/contracts/src/guest-feedback';
import { guestExchangeCapabilitiesSchema } from '../../../packages/contracts/src/guest-access';
import { inviteCapabilitiesSchema } from '../../../packages/contracts/src/invites';
import { z } from 'zod';
import { deleteEmptyProject } from './project-deletion';
import { D1ManualAlbumDeletion } from './manual-album-deletion';
import { D1GalleryRepository } from './gallery';
import { D1GuestGalleryRepository } from './guest-gallery';
import { D1GuestSelectionRepository } from './guest-selection';
import { D1GuestSelectionReader } from './guest-selection-read';
import { D1GuestSelectionSubmissionRepository } from './guest-selection-submit';
import { D1OwnerSelectionRepository } from './owner-selection';
import { D1InviteRepository } from './invites';
import { logoutGuest } from './guest-logout';
import { D1GuestExchange } from './guest-exchange';
import { pruneExpiredGuestAdmissionBuckets } from './guest-admission';
import { D1InviteIssuance } from './invite-issuance';
import {
  D1GuestAccessResolver,
  GuestAccessDenied,
  readGuestSessionSecret,
} from './guest-access';
import { D1ProcessingReviewRepository } from './processing-review';
import { R2ProcessingReviewStore } from './processing-review-storage';
import { D1WorkspaceRepository, WorkspaceFailure } from './workspaces';
import { D1ContentRepository } from './content';
import { Hono, type Handler, type Context } from 'hono';
import { humanViewRoutes } from './human-view-routes';
import { clientActivityRoutes } from './client-activity-routes';
import { versionApprovalRoutes } from './version-approval-routes';
import { approvedDeliveryRoutes } from './approved-delivery-routes';
import { deliveryZipRoutes } from './delivery-zip-routes';
import { captureMetadataRoutes } from './capture-metadata-routes';
import { deliveryNotificationRoutes } from './delivery-notification-routes';
import { guestDownloadRoutes } from './guest-download-routes';
import { bodyLimit } from 'hono/body-limit';
import { createAuth } from './auth';
import { accountProviderRoutes } from './account-providers';
import { oauthProviderCapabilities } from './oauth-provider-capabilities';
import {
  configuration,
  photographerRecommendationsCapability,
  guestFeedbackCapability,
  guestTagsCapability,
  guestHistoryCapability,
  photoVersionsCapability,
  albumActivationCapability,
  indexedVersionMatchingCapability,
  matchingRulesCapability,
  resolvedBatchUploadCapability,
  versionUploadCapability,
  guestVersionComparisonCapability,
  guestCommentsCapability,
  guestDownloadsCapability,
  guestAnnotationsCapability,
  type WorkerEnv,
} from './config';
import { D1UploadRepository, expireDueReservations } from './uploads';
import { selectStorageNodeForUpload } from './storage-admission';
import { R2StorageAdapter } from './r2-storage';
import { readOraclePolicy, saveOraclePolicy } from './oracle-storage-policy';
import { readStorageCapacity } from './storage-capacity';
import {
  storageBucketForNode,
  oracleStorageCredentials,
} from './private-storage';
import {
  processCloudflareImages,
  wakeCloudflareImagesForCompletedUpload,
} from './cloudflare-processing';
import {
  readImageProcessingPolicy,
  changeImageProcessingPolicy,
} from './image-processing-policy';
import type { R2SignerCredentials, S3SignerCredentials } from './r2-presign';
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
} from '../../../packages/contracts/src/image-metadata';
type AppEnvironment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
const app = new Hono<AppEnvironment>();
app.use('*', async (c, next) => {
  const fingerprinted =
    /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.exec(
      new URL(c.req.url).pathname,
    );
  await next();
  const mime = c.res.headers.get('Content-Type')?.split(';')[0]?.trim();
  const isHashedPublicAsset =
    c.res.status === 200 &&
    ((fingerprinted?.[1] === 'js' &&
      (mime === 'application/javascript' || mime === 'text/javascript')) ||
      (fingerprinted?.[1] === 'css' && mime === 'text/css'));
  c.header(
    'Cache-Control',
    isHashedPublicAsset
      ? 'public, max-age=31536000, immutable'
      : 'private, no-store',
  );
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Robots-Tag', 'noindex, nofollow');
});
app.use(
  '/api/auth/*',
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
app.get('/api/health', (c) => {
  configuration(c.env);
  return c.json({
    service: 'kino-pic-cloudflare',
    phase: 'migration-foundation',
    registration: 'closed',
    autodelete: false,
    dryRun: true,
    providerConnectivity: 'not_checked',
  });
});
app.get('/api/oauth/providers', (c) => {
  if (new URL(c.req.url).searchParams.size !== 0)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400, {
      'Cache-Control': 'private, no-store',
    });
  return c.json(oauthProviderCapabilities(c.env), 200, {
    'Cache-Control': 'private, no-store',
  });
});
app.use('/api/v1/*', async (c, next) => {
  configuration(c.env);
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: { code: 'AUTH_REQUIRED' } }, 401);
  const owner = await c.env.DB.prepare(
    'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
  )
    .bind(session.user.id)
    .first();
  if (!owner) return c.json({ error: { code: 'OWNER_REQUIRED' } }, 403);
  c.set('ownerId', session.user.id);
  c.set('sessionId', session.session.id);
  await next();
});
app.use('/api/guest/*', stagingGuestApiScope);
app.use('/api/v1/*', stagingOwnerSelectionScope);
app.route('/api/v1/account', accountProviderRoutes);
app.get('/api/v1/invites/capabilities', (c) => {
  const config = configuration(c.env);
  return c.json(
    inviteCapabilitiesSchema.parse({
      ...(stagingGuestValidationEnabled(c.env)
        ? {
            validationScope: {
              projectId: STAGING_GUEST_SCOPE.projectId,
              albumId: STAGING_GUEST_SCOPE.albumId,
              ...(stagingCollaborationValidationEnabled(c.env)
                ? {
                    managedAlbums: true,
                    passwordModes: true,
                    permissionNames: [
                      ...stagingGuestAllowedPermissionNames(c.env),
                    ],
                  }
                : {}),
            },
          }
        : {}),
      issuanceEnabled:
        guestCoreRuntimeAllowed(c.env) &&
        config.GUEST_INVITE_ISSUANCE_ENABLED === 'true',
      exchangeEnabled:
        guestCoreRuntimeAllowed(c.env) &&
        config.GUEST_EXCHANGE_ENABLED === 'true',
      selectionEnabled:
        guestCoreRuntimeAllowed(c.env) &&
        config.GUEST_SELECTION_ENABLED === 'true',
      feedbackEnabled: guestFeedbackCapability(c.env),
      tagsEnabled: guestTagsCapability(c.env),
      historyEnabled: guestHistoryCapability(c.env),
      downloadsEnabled: guestDownloadsCapability(c.env),
      commentsEnabled: guestCommentsCapability(c.env),
      annotationsEnabled: guestAnnotationsCapability(c.env),
      versionComparisonEnabled: guestVersionComparisonCapability(c.env),
      maxAlbums: 24,
      maxUses: 10000,
      maxExpiryDays: 365,
    }),
  );
});
app.get('/api/guest/capabilities', (c) => {
  const config = configuration(c.env);
  return c.json(
    guestExchangeCapabilitiesSchema.parse({
      exchangeEnabled:
        guestCoreRuntimeAllowed(c.env) &&
        config.GUEST_EXCHANGE_ENABLED === 'true',
    }),
  );
});
// Guest authority is deliberately separate from the Owner-only /api/v1 tree.
// Only explicitly enabled local or scoped staging exchange may create a Guest session.
app.get('/api/guest/albums/:albumId/access', async (c) => {
  try {
    const config = configuration(c.env);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    const access = await new D1GuestAccessResolver(c.env.DB).album(
      secret,
      c.req.param('albumId'),
      'can_view',
    );
    return c.json({ access });
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    if (error instanceof z.ZodError)
      return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
    throw error;
  }
});
app.get('/api/guest/version-comparison/capabilities', (c) => {
  if (new URL(c.req.url).search)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ enabled: guestVersionComparisonCapability(c.env) });
});
app.get('/api/guest/albums/:albumId/photos/:photoId/versions', async (c) => {
  try {
    if (!guestVersionComparisonCapability(c.env))
      throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);
    const config = configuration(c.env);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    const query = listQuery(c.req.url, false);
    return c.json(
      await new D1GuestGalleryRepository(c.env.DB).versions(
        secret,
        c.req.param('albumId'),
        c.req.param('photoId'),
        query.cursor,
      ),
    );
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.get('/api/guest/albums/:albumId/photos', async (c) => {
  try {
    const config = configuration(c.env);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    const query = listQuery(c.req.url, false);
    const page = await new D1GuestGalleryRepository(c.env.DB).list(
      secret,
      c.req.param('albumId'),
      query.cursor,
    );
    if (photographerRecommendationsCapability(c.env)) {
      const recommended = await readPhotographerRecommendationBadges(
        c.env.DB,
        c.req.param('albumId'),
        page.photos,
      );
      return c.json({
        ...page,
        photos: page.photos.map((photo) => ({
          ...photo,
          photographerRecommended: recommended.has(photo.id),
        })),
      });
    }
    return c.json(page);
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.get(
  '/api/guest/photos/:photoId/versions/:versionId/assets/:kind',
  async (c) => {
    try {
      const config = configuration(c.env);
      const secret = readGuestSessionSecret(
        c.req.header('Cookie'),
        config.origin.startsWith('https:'),
      );
      const item = await new D1GuestGalleryRepository(c.env.DB).asset(
        secret,
        c.req.param('photoId'),
        c.req.param('versionId'),
        c.req.param('kind'),
      );
      let object: R2ObjectBody;
      try {
        object = await new R2StorageAdapter(
          storageBucketForNode(c.env, item.storage_node_id),
          item.storage_node_id,
        ).open(
          {
            workspaceId: item.workspace_id,
            projectId: item.project_id,
            albumId: item.album_id,
          },
          item.object_key,
        );
      } catch {
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      }
      const checksum = object.checksums.sha256
        ? Array.from(new Uint8Array(object.checksums.sha256), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      if (
        object.size !== item.byte_size ||
        object.size > 8388608 ||
        checksum !== item.checksum_sha256 ||
        object.httpMetadata?.contentType !== 'image/jpeg'
      ) {
        await object.body.cancel();
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      }
      return new Response(object.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(object.size),
          'Content-Disposition': 'inline',
          'Cross-Origin-Resource-Policy': 'same-origin',
          Vary: 'Cookie',
        },
      });
    } catch (error) {
      if (error instanceof GuestAccessDenied)
        return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
      return contentError(c, error);
    }
  },
);
const workspaceBodyLimit = bodyLimit({
  maxSize: 16384,
  onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
});
// Bind browser upload intents to the actor whose journal supplied the operation IDs.
app.use('/api/v1/uploads/*', async (c, next) => {
  const expected = c.req.header('X-Kino-Expected-Actor');
  if (
    expected !== undefined &&
    (!z.uuid().safeParse(expected).success || expected !== c.get('ownerId'))
  )
    return c.json({ error: { code: 'UPLOAD_OWNER_CHANGED' } }, 403);
  await next();
});
for (const path of [
  '/api/v1/workspaces',
  '/api/v1/projects',
  '/api/v1/projects/*',
  '/api/v1/albums/*',
  '/api/v1/uploads/*',
  '/api/v1/photos/*',
  '/api/v1/invites/*',
])
  app.use(path, workspaceBodyLimit);
const content = (c: {
  env: WorkerEnv;
  get: (key: 'ownerId' | 'sessionId') => string;
}) => new D1ContentRepository(c.env.DB, c.get('ownerId'), c.get('sessionId'));
const uploads = (c: {
  env: WorkerEnv;
  get: (key: 'ownerId' | 'sessionId') => string;
}) =>
  new D1UploadRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    new R2StorageAdapter(c.env.PRIMARY_STORAGE),
    {
      versionUploadsEnabled: versionUploadCapability(c.env),
      indexedMatchingEnabled: indexedVersionMatchingCapability(c.env),
      matchingRulesEnabled: matchingRulesCapability(c.env),
      storageForNode: (nodeId) =>
        new R2StorageAdapter(storageBucketForNode(c.env, nodeId), nodeId),
      chooseStorageNode: (bytes) => selectStorageNodeForUpload(c.env, bytes),
    },
  );
const signerCredentials = (
  env: WorkerEnv,
  nodeId = 'primary',
): R2SignerCredentials | S3SignerCredentials => {
  if (configuration(env).DIRECT_UPLOAD_ENABLED !== 'true')
    throw new WorkspaceFailure('DIRECT_UPLOAD_DISABLED', 503);
  if (nodeId === 'oracle-vm') return oracleStorageCredentials(env);
  if (nodeId !== 'primary')
    throw new WorkspaceFailure('STORAGE_NODE_UNAVAILABLE', 503);
  const parsed = z
    .object({
      R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
      R2_ACCESS_KEY_ID: z.string().min(1),
      R2_SECRET_ACCESS_KEY: z.string().min(1),
      R2_BUCKET_NAME: z.string().min(3).max(63),
    })
    .safeParse(env);
  if (!parsed.success)
    throw new WorkspaceFailure('DIRECT_UPLOAD_NOT_CONFIGURED', 503);
  return {
    accountId: parsed.data.R2_ACCOUNT_ID,
    accessKeyId: parsed.data.R2_ACCESS_KEY_ID,
    secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY,
    bucketName: parsed.data.R2_BUCKET_NAME,
  };
};
const contentError = (
  c: {
    json: (
      value: unknown,
      status?: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 503,
    ) => Response;
  },
  error: unknown,
) => {
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  throw error;
};
const readContentBody = async (c: {
  req: {
    header: (name: string) => string | undefined;
    json: () => Promise<unknown>;
  };
}) => {
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  try {
    return await c.req.json();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
};
const checkOrigin = (c: {
  req: { header: (name: string) => string | undefined };
  env: WorkerEnv;
}) => {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
};
app.get('/api/guest/comments/capabilities', (c) => {
  if (new URL(c.req.url).searchParams.size !== 0)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json(
    guestCommentsCapabilitiesSchema.parse({
      enabled: guestCommentsCapability(c.env),
    }),
  );
});
app.get(
  '/api/guest/albums/:albumId/photos/:photoId/versions/:versionId/comments',
  async (c) => {
    try {
      if (!guestCommentsCapability(c.env))
        throw new WorkspaceFailure('GUEST_COMMENTS_UNAVAILABLE', 503);
      const params = new URL(c.req.url).searchParams;
      if (
        params.getAll('cursor').length > 1 ||
        params.getAll('commentId').length > 1
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      const query = guestCommentReadQuerySchema.parse(
        Object.fromEntries(params),
      );
      const config = configuration(c.env);
      const secret = readGuestSessionSecret(
        c.req.header('Cookie'),
        config.origin.startsWith('https:'),
      );
      return c.json(
        await new D1GuestCommentsRepository(c.env.DB).read(
          secret,
          z.uuid().parse(c.req.param('albumId')),
          z.uuid().parse(c.req.param('photoId')),
          z.uuid().parse(c.req.param('versionId')),
          query.cursor,
          query.commentId,
        ),
      );
    } catch (error) {
      if (error instanceof GuestAccessDenied)
        return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
      return contentError(c, error);
    }
  },
);
app.use('/api/guest/albums/:albumId/comments/commands', workspaceBodyLimit);
app.post('/api/guest/albums/:albumId/comments/commands', async (c) => {
  try {
    checkOrigin(c);
    if (!guestCommentsCapability(c.env))
      throw new WorkspaceFailure('GUEST_COMMENTS_UNAVAILABLE', 503);
    if (new URL(c.req.url).searchParams.size !== 0)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const config = configuration(c.env);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    return c.json(
      await new D1GuestCommentsRepository(c.env.DB).command(
        secret,
        z.uuid().parse(c.req.param('albumId')),
        guestCommentCommandSchema.parse(await readContentBody(c)),
      ),
    );
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.get('/api/guest/history/capabilities', (c) => {
  return c.json(
    guestHistoryCapabilitiesSchema.parse({
      enabled: guestHistoryCapability(c.env),
    }),
  );
});
app.get('/api/guest/me/activity', async (c) => {
  try {
    const config = configuration(c.env);
    if (!guestHistoryCapability(c.env))
      throw new WorkspaceFailure('GUEST_HISTORY_DISABLED', 503);
    const query = new URL(c.req.url).searchParams;
    const allowed = new Set(['albumId', 'photoId', 'cursor']);
    if (
      [...query.keys()].some(
        (key) => !allowed.has(key) || query.getAll(key).length !== 1,
      )
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const input = guestHistoryQuerySchema.parse(Object.fromEntries(query));
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    if (!c.env.BETTER_AUTH_SECRET)
      throw new WorkspaceFailure('GUEST_HISTORY_UNAVAILABLE', 503);
    return c.json(
      await new D1GuestHistoryRepository(
        c.env.DB,
        c.env.BETTER_AUTH_SECRET,
      ).list(secret, input),
    );
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.get('/api/guest/tags/capabilities', (c) => {
  return c.json(
    guestTagCapabilitiesSchema.parse({
      enabled: guestTagsCapability(c.env),
    }),
  );
});
app.get('/api/guest/albums/:albumId/tags', async (c) => {
  try {
    const config = configuration(c.env);
    if (!guestTagsCapability(c.env))
      throw new WorkspaceFailure('GUEST_TAGS_DISABLED', 503);
    const query = new URL(c.req.url).searchParams;
    if ([...query.keys()].some((name) => name !== 'photoId'))
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const ids = guestTagPhotoIdsSchema.parse(query.getAll('photoId'));
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    return c.json(
      await new D1GuestTagsRepository(c.env.DB).read(
        secret,
        z.uuid().parse(c.req.param('albumId')),
        ids,
      ),
    );
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.use('/api/guest/albums/:albumId/photos/:photoId/tags', workspaceBodyLimit);
app.put('/api/guest/albums/:albumId/photos/:photoId/tags', async (c) => {
  try {
    checkOrigin(c);
    const config = configuration(c.env);
    if (!guestTagsCapability(c.env))
      throw new WorkspaceFailure('GUEST_TAGS_DISABLED', 503);
    if (new URL(c.req.url).searchParams.size !== 0)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    return c.json(
      await new D1GuestTagsRepository(c.env.DB).set(
        secret,
        z.uuid().parse(c.req.param('albumId')),
        z.uuid().parse(c.req.param('photoId')),
        guestTagRequestSchema.parse(await readContentBody(c)),
      ),
    );
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.get('/api/guest/feedback/capabilities', (c) => {
  return c.json(
    guestFeedbackCapabilitiesSchema.parse({
      enabled: guestFeedbackCapability(c.env),
    }),
  );
});
for (const kind of ['rating', 'favorite'] as const) {
  const plural = kind === 'rating' ? 'ratings' : 'favorites';
  app.get(`/api/guest/albums/:albumId/${plural}`, async (c) => {
    try {
      const config = configuration(c.env);
      if (!guestFeedbackCapability(c.env))
        throw new WorkspaceFailure('GUEST_FEEDBACK_DISABLED', 503);
      const query = new URL(c.req.url).searchParams;
      if ([...query.keys()].some((name) => name !== 'photoId'))
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      const ids = guestFeedbackPhotoIdsSchema.parse(query.getAll('photoId'));
      const secret = readGuestSessionSecret(
        c.req.header('Cookie'),
        config.origin.startsWith('https:'),
      );
      const repo = new D1GuestFeedbackRepository(c.env.DB);
      return c.json(
        kind === 'rating'
          ? await repo.readRatings(secret, c.req.param('albumId'), ids)
          : await repo.readFavorites(secret, c.req.param('albumId'), ids),
      );
    } catch (error) {
      if (error instanceof GuestAccessDenied)
        return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
      return contentError(c, error);
    }
  });
  const path = `/api/guest/albums/:albumId/photos/:photoId/${kind}` as const;
  app.use(path, workspaceBodyLimit);
  app.put(path, async (c) => {
    try {
      checkOrigin(c);
      const config = configuration(c.env);
      if (!guestFeedbackCapability(c.env))
        throw new WorkspaceFailure('GUEST_FEEDBACK_DISABLED', 503);
      const secret = readGuestSessionSecret(
        c.req.header('Cookie'),
        config.origin.startsWith('https:'),
      );
      const input = await readContentBody(c);
      const repo = new D1GuestFeedbackRepository(c.env.DB);
      return c.json(
        kind === 'rating'
          ? await repo.setRating(
              secret,
              c.req.param('albumId'),
              c.req.param('photoId'),
              input,
            )
          : await repo.setFavorite(
              secret,
              c.req.param('albumId'),
              c.req.param('photoId'),
              input,
            ),
      );
    } catch (error) {
      if (error instanceof GuestAccessDenied)
        return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
      return contentError(c, error);
    }
  });
}
app.use('/api/guest/exchange', workspaceBodyLimit);
app.post('/api/guest/exchange', async (c) => {
  try {
    checkOrigin(c);
    if (c.req.header('CF-Worker') !== undefined)
      throw new WorkspaceFailure('GUEST_ACCESS_REQUIRED', 401);
    const config = configuration(c.env);
    const result = await new D1GuestExchange(c.env).exchange(
      await readContentBody(c),
      c.req.header('CF-Connecting-IP'),
    );
    c.header(
      'Set-Cookie',
      `${config.origin.startsWith('https:') ? '__Host-kino_guest' : 'kino_guest'}=${result.sessionSecret}; Path=/; Max-Age=${result.maxAge}; HttpOnly; SameSite=Lax${config.origin.startsWith('https:') ? '; Secure' : ''}`,
    );
    return c.json({
      authenticated: result.authenticated,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/guest/albums/:albumId/selection', async (c) => {
  try {
    const config = configuration(c.env);
    if (config.GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    const query = listQuery(c.req.url, false);
    const page = await new D1GuestSelectionReader(c.env.DB).list(
      secret,
      c.req.param('albumId'),
      query.cursor,
    );
    return c.json(page);
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.use('/api/guest/albums/:albumId/selection/submit', workspaceBodyLimit);
app.post('/api/guest/albums/:albumId/selection/submit', async (c) => {
  try {
    checkOrigin(c);
    const config = configuration(c.env);
    if (config.GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    const result = await new D1GuestSelectionSubmissionRepository(
      c.env.DB,
    ).submit(secret, c.req.param('albumId'), await readContentBody(c));
    return c.json(result);
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.use(
  '/api/guest/albums/:albumId/photos/:photoId/selection',
  workspaceBodyLimit,
);
app.put('/api/guest/albums/:albumId/photos/:photoId/selection', async (c) => {
  try {
    checkOrigin(c);
    const config = configuration(c.env);
    if (config.GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      config.origin.startsWith('https:'),
    );
    const selection = await new D1GuestSelectionRepository(c.env.DB).set(
      secret,
      c.req.param('albumId'),
      c.req.param('photoId'),
      await readContentBody(c),
    );
    return c.json(selection);
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return contentError(c, error);
  }
});
app.use('/api/guest/logout', workspaceBodyLimit);
app.post('/api/guest/logout', async (c) => {
  try {
    checkOrigin(c);
    const secure = configuration(c.env).origin.startsWith('https:');
    await logoutGuest(
      c.env.DB,
      readGuestSessionSecret(c.req.header('Cookie'), secure),
      await readContentBody(c),
    );
    c.header(
      'Set-Cookie',
      `${secure ? '__Host-kino_guest' : 'kino_guest'}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    );
    return c.json({ loggedOut: true });
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/projects/:projectId/invites', async (c) => {
  try {
    checkOrigin(c);
    return c.json(
      await new D1InviteIssuance(
        c.env,
        c.get('ownerId'),
        c.get('sessionId'),
      ).create(c.req.param('projectId'), await readContentBody(c)),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/invites/creation/:requestId', async (c) => {
  try {
    return c.json(
      await new D1InviteIssuance(
        c.env,
        c.get('ownerId'),
        c.get('sessionId'),
      ).recovery(c.req.param('requestId')),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects/:projectId/invites', async (c) => {
  try {
    const params = new URL(c.req.url).searchParams;
    if (
      [...params.keys()].some((key) => key !== 'cursor') ||
      params.getAll('cursor').length > 1
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    return c.json(
      await new D1InviteRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).list(c.req.param('projectId'), params.get('cursor') ?? undefined),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/invites/:inviteId/revoke', async (c) => {
  try {
    checkOrigin(c);
    const result = await new D1InviteRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).revoke(c.req.param('inviteId'), await readContentBody(c));
    return c.json({ revocation: result });
  } catch (error) {
    return contentError(c, error);
  }
});
function listQuery(
  url: string,
  project: true,
): { workspaceId: string; cursor?: string };
function listQuery(url: string, project: false): { cursor?: string };
function listQuery(
  url: string,
  project: boolean,
): { workspaceId?: string | undefined; cursor?: string | undefined } {
  const params = new URL(url).searchParams;
  const allowed = project ? ['workspaceId', 'cursor'] : ['cursor'];
  if (
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    [...new Set(params.keys())].some((key) => params.getAll(key).length !== 1)
  )
    throw new z.ZodError([
      { code: 'custom', path: [], message: 'Invalid query' },
    ]);
  return project
    ? z
        .object({ workspaceId: z.uuid(), cursor: z.string().optional() })
        .strict()
        .parse(Object.fromEntries(params))
    : z
        .object({ cursor: z.string().optional() })
        .strict()
        .parse(Object.fromEntries(params));
}
app.get(
  '/api/v1/workspaces/:workspaceId/image-processing-policy',
  async (c) => {
    try {
      return c.json({
        ...(await readImageProcessingPolicy(
          c.env.DB,
          c.get('ownerId'),
          c.get('sessionId'),
          c.req.param('workspaceId'),
        )),
        processingEnabled:
          configuration(c.env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED === 'true',
      });
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.post(
  '/api/v1/workspaces/:workspaceId/image-processing-policy',
  async (c) => {
    try {
      checkOrigin(c);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
      return c.json(
        await changeImageProcessingPolicy(
          c.env.DB,
          c.get('ownerId'),
          c.get('sessionId'),
          c.req.param('workspaceId'),
          await readContentBody(c),
        ),
      );
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.get('/api/v1/workspaces', async (c) => {
  try {
    const query = listQuery(c.req.url, false);
    return c.json(
      await new D1WorkspaceRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).list(query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/workspaces', async (c) => {
  try {
    checkOrigin(c);
    const workspace = await new D1WorkspaceRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).create(await readContentBody(c));
    return c.json({ workspace }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects', async (c) => {
  try {
    const query = listQuery(c.req.url, true);
    return c.json(
      await content(c).listProjects(query.workspaceId, query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/projects', async (c) => {
  try {
    checkOrigin(c);
    const project = await content(c).createProject(await readContentBody(c));
    return c.json({ project }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects/:projectId', async (c) => {
  try {
    return c.json(await content(c).getProject(c.req.param('projectId')));
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/projects/:projectId', async (c) => {
  try {
    checkOrigin(c);
    const project = await content(c).renameProject(
      c.req.param('projectId'),
      await readContentBody(c),
    );
    return c.json({ project });
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects/:projectId/albums', async (c) => {
  try {
    const query = listQuery(c.req.url, false);
    return c.json(
      await content(c).listAlbums(c.req.param('projectId'), query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/projects/:projectId/albums', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).createAlbum(
      c.req.param('projectId'),
      await readContentBody(c),
    );
    return c.json({ album }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/albums/:albumId/activation-capabilities', async (c) => {
  try {
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const album = await new D1AlbumActivationRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).get(c.req.param('albumId'));
    return c.json({
      enabled:
        albumActivationCapability(c.env) &&
        album.state === 'draft' &&
        album.revision < 2147483647 &&
        !!(await c.env.DB.prepare(
          "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='album_activation_commands'",
        ).first()),
    });
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/albums/:albumId/activate', async (c) => {
  try {
    checkOrigin(c);
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    if (!albumActivationCapability(c.env))
      throw new WorkspaceFailure('ALBUM_ACTIVATION_DISABLED', 503);
    const album = await new D1AlbumActivationRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).activate(c.req.param('albumId'), await readContentBody(c));
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/albums/:albumId', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).renameAlbum(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/albums/:albumId/protection', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).protectAlbum(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/projects/:projectId/archive', async (c) => {
  try {
    checkOrigin(c);
    const project = await content(c).archiveProject(
      c.req.param('projectId'),
      await readContentBody(c),
    );
    return c.json({ project });
  } catch (error) {
    return contentError(c, error);
  }
});
const manualAlbumDeletion = (c: Context<AppEnvironment>) => {
  if (
    c.env.APP_ENV !== 'local' &&
    !stagingCollaborationValidationEnabled(c.env) &&
    !productionRuntimeAllowed(c.env)
  )
    throw new WorkspaceFailure('DELETION_DISABLED', 503);
  return new D1ManualAlbumDeletion(
    c.env.DB,
    (nodeId) =>
      new R2StorageAdapter(storageBucketForNode(c.env, nodeId), nodeId),
    c.get('ownerId'),
    c.get('sessionId'),
  );
};
app.get('/api/v1/albums/:id/deletion', async (c) => {
  try {
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    return c.json(await manualAlbumDeletion(c).preview(c.req.param('id')));
  } catch (error) {
    return contentError(c, error);
  }
});
app.delete('/api/v1/albums/:id', async (c) => {
  try {
    checkOrigin(c);
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    return c.json(
      await manualAlbumDeletion(c).start(
        c.req.param('id'),
        await readContentBody(c),
      ),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/albums/:id/deletion/retry', async (c) => {
  try {
    checkOrigin(c);
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const body = z
      .object({ jobId: z.uuid() })
      .strict()
      .parse(await readContentBody(c));
    return c.json(
      await manualAlbumDeletion(c).advance(c.req.param('id'), body.jobId),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
for (const kind of ['project'] as const) {
  app.delete(`/api/v1/${kind}s/:id`, async (c) => {
    try {
      checkOrigin(c);
      if (new URL(c.req.url).search)
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      return c.json(
        await deleteEmptyProject(
          c.env.DB,
          c.get('ownerId'),
          c.get('sessionId'),
          c.req.param('id'),
          await readContentBody(c),
        ),
      );
    } catch (error) {
      return contentError(c, error);
    }
  });
}
app.patch('/api/v1/albums/:albumId/archive', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).archiveAlbum(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/uploads/init', async (c) => {
  try {
    checkOrigin(c);
    signerCredentials(c.env);
    const uploadSession = await uploads(c).reserve(await readContentBody(c));
    return c.json({ uploadSession }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
const uploadCapabilities: Handler<AppEnvironment> = async (c) => {
  try {
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const workspaceId = c.req.param('workspaceId');
    const recipe = workspaceId
      ? (
          await readImageProcessingPolicy(
            c.env.DB,
            c.get('ownerId'),
            c.get('sessionId'),
            z.uuid().parse(workspaceId),
          )
        ).recipe
      : 'local-sharp-0.35.5-v1';
    let enabled = false;
    try {
      signerCredentials(c.env);
      enabled =
        recipe !== 'cloudflare-images-jpeg-82-v1' ||
        configuration(c.env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED === 'true';
    } catch {
      // Missing/disabled configuration is a usable read-only UI state.
    }
    c.header('Cache-Control', 'private, no-store');
    return c.json({
      enabled,
      maxBrowserBytes: processingSourceLimit(recipe),
      maxPixels: MAX_IMAGE_PIXELS,
      maxDimension: MAX_IMAGE_DIMENSION,
    });
  } catch (error) {
    return contentError(c, error);
  }
};
app.get('/api/v1/uploads/capabilities', uploadCapabilities);
app.get(
  '/api/v1/workspaces/:workspaceId/upload-capabilities',
  uploadCapabilities,
);
app.get('/api/v1/uploads/recovery/:requestId', async (c) => {
  try {
    return c.json(
      await uploads(c).recovery(z.uuid().parse(c.req.param('requestId'))),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/uploads/:uploadSessionId', async (c) => {
  try {
    const id = z.uuid().parse(c.req.param('uploadSessionId'));
    const uploadSession = await uploads(c).get(id);
    return c.json({ uploadSession });
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/uploads/:uploadSessionId/cancel', async (c) => {
  try {
    checkOrigin(c);
    const id = z.uuid().parse(c.req.param('uploadSessionId'));
    const uploadSession = await uploads(c).cancel(id, await readContentBody(c));
    return c.json({ uploadSession });
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/uploads/:uploadSessionId/authorize', async (c) => {
  try {
    checkOrigin(c);
    const id = z.uuid().parse(c.req.param('uploadSessionId'));
    const uploadAuthorization = await uploads(c).authorize(
      id,
      await readContentBody(c),
      (nodeId) => signerCredentials(c.env, nodeId),
    );
    return c.json({ uploadAuthorization });
  } catch (error) {
    return contentError(c, error);
  }
});
app.route('/', photographerRecommendationRoutes);
app.route('/', photoPinRoutes);
app.post('/api/v1/uploads/:uploadSessionId/complete', async (c) => {
  try {
    checkOrigin(c);
    const id = z.uuid().parse(c.req.param('uploadSessionId'));
    const completion = await uploads(c).complete(id, await readContentBody(c));
    c.executionCtx.waitUntil(
      importCompletedUploadMetadata(
        c.env,
        c.get('ownerId'),
        c.get('sessionId'),
        id,
      ).catch(() => {
        console.error('PHOTOGRAPHER_METADATA_IMPORT_FAILED');
      }),
    );
    wakeCloudflareImagesForCompletedUpload(c.env, c.executionCtx, {
      kind: 'original',
      actorId: c.get('ownerId'),
      uploadSessionId: id,
    });
    return c.json({ completion });
  } catch (error) {
    return contentError(c, error);
  }
});
app.route('/', guestDownloadRoutes);

app.route('/', humanViewRoutes);
app.route('/', clientActivityRoutes);
app.route('/', versionApprovalRoutes);
app.route('/', approvedDeliveryRoutes);
app.route('/', deliveryZipRoutes);
app.route('/', captureMetadataRoutes);
app.route('/', deliveryNotificationRoutes);

app.get('/api/v1/me', (c) =>
  c.json({
    actor: { id: c.get('ownerId') },
    role: 'owner',
    sessionId: c.get('sessionId'),
  }),
);
app.post(
  '/api/v1/photos/:photoId/versions/:versionId/processing-review/abandon',
  async (c) => {
    try {
      checkOrigin(c);
      const repository = new D1ProcessingReviewRepository(
        c.env.DB,
        (nodeId) =>
          new R2ProcessingReviewStore(storageBucketForNode(c.env, nodeId)),
        c.get('ownerId'),
        c.get('sessionId'),
      );
      return c.json(
        await repository.abandon(
          c.req.param('photoId'),
          c.req.param('versionId'),
          await readContentBody(c),
        ),
      );
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.post(
  '/api/v1/photos/:photoId/versions/:versionId/processing-retry',
  async (c) => {
    try {
      checkOrigin(c);
      z.object({})
        .strict()
        .parse(await readContentBody(c));
      if (
        configuration(c.env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED !== 'true' ||
        !c.env.IMAGES
      )
        throw new WorkspaceFailure('PROCESSING_RETRY_UNAVAILABLE', 503);
      const repository = new D1ProcessingReviewRepository(
        c.env.DB,
        (nodeId) =>
          new R2ProcessingReviewStore(storageBucketForNode(c.env, nodeId)),
        c.get('ownerId'),
        c.get('sessionId'),
      );
      const target = await repository.retryTarget(
        c.req.param('photoId'),
        c.req.param('versionId'),
      );
      c.header('Cache-Control', 'private, no-store');
      return c.json(
        await processCloudflareImages(c.env, target.workspaceId, target.jobId),
      );
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.get(
  '/api/v1/photos/:photoId/versions/:versionId/processing-review',
  async (c) => {
    try {
      const repository = new D1ProcessingReviewRepository(
        c.env.DB,
        (nodeId) =>
          new R2ProcessingReviewStore(storageBucketForNode(c.env, nodeId)),
        c.get('ownerId'),
        c.get('sessionId'),
      );
      return c.json(
        await repository.preview(
          c.req.param('photoId'),
          c.req.param('versionId'),
        ),
      );
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.get('/api/v1/photo-versions/capabilities', (c) => {
  return c.json(
    photoVersionsCapabilitiesSchema.parse({
      enabled: photoVersionsCapability(c.env),
    }),
  );
});
app.get('/api/v1/photos/:photoId/versions', async (c) => {
  try {
    if (!photoVersionsCapability(c.env))
      throw new WorkspaceFailure('PHOTO_VERSIONS_DISABLED', 503);
    const params = new URL(c.req.url).searchParams;
    if (
      [...params.keys()].some(
        (key) => key !== 'cursor' || params.getAll(key).length !== 1,
      )
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const cursor = z
      .string()
      .min(1)
      .max(2048)
      .optional()
      .parse(params.get('cursor') ?? undefined);
    return c.json(
      await new D1PhotoVersionHeadsRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).list(z.uuid().parse(c.req.param('photoId')), cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/photos/:photoId/versions/set-current', async (c) => {
  try {
    checkOrigin(c);
    if (!photoVersionsCapability(c.env))
      throw new WorkspaceFailure('PHOTO_VERSIONS_DISABLED', 503);
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const input = setCurrentPhotoVersionSchema.parse(await readContentBody(c));
    return c.json(
      await new D1PhotoVersionHeadsRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).setCurrent(z.uuid().parse(c.req.param('photoId')), input),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/albums/:albumId/photos', async (c) => {
  try {
    const query = listQuery(c.req.url, false);
    return c.json(
      await new D1GalleryRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).list(c.req.param('albumId'), query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.route('/', projectMatchingRulesRoutes);
app.route('/', matchingRuleIndexRoutes);
app.route('/', assistedCandidateCatalogRoutes);
app.route('/', matchingFilenameIndexRoutes);
app.route('/', ownerHistoryRoutes);
app.route('/', guestAnnotationRoutes);
app.route('/', annotationProcessingRoutes);
app.route('/', ownerAnnotationAuthoringRoutes);
app.route('/', ownerAnnotationRoutes);
app.route('/', ownerCommentRoutes);
app.route('/', commentProcessingRoutes);
app.route('/', versionUploadRoutes);
app.route('/', resolvedUploadRoutes);
app.get('/api/v1/resolved-batch-uploads/capabilities', (c) =>
  c.json(
    resolvedBatchUploadCapabilitiesSchema.parse({
      enabled: resolvedBatchUploadCapability(c.env),
      maxFiles: 1000,
      pageSize: 24,
    }),
  ),
);

app.route('/', projectVersioningRoutes);
app.route('/', sharedReviewRoutes);
app.route('/', selectionPolicyConfigurationRoutes);
app.get('/api/v1/albums/:albumId/selection-policy', async (c) => {
  try {
    if (configuration(c.env).GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    return c.json(
      await new D1SelectionPolicyRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).get(c.req.param('albumId')),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.put('/api/v1/albums/:albumId/selection-policy', async (c) => {
  try {
    checkOrigin(c);
    if (configuration(c.env).GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    return c.json(
      await new D1SelectionPolicyRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).set(c.req.param('albumId'), await readContentBody(c)),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/albums/:albumId/submissions', async (c) => {
  try {
    const config = configuration(c.env);
    if (config.GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    const repo = new D1OwnerSelectionRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    );
    const result = await repo.listSubmissions(c.req.param('albumId'));
    return c.json(result);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/albums/:albumId/submissions/:submissionId', async (c) => {
  try {
    const config = configuration(c.env);
    if (config.GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    const repo = new D1OwnerSelectionRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    );
    const result = await repo.getSubmission(
      c.req.param('albumId'),
      c.req.param('submissionId'),
    );
    return c.json(result);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get(
  '/api/v1/albums/:albumId/submissions/:submissionId/export',
  async (c) => {
    try {
      const config = configuration(c.env);
      if (config.GUEST_SELECTION_ENABLED !== 'true')
        throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
      const formatParam =
        new URL(c.req.url).searchParams.get('format') ?? 'csv';
      const format = z.enum(['csv', 'json', 'txt']).parse(formatParam);
      const repo = new D1OwnerSelectionRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      );
      const result = await repo.exportSubmission(
        c.req.param('albumId'),
        c.req.param('submissionId'),
        format,
      );
      return new Response(result.body, {
        headers: {
          'Content-Type': result.contentType,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.post('/api/v1/albums/:albumId/rounds/reopen', async (c) => {
  try {
    checkOrigin(c);
    const config = configuration(c.env);
    if (config.GUEST_SELECTION_ENABLED !== 'true')
      throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
    const repo = new D1OwnerSelectionRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    );
    const result = await repo.reopenRound(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json(result);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get(
  '/api/v1/photos/:photoId/versions/:versionId/assets/:kind',
  async (c) => {
    try {
      const item = await new D1GalleryRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).asset(
        c.req.param('photoId'),
        c.req.param('versionId'),
        c.req.param('kind'),
      );
      const object = await new R2StorageAdapter(
        storageBucketForNode(c.env, item.storage_node_id),
        item.storage_node_id,
      ).open(
        {
          workspaceId: item.workspace_id,
          projectId: item.project_id,
          albumId: item.album_id,
        },
        item.object_key,
      );
      const checksum = object.checksums.sha256
        ? Array.from(new Uint8Array(object.checksums.sha256), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      if (
        object.size !== item.byte_size ||
        object.size > 8388608 ||
        checksum !== item.checksum_sha256 ||
        object.httpMetadata?.contentType !== 'image/jpeg'
      ) {
        await object.body.cancel();
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      }
      return new Response(object.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(object.size),
          'Content-Disposition': 'inline',
          'Cross-Origin-Resource-Policy': 'same-origin',
          Vary: 'Cookie',
        },
      });
    } catch (error) {
      return contentError(c, error);
    }
  },
);
app.get('/api/v1/storage/nodes', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id,provider,status,priority,quota_bytes,used_bytes,reserved_bytes,last_reconciled_at FROM storage_nodes ORDER BY priority,id',
  ).all();
  return c.json({
    nodes: rows.results,
    multiAccountEnabled: false,
    autodelete: false,
    dryRun: true,
  });
});
app.get('/api/v1/storage/oracle-policy', async (c) => {
  try {
    const policy = await readOraclePolicy(c.env, c.get('ownerId'));
    return c.json({
      ...policy,
      capacity: await readStorageCapacity(
        c.env,
        c.get('ownerId'),
        c.get('sessionId'),
      ),
    });
  } catch (error) {
    return contentError(c, error);
  }
});
app.put('/api/v1/storage/oracle-policy', async (c) => {
  try {
    checkOrigin(c);
    const policy = await saveOraclePolicy(
      c.env,
      c.get('ownerId'),
      c.get('sessionId'),
      await readContentBody(c),
    );
    return c.json({
      ...policy,
      capacity: await readStorageCapacity(
        c.env,
        c.get('ownerId'),
        c.get('sessionId'),
      ),
    });
  } catch (error) {
    return contentError(c, error);
  }
});
app.all('/api/auth/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const publicPaths = [
    '/api/auth/sign-in/social',
    '/api/auth/callback/google',
    '/api/auth/callback/github',
    '/api/auth/get-session',
    '/api/auth/sign-out',
  ];
  if (!publicPaths.includes(path))
    return c.json({ error: { code: 'AUTH_OPERATION_NOT_AVAILABLE' } }, 404);
  const config = configuration(c.env);
  if (c.req.method !== 'GET' && c.req.header('Origin') !== config.origin)
    return c.json({ error: { code: 'FORBIDDEN_ORIGIN' } }, 403);
  const auth = createAuth(c.env);
  if (path === '/api/auth/get-session') {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (
      session &&
      !(await c.env.DB.prepare(
        'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
      )
        .bind(session.user.id)
        .first())
    )
      return c.json({ error: { code: 'OWNER_REQUIRED' } }, 403);
  }
  return auth.handler(c.req.raw);
});
app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND' } }, 404));
app.get('*', async (c) => {
  configuration(c.env);
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (
    new URL(c.req.url).pathname.startsWith('/assets/') &&
    (asset.status === 404 ||
      asset.headers.get('Content-Type')?.startsWith('text/html'))
  )
    return new Response(null, { status: 404 });
  if (asset.status !== 404) return asset;
  const fallback = new URL(c.req.url);
  fallback.pathname = '/';
  fallback.search = '';
  return c.env.ASSETS.fetch(new Request(fallback, c.req.raw));
});
app.onError(
  () =>
    new Response(JSON.stringify({ error: { code: 'SERVICE_NOT_READY' } }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      },
    }),
);
export default {
  async fetch(request: Request, env: WorkerEnv, context: ExecutionContext) {
    if (
      env.APP_ENV === 'production' &&
      env.PRODUCTION_RELEASE_ENABLED === 'true'
    ) {
      const verified = await verifyProductionGatewayRequest(
        request,
        env.KINO_GATEWAY_SECRET,
      );
      if (!verified)
        return new Response(null, {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        });
      request = verified;
    }
    return app.fetch(request, env, context);
  },
  async scheduled(event, env) {
    configuration(env);
    // Authorized reservations require a durable key fence; retention remains observation-only.
    const nodes = ['primary'];
    const oracle = await env.DB.prepare(
      "SELECT id FROM storage_nodes WHERE id='oracle-vm' AND provider='s3'",
    ).first();
    if (oracle) nodes.push('oracle-vm');
    // Disabling new VM admissions must not disable fences for existing sessions.
    await Promise.all(
      nodes.map((nodeId) =>
        expireDueReservations(
          env.DB,
          event.scheduledTime,
          new R2StorageAdapter(storageBucketForNode(env, nodeId), nodeId),
        ),
      ),
    );
    await pruneExpiredGuestAdmissionBuckets(env.DB);
    await processCloudflareImages(env);
    const observedDay = new Date(event.scheduledTime)
      .toISOString()
      .slice(0, 10);
    const retentionEventId = `cron-retention:${observedDay}`;
    await env.DB.prepare(
      "INSERT INTO audit_events(event_id,actor_type,action,after_json,request_id) SELECT ?,'system','retention.dry_run_observed',?,? WHERE NOT EXISTS(SELECT 1 FROM audit_events WHERE event_id=?)",
    )
      .bind(
        retentionEventId,
        JSON.stringify({
          deleted: 0,
          eligibility: 'not_implemented',
          observedAt: new Date(event.scheduledTime).toISOString(),
        }),
        retentionEventId,
        retentionEventId,
      )
      .run();
  },
} satisfies ExportedHandler<WorkerEnv>;
