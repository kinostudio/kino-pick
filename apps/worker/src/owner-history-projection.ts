import { matchingProfileIdSchema } from '../../../packages/contracts/src/matching-rules';
import { guestMediaDownloadAuditSchema } from '../../../packages/contracts/src/guest-downloads.ts';
import { z } from 'zod';

const MAX_DETAIL_JSON_CHARS = 32_768;
const MAX_DETAIL_DEPTH = 5;
const MAX_DETAIL_ARRAY_ITEMS = 128;

export type OwnerHistoryJson =
  | string
  | number
  | boolean
  | null
  | OwnerHistoryJson[]
  | { [key: string]: OwnerHistoryJson };

export type OwnerHistoryProjection = {
  status: 'available' | 'omitted' | 'invalid';
  before: Record<string, OwnerHistoryJson> | null;
  after: Record<string, OwnerHistoryJson> | null;
};

const id = z.string().min(1).max(160);
const shortText = z.string().max(256);
const bodyText = z
  .string()
  .max(8_192)
  .refine((value) => Array.from(value).length <= 2_000);
const timestamp = z.string().max(64);
const safeInteger = z.number().int().safe();
const nonnegativeInteger = safeInteger.min(0);
const positiveInteger = safeInteger.min(1);
const nullableId = id.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableNonnegativeInteger = nonnegativeInteger.nullable();

const projectStatus = z.enum([
  'approved',
  'archived',
  'delivered',
  'deleting',
  'deleted',
  'draft',
  'retouching',
  'reviewing',
  'selecting',
  'submitted',
  'uploading',
]);
const albumState = z.enum([
  'active',
  'archived',
  'deleted',
  'deleting',
  'draft',
]);
const versioningMode = z.enum(['assisted', 'auto_filename', 'manual', 'off']);
const contentType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const downloadFormat = z.enum(['csv', 'json', 'txt']);
const exportFormat = z.enum(['csv', 'json']);
const snapshotRowId = z
  .string()
  .min(1)
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => value.length < 19 || value <= '9223372036854775807');

const pointCoordinate = z.number().int().safe().min(0).max(1_000_000);
const extent = z.number().int().safe().min(1).max(1_000_000);
// Audit projection schemas intentionally strip unknown nested geometry/style keys.
const projectedGeometry = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('point'),
    coordinateSpace: z.literal('normalized_1e6'),
    x: pointCoordinate,
    y: pointCoordinate,
  }),
  z
    .object({
      type: z.literal('rectangle'),
      coordinateSpace: z.literal('normalized_1e6'),
      x: pointCoordinate,
      y: pointCoordinate,
      width: extent,
      height: extent,
    })
    .superRefine((rectangle, context) => {
      if (rectangle.x + rectangle.width > 1_000_000)
        context.addIssue({
          code: 'custom',
          path: ['width'],
          message: 'Invalid rectangle',
        });
      if (rectangle.y + rectangle.height > 1_000_000)
        context.addIssue({
          code: 'custom',
          path: ['height'],
          message: 'Invalid rectangle',
        });
    }),
]);
const projectedStyle = z.object({ color: z.enum(['amber', 'blue', 'red']) });

const auditObject = (shape: z.ZodRawShape) => z.object(shape);
type SideSchema = z.ZodType;
type ActionSchema = { before: SideSchema; after: SideSchema };

const emptyObject = auditObject({});
const same = (schema: SideSchema): ActionSchema => ({
  before: schema,
  after: schema,
});
const afterOnly = (after: SideSchema): ActionSchema => ({
  before: emptyObject,
  after,
});

const contentName = z
  .string()
  .min(1)
  .max(8_192)
  .refine((value) => Array.from(value).length <= 160);

