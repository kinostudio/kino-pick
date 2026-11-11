import { productionRuntimeAllowed } from './production-runtime';
import { z } from 'zod';
import {
  stagingCollaborationValidationEnabled,
  stagingGuestValidationEnabled,
} from './staging-guest-scope';
export type WorkerEnv = Omit<
  Env,
  | 'PRODUCTION_RELEASE_ENABLED'
  | 'ORACLE_STORAGE_ENABLED'
  | 'DIRECT_UPLOAD_ENABLED'
  | 'CLOUDFLARE_IMAGE_PROCESSING_ENABLED'
  | 'PHOTO_VERSION_UPLOADS_ENABLED'
  | 'PROJECT_VERSIONING_CONFIGURATION_ENABLED'
  | 'MATCHING_RULES_ENABLED'
  | 'ASSISTED_CANDIDATE_CATALOG_ENABLED'
  | 'RESOLVED_BATCH_UPLOAD_ENABLED'
  | 'INDEXED_VERSION_MATCHING_ENABLED'
  | 'MATCHING_FILENAME_INDEX_ENABLED'
  | 'PHOTO_VERSION_MATCHING_ENABLED'
  | 'PHOTO_VERSIONS_ENABLED'
  | 'GUEST_DOWNLOADS_ENABLED'
  | 'GUEST_VERSION_COMPARISON_ENABLED'
  | 'GUEST_COMMENTS_ENABLED'
  | 'GUEST_ANNOTATIONS_ENABLED'
  | 'GUEST_EXCHANGE_ENABLED'
  | 'STAGING_GUEST_VALIDATION'
  | 'STAGING_COLLABORATION_VALIDATION'
  | 'ALBUM_ACTIVATION_ENABLED'
  | 'OWNER_COMMENTS_ENABLED'
  | 'OWNER_ANNOTATIONS_ENABLED'
  | 'OWNER_ANNOTATION_AUTHORING_ENABLED'
  | 'OWNER_ANNOTATION_PROCESSING_ENABLED'
  | 'OWNER_HISTORY_ENABLED'
  | 'OWNER_COMMENT_PROCESSING_ENABLED'
  | 'HUMAN_VIEW_TRACKING_ENABLED'
  | 'VERSION_APPROVALS_ENABLED'
  | 'APPROVED_DELIVERIES_ENABLED'
  | 'DELIVERY_ZIP_ENABLED'
  | 'FREEHAND_ANNOTATIONS_ENABLED'
  | 'PHOTOGRAPHER_RECOMMENDATIONS_ENABLED'