const contentFields = auditObject({
  id: id.optional(),
  workspaceId: id.optional(),
  projectId: id.optional(),
  albumId: id.optional(),
  ownerUserId: id.optional(),
  name: contentName.optional(),
  role: z.literal('workspace_owner').optional(),
  quotaBytes: nonnegativeInteger.optional(),
  status: projectStatus.optional(),
  state: albumState.optional(),
  versioningMode: versioningMode.optional(),
  isPinned: z.boolean().optional(),
  legalHold: z.boolean().optional(),
  revision: nonnegativeInteger.optional(),
  createdAt: timestamp.optional(),
});

const uploadReservationFields = auditObject({
  id: id.optional(),
  workspaceId: id.optional(),
  projectId: id.optional(),
  albumId: id.optional(),
  originalFilename: z.string().min(1).max(255).optional(),
  expectedBytes: positiveInteger.optional(),
  reservedBytes: nonnegativeInteger.optional(),
  status: z.enum(['reserved', 'cancelled', 'expired']).optional(),
  expiresAt: timestamp.optional(),
  createdAt: timestamp.optional(),
});
const uploadAuthorizationFields = auditObject({
  uploadSessionId: id.optional(),
  expiresAt: timestamp.optional(),
  contentType: contentType.optional(),
  expectedBytes: positiveInteger.optional(),
  // sha256 is deliberately omitted even though the audit source stores it.
});
const uploadCompletionFields = auditObject({
  status: z.literal('completed').optional(),
  actualBytes: positiveInteger.optional(),
  contentType: contentType.optional(),
  assetId: id.optional(),
  width: positiveInteger.optional(),
  height: positiveInteger.optional(),
});
const uploadTransitionFields = auditObject({
  id: id.optional(),
  status: z.enum(['reserved', 'cancelled', 'expired']).optional(),
  reservedBytes: nonnegativeInteger.optional(),
});
const uploadFenceFields = auditObject({
  uploadSessionId: id.optional(),
  reason: z.enum(['cancel', 'expire']).optional(),
});
const uploadReviewFields = auditObject({
  uploadSessionId: id.optional(),
  reason: z.string().max(80).optional(),
});
const externalIntentFields = auditObject({
  operation: z.enum(['upload.cancelled', 'processing.abandoned']).optional(),
  uploadSessionId: id.optional(),
  jobId: id.optional(),
  expectedEpoch: nonnegativeInteger.optional(),
});

const processingOutput = auditObject({
  kind: z.enum(['preview', 'thumbnail']).optional(),
  bytes: positiveInteger.optional(),
  mime: z.literal('image/jpeg').optional(),
  width: positiveInteger.optional(),
  height: positiveInteger.optional(),
  // sha256 and object keys are deliberately omitted.
});
const processingFields = auditObject({
  status: z
    .enum([
      'abandoned',
      'enqueued',
      'needs_review',
      'queued',
      'retryable',
      'running',
      'succeeded',
      'unsupported',
    ])
    .optional(),
  reservedBytes: nonnegativeInteger.optional(),
  leaseEpoch: nonnegativeInteger.optional(),
  reason: z
    .enum(['PROCESSING_CONTENT_INVALID', 'PROCESSING_IO_UNCERTAIN'])
    .nullable()
    .optional(),
  jobId: id.optional(),
  recipe: z.string().max(80).optional(),
  outputs: z.array(processingOutput).max(2).optional(),
});

const photoVersionCurrentFields = auditObject({
  versionId: id.optional(),
  revision: nonnegativeInteger.optional(),
});
const photoVersionCreatedFields = auditObject({
  versionId: id.optional(),
  versionNo: positiveInteger.optional(),
  parentVersionId: nullableId.optional(),
  status: z.enum(['draft', 'private', 'published']).optional(),
  changeType: z.enum(['new_retouch', 'replace_current']).optional(),
  changeNote: bodyText.optional(),
  labels: z.array(shortText).max(16).optional(),
  actualBytes: positiveInteger.optional(),
  contentType: contentType.optional(),
  width: positiveInteger.optional(),
  height: positiveInteger.optional(),
  assetId: id.optional(),
  // sha256 is deliberately omitted even though the audit source stores it.
});