> & {
  PRODUCTION_RELEASE_ENABLED?: string;
  PHOTO_VERSION_UPLOADS_ENABLED?: string;
  MATCHING_RULES_ENABLED?: string;
  ASSISTED_CANDIDATE_CATALOG_ENABLED?: string;
  RESOLVED_BATCH_UPLOAD_ENABLED?: string;
  INDEXED_VERSION_MATCHING_ENABLED?: string;
  MATCHING_FILENAME_INDEX_ENABLED?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DIRECT_UPLOAD_ENABLED?: string;
  CLOUDFLARE_IMAGE_PROCESSING_ENABLED?: string;
  IMAGES?: ImagesBinding;
  PHOTO_VERSION_MATCHING_ENABLED?: string;
  PHOTO_VERSIONS_ENABLED?: string;
  GUEST_DOWNLOADS_ENABLED?: string;
  GUEST_VERSION_COMPARISON_ENABLED?: string;
  GUEST_COMMENTS_ENABLED?: string;
  GUEST_ANNOTATIONS_ENABLED?: string;
  OWNER_COMMENTS_ENABLED?: string;
  OWNER_ANNOTATIONS_ENABLED?: string;
  OWNER_ANNOTATION_AUTHORING_ENABLED?: string;
  OWNER_ANNOTATION_PROCESSING_ENABLED?: string;
  OWNER_HISTORY_ENABLED?: string;
  OWNER_COMMENT_PROCESSING_ENABLED?: string;
  HUMAN_VIEW_TRACKING_ENABLED?: string;
  CLIENT_ACTIVITY_ENABLED?: string;
  VERSION_APPROVALS_ENABLED?: string;
  APPROVED_DELIVERIES_ENABLED?: string;
  DELIVERY_ZIP_ENABLED?: string;
  FREEHAND_ANNOTATIONS_ENABLED?: string;
  PHOTOGRAPHER_RECOMMENDATIONS_ENABLED?: string;
  PROJECT_VERSIONING_CONFIGURATION_ENABLED?: string;
  GUEST_INVITE_ISSUANCE_ENABLED?: string;
  STAGING_GUEST_VALIDATION?: string;
  STAGING_COLLABORATION_VALIDATION?: string;
  ALBUM_ACTIVATION_ENABLED?: string;
  GUEST_EXCHANGE_ENABLED?: string;
  GUEST_SELECTION_ENABLED?: string;
  GUEST_FEEDBACK_ENABLED?: string;
  GUEST_SHARED_SELECTION_ENABLED?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  ORACLE_STORAGE_ENABLED?: string;
  ORACLE_STORAGE_ENDPOINT?: string;
  ORACLE_STORAGE_REGION?: string;
  ORACLE_STORAGE_BUCKET?: string;
  ORACLE_STORAGE_ACCESS_KEY_ID?: string;
  ORACLE_STORAGE_SECRET_ACCESS_KEY?: string;
  ORACLE_STORAGE_ADMIN_USER_ID?: string;
};
export function configuration(env: WorkerEnv) {
  const config = z
    .object({
      APP_ENV: z.enum(['local', 'staging', 'production']),
      PRODUCTION_RELEASE_ENABLED: z.enum(['true', 'false']).default('false'),
      APP_URL: z.url(),
      REGISTRATION_MODE: z.literal('closed'),
      STORAGE_AUTODELETE_ENABLED: z.literal('false'),
      STORAGE_RETENTION_DRY_RUN: z.literal('true'),
      MULTI_ACCOUNT_STORAGE_ENABLED: z.literal('false'),
      ORACLE_STORAGE_ENABLED: z.enum(['true', 'false']).default('false'),
      DIRECT_UPLOAD_ENABLED: z.enum(['true', 'false']).default('false'),
      CLOUDFLARE_IMAGE_PROCESSING_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      GUEST_INVITE_ISSUANCE_ENABLED: z.enum(['true', 'false']).default('false'),
      STAGING_GUEST_VALIDATION: z.enum(['true', 'false']).default('false'),
      STAGING_COLLABORATION_VALIDATION: z
        .enum(['true', 'false'])
        .default('false'),
      ALBUM_ACTIVATION_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_EXCHANGE_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_SELECTION_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_FEEDBACK_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_TAGS_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_HISTORY_ENABLED: z.enum(['true', 'false']).default('false'),
      HUMAN_VIEW_TRACKING_ENABLED: z.enum(['true', 'false']).default('false'),
      CLIENT_ACTIVITY_ENABLED: z.enum(['true', 'false']).default('true'),
      VERSION_APPROVALS_ENABLED: z.enum(['true', 'false']).default('false'),
      APPROVED_DELIVERIES_ENABLED: z.enum(['true', 'false']).default('false'),
      DELIVERY_ZIP_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_DOWNLOADS_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_COMMENTS_ENABLED: z.enum(['true', 'false']).default('false'),
      GUEST_ANNOTATIONS_ENABLED: z.enum(['true', 'false']).default('false'),
      FREEHAND_ANNOTATIONS_ENABLED: z.enum(['true', 'false']).default('false'),
      PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      MATCHING_RULES_ENABLED: z.enum(['true', 'false']).default('false'),
      ASSISTED_CANDIDATE_CATALOG_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      RESOLVED_BATCH_UPLOAD_ENABLED: z.enum(['true', 'false']).default('false'),
      INDEXED_VERSION_MATCHING_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      MATCHING_FILENAME_INDEX_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      OWNER_HISTORY_ENABLED: z.enum(['true', 'false']).default('false'),
      OWNER_COMMENTS_ENABLED: z.enum(['true', 'false']).default('false'),
      OWNER_ANNOTATIONS_ENABLED: z.enum(['true', 'false']).default('false'),
      OWNER_ANNOTATION_PROCESSING_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      OWNER_ANNOTATION_AUTHORING_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      OWNER_COMMENT_PROCESSING_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      GUEST_VERSION_COMPARISON_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      PHOTO_VERSIONS_ENABLED: z.enum(['true', 'false']).default('false'),
      PROJECT_VERSIONING_CONFIGURATION_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      PHOTO_VERSION_UPLOADS_ENABLED: z.enum(['true', 'false']).default('false'),
      PHOTO_VERSION_MATCHING_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
      GUEST_SHARED_SELECTION_ENABLED: z
        .enum(['true', 'false'])
        .default('false'),
    })
    .parse(env);
  const strictProduction = productionRuntimeAllowed(env);
  if (config.PRODUCTION_RELEASE_ENABLED === 'true' && !strictProduction)
    throw new Error('PRODUCTION_RELEASE_CONTEXT_INVALID');
  const strictStagingGuestValidation = stagingGuestValidationEnabled(env);
  const strictStagingCollaborationValidation =
    stagingCollaborationValidationEnabled(env);
  if (
    config.PHOTOGRAPHER_RECOMMENDATIONS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error(
      'PHOTOGRAPHER_RECOMMENDATIONS_LOCAL_OR_COLLABORATION_STAGING_ONLY',
    );
  if (
    config.ALBUM_ACTIVATION_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingGuestValidation &&
    !strictProduction
  )
    throw new Error('ALBUM_ACTIVATION_LOCAL_OR_SCOPED_STAGING_ONLY');
  if (env.STAGING_GUEST_VALIDATION === 'true' && !strictStagingGuestValidation)
    throw new Error('STAGING_GUEST_VALIDATION_CONTEXT_INVALID');
  if (
    config.STAGING_COLLABORATION_VALIDATION === 'true' &&
    !strictStagingCollaborationValidation
  )
    throw new Error('STAGING_COLLABORATION_VALIDATION_CONTEXT_INVALID');
  if (
    config.CLOUDFLARE_IMAGE_PROCESSING_ENABLED === 'true' &&
    config.APP_ENV === 'production' &&
    !strictProduction
  )
    throw new Error('CLOUDFLARE_PROCESSING_HOSTED_ACCEPTANCE_REQUIRED');
  const url = new URL(config.APP_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(
        config.APP_ENV === 'local' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      ))
  )
    throw new Error('INVALID_ORIGIN');
  if (url.hostname.endsWith('.invalid'))
    throw new Error('DEPLOYMENT_NOT_CONFIGURED');
  if (
    config.GUEST_EXCHANGE_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingGuestValidation &&
    !strictProduction
  )
    throw new Error('GUEST_EXCHANGE_LOCAL_ONLY');
  if (
    config.GUEST_SELECTION_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingGuestValidation &&
    !strictProduction
  )
    throw new Error('GUEST_SELECTION_LOCAL_ONLY');
  if (
    config.GUEST_FEEDBACK_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_FEEDBACK_LOCAL_ONLY');
  if (
    config.GUEST_SHARED_SELECTION_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('GUEST_SHARED_SELECTION_LOCAL_ONLY');
  if (
    config.GUEST_TAGS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_TAGS_LOCAL_ONLY');
  if (config.MATCHING_RULES_ENABLED === 'true' && config.APP_ENV !== 'local')
    throw new Error('MATCHING_RULES_LOCAL_ONLY');
  if (
    config.RESOLVED_BATCH_UPLOAD_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('RESOLVED_BATCH_UPLOAD_LOCAL_ONLY');
  if (
    config.ASSISTED_CANDIDATE_CATALOG_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('ASSISTED_CANDIDATE_CATALOG_LOCAL_ONLY');
  if (
    config.INDEXED_VERSION_MATCHING_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('INDEXED_VERSION_MATCHING_LOCAL_ONLY');
  if (
    config.MATCHING_FILENAME_INDEX_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('MATCHING_FILENAME_INDEX_LOCAL_ONLY');
  if (
    config.OWNER_HISTORY_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('OWNER_HISTORY_LOCAL_ONLY');
  if (
    config.GUEST_HISTORY_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_HISTORY_LOCAL_ONLY');
  if (
    config.HUMAN_VIEW_TRACKING_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('HUMAN_VIEW_TRACKING_LOCAL_ONLY');
  if (
    config.VERSION_APPROVALS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('VERSION_APPROVALS_LOCAL_OR_COLLABORATION_STAGING_ONLY');
  if (
    config.DELIVERY_ZIP_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('DELIVERY_ZIP_LOCAL_OR_COLLABORATION_STAGING_ONLY');
  if (
    config.APPROVED_DELIVERIES_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('APPROVED_DELIVERIES_LOCAL_OR_COLLABORATION_STAGING_ONLY');
  if (
    config.GUEST_DOWNLOADS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_DOWNLOADS_LOCAL_ONLY');
  if (
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('PHOTO_VERSIONS_LOCAL_ONLY');
  if (
    config.PHOTO_VERSION_UPLOADS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('PHOTO_VERSION_UPLOADS_LOCAL_ONLY');
  if (
    config.PROJECT_VERSIONING_CONFIGURATION_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('PROJECT_VERSIONING_CONFIGURATION_LOCAL_ONLY');
  if (
    config.PHOTO_VERSION_MATCHING_ENABLED === 'true' &&
    config.APP_ENV !== 'local'
  )
    throw new Error('PHOTO_VERSION_MATCHING_LOCAL_ONLY');
  if (
    config.GUEST_VERSION_COMPARISON_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_VERSION_COMPARISON_LOCAL_ONLY');
  if (
    config.GUEST_COMMENTS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_COMMENTS_LOCAL_ONLY');
  if (
    config.OWNER_COMMENTS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('OWNER_COMMENTS_LOCAL_ONLY');
  if (
    config.OWNER_COMMENT_PROCESSING_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('OWNER_COMMENT_PROCESSING_LOCAL_ONLY');
  if (
    config.GUEST_ANNOTATIONS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('GUEST_ANNOTATIONS_LOCAL_ONLY');
  if (
    config.FREEHAND_ANNOTATIONS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('FREEHAND_ANNOTATIONS_LOCAL_ONLY');
  if (
    config.OWNER_ANNOTATION_PROCESSING_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('OWNER_ANNOTATION_PROCESSING_LOCAL_ONLY');
  if (
    config.OWNER_ANNOTATIONS_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('OWNER_ANNOTATIONS_LOCAL_ONLY');
  if (
    config.OWNER_ANNOTATION_AUTHORING_ENABLED === 'true' &&
    config.APP_ENV !== 'local' &&
    !strictStagingCollaborationValidation &&
    !strictProduction
  )
    throw new Error('OWNER_ANNOTATION_AUTHORING_LOCAL_ONLY');
  return { ...config, origin: url.origin };
}

/** Local or exact-B collaboration feature environment. */
export function collaborationFeatureEnvironment(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.APP_ENV === 'local' ||
    stagingCollaborationValidationEnabled(env) ||
    productionRuntimeAllowed(env)
  );
}

/** Photo-version reads are limited to local use or the explicit collaboration profile. */
export function photoVersionsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true'
  );
}

/** Guest feedback is opt-in and each write still requires its invitation bit. */
export function guestFeedbackCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.GUEST_FEEDBACK_ENABLED === 'true'
  );
}

/** Guest tags are opt-in and each write still requires can_tag. */
export function guestTagsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) && config.GUEST_TAGS_ENABLED === 'true'
  );
}

/** Guest history is private to the authenticated invitation. */
export function guestHistoryCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.GUEST_HISTORY_ENABLED === 'true'
  );
}

/** Version uploads require supporting upload/version gates. */
export function versionUploadCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.DIRECT_UPLOAD_ENABLED === 'true' &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.PHOTO_VERSION_UPLOADS_ENABLED === 'true'
  );
}

/** Project configuration stays local and requires the version-read/switch workflow. */
export function projectVersioningCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.PROJECT_VERSIONING_CONFIGURATION_ENABLED === 'true'
  );
}

/** Resolved uploads require configuration plus every upload/version gate. */
export function resolvedUploadCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    versionUploadCapability(env) &&
    projectVersioningCapability(env) &&
    config.PHOTO_VERSION_MATCHING_ENABLED === 'true'
  );
}

/** Guest comparison requires view+compare per request; this is only a feature gate. */
export function guestVersionComparisonCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.GUEST_EXCHANGE_ENABLED === 'true' &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.GUEST_VERSION_COMPARISON_ENABLED === 'true'
  );
}

/** Guest file downloads are local-only and rely on per-asset D1 permissions. */
export function guestDownloadsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.GUEST_DOWNLOADS_ENABLED === 'true'
  );
}

/** Customer activity is background-on by default; explicit false remains the rollout kill switch. */
export function clientActivityCapability(env: WorkerEnv): boolean {
  return configuration(env).CLIENT_ACTIVITY_ENABLED === 'true';
}

/** Visible-photo retention heartbeat remains local-only. */
export function humanViewsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.APP_ENV === 'local' && config.HUMAN_VIEW_TRACKING_ENABLED === 'true'
  );
}

/** Comment text is independent of view/selection rights; D1 repeats can_comment. */
export function guestCommentsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.GUEST_EXCHANGE_ENABLED === 'true' &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.GUEST_COMMENTS_ENABLED === 'true'
  );
}

/** Owner collaboration has its own gate; Guest access can remain disabled. */
export function ownerCommentsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.OWNER_COMMENTS_ENABLED === 'true'
  );
}