const selectionFields = auditObject({
  selected: z.boolean().optional(),
  versionId: nullableId.optional(),
  selectedVersionId: nullableId.optional(),
  selectedAt: nullableTimestamp.optional(),
  roundNo: positiveInteger.optional(),
  selectionRevision: nonnegativeInteger.optional(),
  status: z.enum(['open', 'submitted']).optional(),
  roundStatus: z.enum(['open', 'submitted']).optional(),
  submissionId: id.optional(),
  selectedCount: nonnegativeInteger.optional(),
});
const selectionReopenFields = auditObject({
  status: z.enum(['open', 'submitted']).optional(),
  roundNo: positiveInteger.optional(),
  selectionRevision: nonnegativeInteger.optional(),
});
const roundInitializeFields = auditObject({
  inviteId: id.optional(),
  guestId: id.optional(),
  roundNo: positiveInteger.optional(),
  selectionRevision: nonnegativeInteger.optional(),
});
const ratingFields = auditObject({
  photoId: id.optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  versionId: nullableId.optional(),
  updatedAt: nullableTimestamp.optional(),
});
const photoPinFields = auditObject({
  photoId: id,
  albumId: id,
  isPinned: z.boolean(),
  revision: nonnegativeInteger,
});
const favoriteFields = auditObject({
  photoId: id.optional(),
  favored: z.boolean().optional(),
  versionId: nullableId.optional(),
  updatedAt: nullableTimestamp.optional(),
});
const tagFields = auditObject({
  tagId: nullableId.optional(),
  label: shortText.optional(),
  present: z.boolean().optional(),
  versionId: nullableId.optional(),
  updatedAt: nullableTimestamp.optional(),
});

const commentFields = auditObject({
  commentId: id.optional(),
  revision: nonnegativeInteger.optional(),
  state: z.enum(['absent', 'open', 'resolved', 'deleted']).optional(),
  body: bodyText.nullable().optional(),
});
const ownerReplyFields = auditObject({
  commentId: id.optional(),
  revision: nonnegativeInteger.optional(),
  state: z.enum(['absent', 'open', 'resolved', 'deleted']).optional(),
  body: bodyText.nullable().optional(),
  parentCommentId: nullableId.optional(),
});
const ownerCommentProcessingFields = auditObject({
  commentId: id.optional(),
  state: z.enum(['open', 'in_progress', 'resolved']).optional(),
  revision: nonnegativeInteger.optional(),
  commentRevision: nullableNonnegativeInteger.optional(),
  contentRevision: nullableNonnegativeInteger.optional(),
});
const annotationFields = auditObject({
  annotationId: id.optional(),
  revision: nonnegativeInteger.optional(),
  state: z.enum(['open', 'resolved', 'deleted']).nullable().optional(),
  geometry: projectedGeometry.nullable().optional(),
  style: projectedStyle.nullable().optional(),
  commentId: nullableId.optional(),
  ownerId: id.optional(),
  inviteId: id.optional(),
  workspaceId: id.optional(),
  projectId: id.optional(),
  albumId: id.optional(),
  photoId: id.optional(),
  versionId: id.optional(),
  authorType: z.enum(['guest', 'owner']).optional(),
  authorLabel: z.string().min(1).max(160).optional(),
  createdAtMs: nonnegativeInteger.optional(),
  updatedAtMs: nonnegativeInteger.optional(),
});
const annotationProcessingFields = auditObject({
  ownerId: id.optional(),
  annotationId: id.optional(),
  inviteId: id.optional(),
  workspaceId: id.optional(),
  projectId: id.optional(),
  albumId: id.optional(),
  photoId: id.optional(),
  versionId: id.optional(),
  state: z.enum(['open', 'in_progress', 'resolved']).optional(),
  revision: nonnegativeInteger.optional(),
  annotationRevision: nullableNonnegativeInteger.optional(),
  contentRevision: nullableNonnegativeInteger.optional(),
  updatedAtMs: nonnegativeInteger.nullable().optional(),
});