/** Owner processing is independent from Guest writes and never changes Guest content. */
export function ownerCommentProcessingCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    ownerCommentsCapability(env) &&
    config.OWNER_COMMENT_PROCESSING_ENABLED === 'true'
  );
}

/** Geometry grants never imply comment/image/select/compare access. */
export function guestAnnotationsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.GUEST_EXCHANGE_ENABLED === 'true' &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.GUEST_ANNOTATIONS_ENABLED === 'true'
  );
}

/** Owner metadata inspection is independent of Guest exchange and collaboration flags. */
export function ownerAnnotationsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.OWNER_ANNOTATIONS_ENABLED === 'true'
  );
}

/** Owner authoring requires its explicit local flag and the private version/Owner reader. */
export function ownerAnnotationAuthoringCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.OWNER_ANNOTATIONS_ENABLED === 'true' &&
    config.OWNER_ANNOTATION_AUTHORING_ENABLED === 'true'
  );
}

/** Freehand requires the independent Guest and Owner annotation paths. */
export function freehandAnnotationsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.FREEHAND_ANNOTATIONS_ENABLED === 'true' &&
    guestAnnotationsCapability(env) &&
    ownerAnnotationAuthoringCapability(env)
  );
}

/** Independent Owner decision state; never grants Guest annotation writes. */
export function ownerAnnotationProcessingCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.OWNER_ANNOTATIONS_ENABLED === 'true' &&
    config.OWNER_ANNOTATION_PROCESSING_ENABLED === 'true'
  );
}