const inviteFields = auditObject({
  inviteId: id.optional(),
  accessMode: z
    .enum(['link_only', 'generated_password', 'custom_password'])
    .optional(),
  permissionsMask: z.number().int().min(0).max(4095).optional(),
  expiresAtMs: nonnegativeInteger.optional(),
  maxUses: positiveInteger.nullable().optional(),
  albumIds: z.array(id).max(MAX_DETAIL_ARRAY_ITEMS).optional(),
});
const revocationFields = auditObject({ revoked: z.boolean().optional() });
const guestSessionFields = auditObject({
  inviteId: id.optional(),
  expiresAtMs: nonnegativeInteger.optional(),
});
const kdfFields = auditObject({
  permitId: id.optional(),
  inviteId: id.optional(),
});

const policyFields = auditObject({
  albumId: id.optional(),
  projectId: id.optional(),
  minimum: positiveInteger.optional(),
  maximum: positiveInteger.nullable().optional(),
  revision: nonnegativeInteger.optional(),
  mode: z.string().max(64).optional(),
});
const policyConfiguration = auditObject({
  albumId: id.optional(),
  projectId: id.optional(),
  configuration: z.enum(['inherit', 'override']).optional(),
  policy: auditObject({
    minimum: positiveInteger.optional(),
    maximum: positiveInteger.nullable().optional(),
    mode: z.string().max(64).optional(),
    source: z.enum(['album', 'project', 'system']).optional(),
    projectRevision: nonnegativeInteger.optional(),
    albumRevision: nonnegativeInteger.optional(),
  }).optional(),
  projectRevision: nonnegativeInteger.optional(),
  albumRevision: nonnegativeInteger.optional(),
});

const sharedReviewFields = auditObject({
  reviewId: id.optional(),
  title: z.string().max(120).optional(),
  memberCount: nonnegativeInteger.optional(),
  roundNo: positiveInteger.optional(),
  revision: nonnegativeInteger.optional(),
  status: z.enum(['open', 'submitted']).optional(),
  minimum: positiveInteger.nullable().optional(),
  maximum: positiveInteger.nullable().optional(),
  selectedCount: nonnegativeInteger.optional(),
});
const legacyDownloadFields = auditObject({
  reviewId: id.optional(),
  submissionId: id.optional(),
  format: downloadFormat.optional(),
  selectedCount: nonnegativeInteger.optional(),
})
  .strict()
  .refine(
    (value) =>
      value.reviewId !== undefined ||
      value.submissionId !== undefined ||
      value.format !== undefined ||
      value.selectedCount !== undefined,
    'A legacy download detail must contain a known export field',
  );
const downloadFields = z.union([
  guestMediaDownloadAuditSchema,
  legacyDownloadFields,
]);
const exportFilters = auditObject({
  projectId: id.optional(),
  albumId: id.optional(),
  photoId: id.optional(),
  versionId: id.optional(),
  inviteId: id.optional(),
  actorType: z.enum(['guest', 'system', 'user']).optional(),
  actorId: id.optional(),
  action: z.string().max(128).optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
});
const exportStartedFields = auditObject({
  generationId: z.uuid().optional(),
  format: exportFormat.optional(),
  snapshotRowId: snapshotRowId.optional(),
  filters: exportFilters.optional(),
});
const exportCompletedFields = auditObject({
  generationId: z.uuid().optional(),
  format: exportFormat.optional(),
  snapshotRowId: snapshotRowId.optional(),
  filters: exportFilters.optional(),
  count: nonnegativeInteger.optional(),
});
const retentionFields = auditObject({
  deleted: z.literal(0).optional(),
  eligibility: z.literal('not_implemented').optional(),
  observedAt: timestamp.optional(),
});
const galleryViewFields = auditObject({
  source: z.literal('visible_photo'),
  visibleForMs: positiveInteger.min(1_000).max(60_000),
});
const bootstrapFields = auditObject({ closed: z.literal(true).optional() });

const actionSchemas: Record<string, ActionSchema> = {
  'owner.bootstrapped': afterOnly(bootstrapFields),
  'owner.signed_in': same(emptyObject),
  'owner.session_revoked': same(emptyObject),

  'workspace.created': afterOnly(contentFields),
  'project.created': afterOnly(contentFields),
  'project.renamed': same(contentFields),
  'project.archived': same(contentFields),
  'project.restored': same(contentFields),
  'album.created': afterOnly(contentFields),
  'album.renamed': same(contentFields),
  'album.protection_changed': same(contentFields),
  'album.archived': same(contentFields),
  'album.restored': same(contentFields),
  'project.matching_rules_changed': same(
    auditObject({
      profile: matchingProfileIdSchema,
      ruleRevision: nonnegativeInteger,
      projectRevision: positiveInteger,
    }),
  ),
  'project.versioning_mode_changed': same(
    auditObject({
      mode: versioningMode.optional(),
      revision: nonnegativeInteger.optional(),
    }),
  ),

  'upload.reserved': afterOnly(uploadReservationFields),
  'upload.authorized': afterOnly(uploadAuthorizationFields),
  'upload.completed': same(uploadCompletionFields),
  'upload.cancelled': same(uploadTransitionFields),
  'upload.expired': same(uploadTransitionFields),
  'upload.capability_fenced': afterOnly(uploadFenceFields),
  'upload.needs_review': afterOnly(uploadReviewFields),
  'owner.external_intent_claimed': afterOnly(externalIntentFields),

  'processing.enqueued': afterOnly(processingFields),
  'processing.running': same(processingFields),
  'processing.retryable': same(processingFields),
  'processing.needs_review': same(processingFields),
  'processing.succeeded': same(processingFields),
  'processing.abandoned': same(processingFields),

  'photo.version.created': same(photoVersionCreatedFields),
  'photo.version_current_changed': same(photoVersionCurrentFields),

  'share.created': afterOnly(inviteFields),
  'share.scope_sealed': afterOnly(inviteFields),
  'share.revoked': same(revocationFields),
  'guest.session_created': afterOnly(guestSessionFields),
  'guest.session_revoked': same(revocationFields),
  'security.kdf_acquired': afterOnly(kdfFields),
  'security.kdf_released': afterOnly(kdfFields),
  'security.guest_kdf_acquired': afterOnly(kdfFields),
  'security.guest_kdf_released': afterOnly(kdfFields),

  'selection.added': same(selectionFields),
  'selection.removed': same(selectionFields),
  'selection.version_changed': same(selectionFields),
  'selection.submitted': same(selectionFields),
  'selection.reopened': same(selectionReopenFields),
  'selection.round_initialized': same(roundInitializeFields),
  'selection.policy_changed': same(policyFields),
  'selection.policy_configuration_changed': same(policyConfiguration),

  'rating.set': same(ratingFields),
  'rating.cleared': same(ratingFields),
  'photo.pinned': same(photoPinFields),
  'photo.unpinned': same(photoPinFields),
  'favorite.added': same(favoriteFields),
  'favorite.removed': same(favoriteFields),
  'tag.added': same(tagFields),
  'tag.removed': same(tagFields),

  'shared_review.created': same(sharedReviewFields),
  'shared_review.reopened': same(sharedReviewFields),
  'shared_selection.added': same(selectionFields),
  'shared_selection.removed': same(selectionFields),
  'shared_selection.version_changed': same(selectionFields),
  'shared_selection.submitted': same(selectionFields),

  'comment.create': same(commentFields),
  'comment.edit': same(commentFields),
  'comment.delete': same(commentFields),
  'comment.resolve': same(commentFields),
  'comment.reopen': same(commentFields),
  'owner.comment_reply_created': same(ownerReplyFields),
  'owner.comment_reply_edited': same(ownerReplyFields),
  'owner.comment_reply_deleted': same(ownerReplyFields),
  'owner.comment_processing_changed': same(ownerCommentProcessingFields),

  'annotation.created': same(annotationFields),
  'annotation.updated': same(annotationFields),
  'annotation.deleted': same(annotationFields),
  'annotation.resolved': same(annotationFields),
  'annotation.reopened': same(annotationFields),
  'owner.annotation_created': same(annotationFields),
  'owner.annotation_updated': same(annotationFields),
  'owner.annotation_deleted': same(annotationFields),
  'owner.annotation_resolved': same(annotationFields),
  'owner.annotation_reopened': same(annotationFields),
  'owner.annotation_processing_changed': same(annotationProcessingFields),

  'download.requested': afterOnly(downloadFields),
  'download.generated': afterOnly(downloadFields),
  'owner_history.export_started': afterOnly(exportStartedFields),
  'owner_history.export_completed': afterOnly(exportCompletedFields),

  'gallery.viewed': afterOnly(galleryViewFields),
  'version_approval.requested': afterOnly(
    auditObject({
      approvalRequestId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
      headRevision: safeInteger,
      inviteCount: positiveInteger.max(24),
    }),
  ),
  'version_approval.confirmed': afterOnly(
    auditObject({
      approvalRequestId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
    }),
  ),
  'retention.dry_run_observed': afterOnly(retentionFields),
};