/** Independent workspace history gate; actual scope is rechecked by D1. */
export function ownerHistoryCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.OWNER_HISTORY_ENABLED === 'true'
  );
}

/** Derived index maintenance never enables version matching or uploads. */
export function matchingFilenameIndexCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.APP_ENV === 'local' &&
    config.MATCHING_FILENAME_INDEX_ENABLED === 'true'
  );
}

/** Indexed automatic matching never grants Assisted or upload permissions. */
export function indexedVersionMatchingCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    resolvedUploadCapability(env) &&
    matchingFilenameIndexCapability(env) &&
    config.INDEXED_VERSION_MATCHING_ENABLED === 'true'
  );
}

/** A readonly catalog never grants access independently of indexed matching. */
export function assistedCandidateCatalogCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    indexedVersionMatchingCapability(env) &&
    config.ASSISTED_CANDIDATE_CATALOG_ENABLED === 'true'
  );
}

/** Project rules require the complete indexed matching and Assisted target path. */
export function matchingRulesCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    assistedCandidateCatalogCapability(env) &&
    config.MATCHING_RULES_ENABLED === 'true'
  );
}

/** Resolved batches require matching rules and add no matching or upload permission. */
export function resolvedBatchUploadCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.APP_ENV === 'local' &&
    matchingRulesCapability(env) &&
    config.RESOLVED_BATCH_UPLOAD_ENABLED === 'true'
  );
}