export const OWNER_HISTORY_PROJECTED_ACTIONS = Object.freeze(
  Object.keys(actionSchemas).sort(),
);

function cloneBounded(value: unknown, depth = 0): OwnerHistoryJson | undefined {
  if (depth > MAX_DETAIL_DEPTH) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return value.length <= 8_192 ? value : undefined;
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_DETAIL_ARRAY_ITEMS) return undefined;
    const result: OwnerHistoryJson[] = [];
    for (const item of value) {
      const cloned = cloneBounded(item, depth + 1);
      if (cloned === undefined) return undefined;
      result.push(cloned);
    }
    return result;
  }
  if (typeof value !== 'object') return undefined;

  const entries = Object.entries(value);
  if (entries.length > 40) return undefined;
  const result: Record<string, OwnerHistoryJson> = {};
  for (const [key, item] of entries) {
    if (item === undefined) continue;
    const cloned = cloneBounded(item, depth + 1);
    if (cloned === undefined) return undefined;
    result[key] = cloned;
  }
  return result;
}

function projectSide(
  schema: SideSchema,
  rawJson: string | null,
): Record<string, OwnerHistoryJson> | null | undefined {
  if (rawJson === null) return null;
  if (rawJson.length > MAX_DETAIL_JSON_CHARS) return undefined;

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch {
    return undefined;
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) return undefined;
  if (
    parsed.data === null ||
    typeof parsed.data !== 'object' ||
    Array.isArray(parsed.data)
  )
    return undefined;

  const projected = cloneBounded(parsed.data);
  if (
    projected === undefined ||
    projected === null ||
    typeof projected !== 'object' ||
    Array.isArray(projected)
  )
    return undefined;
  return projected;
}

/**
 * Builds a strict, action-specific projection of append-only audit JSON.
 * Unknown actions are retained by the caller as envelopes with omitted details.
 * Unknown fields are stripped at each schema level; malformed known values fail closed.
 */
export function projectOwnerHistoryDetails(
  action: string,
  beforeJson: string | null,
  afterJson: string | null,
): OwnerHistoryProjection {
  const schema = actionSchemas[action];
  if (!schema) return { status: 'omitted', before: null, after: null };

  if (
    (beforeJson?.length ?? 0) + (afterJson?.length ?? 0) >
    MAX_DETAIL_JSON_CHARS
  )
    return { status: 'invalid', before: null, after: null };

  const before = projectSide(schema.before, beforeJson);
  const after = projectSide(schema.after, afterJson);
  if (before === undefined || after === undefined)
    return { status: 'invalid', before: null, after: null };

  const output = { before, after };
  if (JSON.stringify(output).length > MAX_DETAIL_JSON_CHARS)
    return { status: 'invalid', before: null, after: null };

  return { status: 'available', ...output };
}