/** Version confirmations are local or limited to the exact B collaboration profile. */
export function versionApprovalsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    collaborationFeatureEnvironment(env) &&
    config.PHOTO_VERSIONS_ENABLED === 'true' &&
    config.VERSION_APPROVALS_ENABLED === 'true'
  );
}

/** Delivery stays closed unless version approvals and Guest downloads are enabled. */
export function approvedDeliveriesCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.APPROVED_DELIVERIES_ENABLED === 'true' &&
    versionApprovalsCapability(env) &&
    guestDownloadsCapability(env)
  );
}

/** Activation never grants Guest access; the real Owner and album revision are rechecked by D1. */
export function albumActivationCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.ALBUM_ACTIVATION_ENABLED === 'true' &&
    (config.APP_ENV === 'local' ||
      stagingGuestValidationEnabled(env) ||
      productionRuntimeAllowed(env))
  );
}

/** Metadata never grants Guest access or changes customer feedback. */
export function photographerRecommendationsCapability(env: WorkerEnv): boolean {
  const config = configuration(env);
  return (
    config.PHOTOGRAPHER_RECOMMENDATIONS_ENABLED === 'true' &&
    (config.APP_ENV === 'local' ||
      stagingCollaborationValidationEnabled(env) ||
      productionRuntimeAllowed(env))
  );
}

export function deliveryZipCapability(env: WorkerEnv): boolean {
  return (
    configuration(env).DELIVERY_ZIP_ENABLED === 'true' &&
    approvedDeliveriesCapability(env)
  );
}
