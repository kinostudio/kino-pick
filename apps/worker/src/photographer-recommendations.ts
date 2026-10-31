import { z } from 'zod';
import {
  importPhotographerMetadataRequestSchema,
  importPhotographerMetadataResultSchema,
  photographerMetadataResultSchema,
  photographerPhotoRecommendationSchema,
  photographerRecommendationPolicySchema,
  photographerRecommendationsPageSchema,
  photographerRecommendationsQuerySchema,
  photographerRecommendationPolicyResultSchema,
  setPhotographerPhotoMetadataResultSchema,
  setPhotographerPhotoMetadataSchema,
  setPhotographerRecommendationPolicySchema,
  type ImportPhotographerMetadataRequest,
  type PhotographerMetadataResult,
  type PhotographerPhotoRecommendation,
  type PhotographerRecommendationPolicy,
  type PhotographerRecommendationsPage,
} from '../../../packages/contracts/src/photographer-recommendations';
import { WorkspaceFailure } from './workspaces';

const uuidSchema = z.uuid();
const REQUIRED_PHOTOGRAPHER_RECOMMENDATION_TRIGGERS = [
  'photographer_recommendation_command_guard',
  'photographer_recommendation_policy_insert_guard',
  'photographer_recommendation_policy_update_guard',
  'photographer_recommendation_policy_no_delete',
  'photographer_photo_metadata_insert_guard',
  'photographer_photo_metadata_update_guard',
  'photographer_photo_metadata_no_delete',
  'photographer_recommendation_commands_no_update',
  'photographer_recommendation_commands_no_delete',
  'photographer_recommendation_commands_no_replace',
  'photographer_recommendation_results_insert_guard',
  'photographer_recommendation_results_no_update',
  'photographer_recommendation_results_no_delete',
  'photographer_recommendation_results_no_replace',
  'photographer_recommendation_audit_guard',
  'workspace_commands_photographer_recommendation_namespace',
  'request_commands_photographer_recommendation_namespace',
  'upload_requests_photographer_recommendation_namespace',
  'upload_workflow_requests_photographer_recommendation_namespace',
  'processing_review_commands_photographer_recommendation_namespace',
  'invite_revocation_commands_photographer_recommendation_namespace',
  'invite_creation_commands_photographer_recommendation_namespace',
  'selection_policy_commands_photographer_recommendation_namespace',
  'selection_policy_configuration_commands_photographer_recommendation_namespace',
  'shared_review_owner_commands_photographer_recommendation_namespace',
  'photo_version_head_commands_photographer_recommendation_namespace',
  'project_versioning_commands_photographer_recommendation_namespace',
  'owner_comment_commands_photographer_recommendation_namespace',
  'owner_comment_processing_commands_photographer_recommendation_namespace',
  'owner_external_intents_photographer_recommendation_namespace',
  'owner_annotation_processing_commands_photographer_recommendation_namespace',
  'owner_annotation_commands_photographer_recommendation_namespace',
  'version_approval_owner_commands_photographer_recommendation_namespace',
  'album_activation_commands_photographer_recommendation_namespace',
  'photographer_review_flags_photographer_recommendation_namespace',
  'upload_key_fences_photographer_recommendation_namespace',
  'photographer_recommendation_audit_namespace',
] as const;
type AlbumScope = {
  albumId: string;
  workspaceId: string;
  projectId: string;
  albumState: string;
  projectStatus: string;
};
type PolicyRow = {
  visibleValue: number;
  minRating: number | null;
  allowedLabelsJson: string;
  revision: number;
};
type PhotoRow = {
  photoId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  versionId: string;
  versionNo: number;
  headVersionId: string;
  headRevision: number;
  revision: number | null;
  sourceAssetId: string | null;
  sourceSha256: string | null;
  sourceMime: string | null;
  importedMetadataJson: string | null;
  importedAtMs: number | null;
  ratingState: string | null;
  ratingValue: number | null;
  labelState: string | null;
  labelValue: string | null;
  decision: string | null;
};
type CommandResultRow = {
  operation: string;
  payloadJson: string;
  albumId: string;
  photoId: string | null;
  versionId: string | null;
  resultJson: string | null;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function unavailable(): never {
  throw new WorkspaceFailure('PHOTOGRAPHER_RECOMMENDATIONS_UNAVAILABLE', 503);
}
function parseUuid(value: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) invalidInput();
  return result.data.toLowerCase();
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.toUpperCase() : '';
}
function translateFailure(error: unknown): never {
  if (error instanceof WorkspaceFailure) throw error;
  const message = messageOf(error);
  if (message.includes('OWNER_REQUIRED'))
    throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('PHOTOGRAPHER_RECOMMENDATION_REVISION_CONFLICT'))
    throw new WorkspaceFailure(
      'PHOTOGRAPHER_RECOMMENDATION_REVISION_CONFLICT',
      409,
    );
  if (message.includes('PHOTOGRAPHER_METADATA_REVISION_CONFLICT'))
    throw new WorkspaceFailure('PHOTOGRAPHER_METADATA_REVISION_CONFLICT', 409);
  if (message.includes('PHOTOGRAPHER_METADATA_SOURCE_CONFLICT'))
    throw new WorkspaceFailure('PHOTOGRAPHER_METADATA_SOURCE_CONFLICT', 409);
  if (message.includes('INVALID_INPUT'))
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (message.includes('FOREIGN KEY'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  unavailable();
}
function parseResult<T>(value: string | null, schema: z.ZodType<T>): T {
  if (value === null) unavailable();
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    unavailable();
  }
  const result = schema.safeParse(decoded);
  if (!result.success) unavailable();
  return result.data;
}
function asPolicy(
  row: PolicyRow | null,
  albumId: string,
): PhotographerRecommendationPolicy {
  let labels: unknown = [];
  if (row) {
    try {
      labels = JSON.parse(row.allowedLabelsJson) as unknown;
    } catch {
      unavailable();
    }
  }
  const result = photographerRecommendationPolicySchema.safeParse({
    albumId,
    revision: row?.revision ?? 0,
    visible: row?.visibleValue === 1,
    minRating: row?.minRating ?? null,
    allowedLabels: labels,
    matchMode: 'any',
  });
  if (!result.success) unavailable();
  return result.data;
}
function parseMetadata(
  value: string | null,
): PhotographerMetadataResult | null {
  if (value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    unavailable();
  }
  const parsed = photographerMetadataResultSchema.safeParse(decoded);
  if (!parsed.success) unavailable();
  return parsed.data;
}
function manualState(row: PhotoRow, key: 'rating' | 'label') {
  const state = key === 'rating' ? row.ratingState : row.labelState;
  const value = key === 'rating' ? row.ratingValue : row.labelValue;
  return { state: state ?? 'inherit', value: state === 'set' ? value : null };
}
function buildPhoto(
  row: PhotoRow,
  policy: PhotographerRecommendationPolicy,
): PhotographerPhotoRecommendation {
  const metadata = parseMetadata(row.importedMetadataJson);
  const importedRating =
    metadata === null
      ? { state: 'not_imported' as const }
      : metadata.status === 'unsupported_format'
        ? { state: 'unsupported_format' as const }
        : { state: 'imported' as const, field: metadata.rating };
  const importedLabel =
    metadata === null
      ? { state: 'not_imported' as const }
      : metadata.status === 'unsupported_format'
        ? { state: 'unsupported_format' as const }
        : { state: 'imported' as const, field: metadata.label };
  const manualRating = manualState(row, 'rating');
  const manualLabel = manualState(row, 'label');
  const rating =
    manualRating.state === 'set'
      ? (manualRating.value as number)
      : manualRating.state === 'clear'
        ? null
        : metadata?.status === 'supported' && metadata.rating.status === 'value'
          ? metadata.rating.value
          : null;
  const label =
    manualLabel.state === 'set'
      ? (manualLabel.value as 'red' | 'yellow' | 'green' | 'blue' | 'purple')
      : manualLabel.state === 'clear'
        ? null
        : metadata?.status === 'supported' && metadata.label.status === 'value'
          ? metadata.label.value
          : null;
  const manual = row.decision ?? 'inherit';
  const match =
    (policy.minRating !== null &&
      rating !== null &&
      rating >= policy.minRating) ||
    (policy.allowedLabels.length > 0 &&
      label !== null &&
      policy.allowedLabels.includes(label));
  const decision =
    manual === 'recommend'
      ? { manual, recommended: true, source: 'manual' as const }
      : manual === 'exclude'
        ? { manual, recommended: false, source: 'manual' as const }
        : match
          ? {
              manual: 'inherit' as const,
              recommended: true,
              source: 'criteria' as const,
            }
          : {
              manual: 'inherit' as const,
              recommended: false,
              source: 'none' as const,
            };
  const source =
    row.sourceAssetId &&
    row.sourceSha256 &&
    row.sourceMime &&
    row.importedAtMs !== null
      ? {
          assetId: row.sourceAssetId,
          sha256: row.sourceSha256,
          mime: row.sourceMime,
          importedAt: new Date(row.importedAtMs).toISOString(),
        }
      : null;
  const result = photographerPhotoRecommendationSchema.safeParse({
    photoId: row.photoId,
    versionId: row.versionId,
    versionNo: row.versionNo,
    revision: row.revision ?? 0,
    headRevision: row.headRevision,
    isCurrentHead: row.versionId === row.headVersionId,
    source,
    rating: {
      effective: rating,
      imported: importedRating,
      manual: manualRating,
    },
    label: { effective: label, imported: importedLabel, manual: manualLabel },
    decision,
  });
  if (!result.success) unavailable();
  return result.data;
}
const ownerCheckSql = [
  'SELECT 1 AS authorized FROM owners o JOIN owner_sessions s ON s.userId=o.user_id',
  "AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE o.user_id=? AND o.enabled=1",
].join(' ');
const albumScopeSql = [
  'SELECT a.id AS albumId,a.workspace_id AS workspaceId,a.project_id AS projectId,',
  'a.state AS albumState,p.status AS projectStatus FROM workspaces w',
  'JOIN projects p ON p.workspace_id=w.id JOIN albums a ON a.project_id=p.id AND a.workspace_id=w.id',
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  "JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
  'WHERE o.user_id=? AND a.id=?',
].join(' ');
const policySelectSql = [
  'SELECT visible AS visibleValue,min_rating AS minRating,allowed_labels_json AS allowedLabelsJson,revision',
  'FROM album_photographer_recommendation_policy WHERE album_id=?',
].join(' ');
const photoSelectPrefix = [
  'SELECT ph.id AS photoId,ph.workspace_id AS workspaceId,ph.project_id AS projectId,',
  'ph.album_id AS albumId,v.id AS versionId,v.version_no AS versionNo,',
  'h.version_id AS headVersionId,h.revision AS headRevision,m.revision,',
  'm.source_asset_id AS sourceAssetId,m.source_sha256 AS sourceSha256,',
  'm.source_mime AS sourceMime,m.imported_metadata_json AS importedMetadataJson,',
  'm.imported_at_ms AS importedAtMs,m.rating_state AS ratingState,m.rating_value AS ratingValue,',
  'm.label_state AS labelState,m.label_value AS labelValue,m.decision',
  'FROM photos ph JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=?',
  'JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id',
  'JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id AND a.workspace_id=ph.workspace_id',
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  "JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
  'JOIN photo_version_heads h ON h.photo_id=ph.id AND h.workspace_id=ph.workspace_id',
  'JOIN photo_versions v ON v.photo_id=ph.id AND v.workspace_id=ph.workspace_id',
  'LEFT JOIN photographer_photo_metadata m ON m.photo_id=ph.id AND m.version_id=v.id',
  "WHERE a.state NOT IN('archived','deleting','deleted')",
  "AND p.status NOT IN('archived','deleting','deleted')",
].join(' ');
function assertLive(scope: AlbumScope) {
  if (
    ['archived', 'deleting', 'deleted'].includes(scope.albumState) ||
    ['archived', 'deleting', 'deleted'].includes(scope.projectStatus)
  )
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
}

export class D1PhotographerRecommendationsRepository {
  private schemaProbe: Promise<boolean> | null = null;
  private readonly actorId: string;
  private readonly sessionId: string;

  constructor(
    private readonly db: D1Database,
    actorId: string,
    sessionId: string,
    private readonly enabled = false,
  ) {
    const actor = uuidSchema.safeParse(actorId);
    const session = uuidSchema.safeParse(sessionId);
    if (!actor.success || !session.success) invalidInput();
    this.actorId = actor.data.toLowerCase();
    this.sessionId = session.data.toLowerCase();
  }

  async capability(): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.schemaProbe) {
      this.schemaProbe = (async () => {
        try {
          await this.db
            .prepare(
              'SELECT 1 FROM album_photographer_recommendation_policy LIMIT 0',
            )
            .first();
          await this.db
            .prepare('SELECT 1 FROM photographer_photo_metadata LIMIT 0')
            .first();
          await this.db
            .prepare(
              'SELECT 1 FROM photographer_recommendation_commands LIMIT 0',
            )
            .first();
          await this.db
            .prepare(
              'SELECT 1 FROM photographer_recommendation_results LIMIT 0',
            )
            .first();
          const triggerSlots =
            REQUIRED_PHOTOGRAPHER_RECOMMENDATION_TRIGGERS.map(() => '?').join(
              ',',
            );
          const guards = await this.db
            .prepare(
              "SELECT count(*) AS count FROM sqlite_master WHERE type='trigger' " +
                'AND name IN (' +
                triggerSlots +
                ')',
            )
            .bind(...REQUIRED_PHOTOGRAPHER_RECOMMENDATION_TRIGGERS)
            .first<{ count: number }>();
          return (
            guards?.count ===
            REQUIRED_PHOTOGRAPHER_RECOMMENDATION_TRIGGERS.length
          );
        } catch {
          return false;
        }
      })();
    }
    return this.schemaProbe;
  }

  async read(
    albumIdInput: string,
    queryInput: unknown = {},
  ): Promise<PhotographerRecommendationsPage> {
    await this.assertReady();
    const albumId = parseUuid(albumIdInput);
    const query = photographerRecommendationsQuerySchema.safeParse(queryInput);
    if (!query.success) invalidInput();
    const scope = await this.loadAlbumScope(albumId);
    assertLive(scope);
    const policy = await this.loadPolicy(albumId);
    const cursor = query.data.cursor?.toLowerCase() ?? null;
    if (cursor) {
      const anchor = await this.db
        .prepare('SELECT 1 FROM photos WHERE id=? AND album_id=?')
        .bind(cursor, albumId)
        .first();
      if (!anchor) invalidInput();
    }
    const sql =
      photoSelectPrefix +
      ' AND ph.album_id=? AND v.id=h.version_id' +
      (cursor
        ? ' AND ph.id>? ORDER BY ph.id LIMIT ?'
        : ' ORDER BY ph.id LIMIT ?');
    let result: D1Result<PhotoRow>;
    try {
      result = await this.db
        .prepare(sql)
        .bind(
          this.actorId,
          this.sessionId,
          albumId,
          ...(cursor ? [cursor, query.data.limit + 1] : [query.data.limit + 1]),
        )
        .all<PhotoRow>();
    } catch (error) {
      translateFailure(error);
    }
    const more = result.results.length > query.data.limit;
    const rows = result.results.slice(0, query.data.limit);
    const page = photographerRecommendationsPageSchema.safeParse({
      policy,
      photos: rows.map((row) => buildPhoto(row, policy)),
      nextCursor: more ? (rows[rows.length - 1]?.photoId ?? null) : null,
    });
    if (!page.success) unavailable();
    return page.data;
  }

  async readPhoto(
    photoIdInput: string,
    versionIdInput?: string,
  ): Promise<PhotographerPhotoRecommendation> {
    await this.assertReady();
    const photoId = parseUuid(photoIdInput);
    const versionId =
      versionIdInput === undefined ? null : parseUuid(versionIdInput);
    const row = await this.loadPhoto(photoId, versionId);
    return buildPhoto(row, await this.loadPolicy(row.albumId));
  }

  async setPolicy(albumIdInput: string, input: unknown) {
    await this.assertReady();
    const albumId = parseUuid(albumIdInput);
    const parsed = setPhotographerRecommendationPolicySchema.safeParse(input);
    if (!parsed.success) invalidInput();
    const value = parsed.data;
    const scope = await this.loadAlbumScope(albumId);
    assertLive(scope);
    const payloadJson = JSON.stringify({
      requestId: value.requestId,
      expectedRevision: value.expectedRevision,
      visible: value.visible,
      minRating: value.minRating,
      allowedLabels: value.allowedLabels,
    });
    const prior = await this.findPrior(value.requestId);
    if (prior) return this.priorPolicy(prior, albumId, payloadJson);
    const current = await this.loadPolicy(albumId);
    if (current.revision !== value.expectedRevision)
      throw new WorkspaceFailure(
        'PHOTOGRAPHER_RECOMMENDATION_REVISION_CONFLICT',
        409,
      );
    const changed =
      current.visible !== value.visible ||
      current.minRating !== value.minRating ||
      JSON.stringify(current.allowedLabels) !==
        JSON.stringify(value.allowedLabels);
    const policy = photographerRecommendationPolicySchema.parse({
      albumId,
      revision: current.revision + (changed ? 1 : 0),
      visible: value.visible,
      minRating: value.minRating,
      allowedLabels: value.allowedLabels,
      matchMode: 'any',
    });
    const commandId = crypto.randomUUID().toLowerCase();
    const beforeJson = JSON.stringify(current);
    const afterJson = JSON.stringify(policy);
    const resultJson = JSON.stringify({
      policy,
      changed,
      eventId: changed ? commandId : null,
    });
    const labelJson = JSON.stringify(value.allowedLabels);
    const now = Date.now();
    try {
      const command = this.db
        .prepare(
          'INSERT INTO photographer_recommendation_commands(' +
            'id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,' +
            'expected_revision,visible,min_rating,allowed_labels_json,payload_json,before_json,created_at_ms' +
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          commandId,
          this.actorId,
          this.sessionId,
          value.requestId,
          'album.photographer_recommendations.set',
          scope.workspaceId,
          scope.projectId,
          albumId,
          value.expectedRevision,
          value.visible ? 1 : 0,
          value.minRating,
          labelJson,
          payloadJson,
          beforeJson,
          now,
        );
      const stateInsert = this.db
        .prepare(
          'INSERT INTO album_photographer_recommendation_policy(' +
            'album_id,workspace_id,project_id,visible,min_rating,allowed_labels_json,revision,last_command_id' +
            ') SELECT c.album_id,c.workspace_id,c.project_id,c.visible,c.min_rating,c.allowed_labels_json,' +
            'c.expected_revision+1,c.id FROM photographer_recommendation_commands c WHERE c.id=? AND ?=1 ' +
            'AND NOT EXISTS(SELECT 1 FROM album_photographer_recommendation_policy p WHERE p.album_id=c.album_id)',
        )
        .bind(commandId, changed ? 1 : 0);
      const stateUpdate = this.db
        .prepare(
          'UPDATE album_photographer_recommendation_policy SET ' +
            'visible=(SELECT c.visible FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'min_rating=(SELECT c.min_rating FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'allowed_labels_json=(SELECT c.allowed_labels_json FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'revision=(SELECT c.expected_revision+1 FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'last_command_id=? WHERE album_id=(SELECT c.album_id FROM photographer_recommendation_commands c WHERE c.id=?) ' +
            'AND revision=(SELECT c.expected_revision FROM photographer_recommendation_commands c WHERE c.id=?) AND ?=1',
        )
        .bind(
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          changed ? 1 : 0,
        );
      const result = this.resultInsert(
        commandId,
        beforeJson,
        afterJson,
        resultJson,
        changed,
      );
      const audit = this.auditInsert(commandId, changed);
      await this.db.batch([command, stateInsert, stateUpdate, result, audit]);
    } catch (error) {
      const raced = await this.findPrior(value.requestId);
      if (raced) return this.priorPolicy(raced, albumId, payloadJson);
      translateFailure(error);
    }
    return parseResult(
      resultJson,
      photographerRecommendationPolicyResultSchema,
    );
  }

  async setPhotoMetadata(photoIdInput: string, input: unknown) {
    await this.assertReady();
    const photoId = parseUuid(photoIdInput);
    const parsed = setPhotographerPhotoMetadataSchema.safeParse(input);
    if (!parsed.success) invalidInput();
    const value = parsed.data;
    const row = await this.loadPhoto(photoId, null);
    const scope = await this.loadAlbumScope(row.albumId);
    assertLive(scope);
    const prior = await this.findPrior(value.requestId);
    const payloadJson = this.photoPayload(value);
    if (prior)
      return this.priorPhoto(prior, photoId, value.versionId, payloadJson);
    if (
      row.versionId !== value.versionId ||
      row.headRevision !== value.expectedHeadRevision
    )
      throw new WorkspaceFailure(
        'PHOTOGRAPHER_METADATA_REVISION_CONFLICT',
        409,
      );
    const policy = await this.loadPolicy(row.albumId);
    const before = buildPhoto(row, policy);
    if (before.revision !== value.expectedRevision)
      throw new WorkspaceFailure(
        'PHOTOGRAPHER_METADATA_REVISION_CONFLICT',
        409,
      );
    const manualRating =
      value.rating.state === 'set'
        ? { state: 'set' as const, value: value.rating.value }
        : { state: value.rating.state, value: null };
    const manualLabel =
      value.label.state === 'set'
        ? { state: 'set' as const, value: value.label.value }
        : { state: value.label.state, value: null };
    const changed =
      before.rating.manual.state !== manualRating.state ||
      before.rating.manual.value !== manualRating.value ||
      before.label.manual.state !== manualLabel.state ||
      before.label.manual.value !== manualLabel.value ||
      before.decision.manual !== value.decision;
    const next = this.derivePhoto(
      {
        ...before,
        revision: before.revision + (changed ? 1 : 0),
        rating: { ...before.rating, manual: manualRating },
        label: { ...before.label, manual: manualLabel },
        decision: {
          manual: value.decision,
          recommended: false,
          source: 'none',
        },
      },
      policy,
    );
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(next);
    const commandId = crypto.randomUUID().toLowerCase();
    const resultJson = JSON.stringify({
      photo: next,
      changed,
      eventId: changed ? commandId : null,
    });
    const now = Date.now();
    try {
      const command = this.db
        .prepare(
          'INSERT INTO photographer_recommendation_commands(' +
            'id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,version_id,' +
            'expected_revision,expected_head_revision,rating_state,rating_value,label_state,label_value,decision,' +
            'payload_json,before_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          commandId,
          this.actorId,
          this.sessionId,
          value.requestId,
          'photo.photographer_metadata.set',
          row.workspaceId,
          row.projectId,
          row.albumId,
          photoId,
          value.versionId,
          value.expectedRevision,
          value.expectedHeadRevision,
          value.rating.state,
          value.rating.state === 'set' ? value.rating.value : null,
          value.label.state,
          value.label.state === 'set' ? value.label.value : null,
          value.decision,
          payloadJson,
          beforeJson,
          now,
        );
      const stateInsert = this.db
        .prepare(
          'INSERT INTO photographer_photo_metadata(' +
            'photo_id,version_id,workspace_id,project_id,album_id,rating_state,rating_value,' +
            'label_state,label_value,decision,revision,last_command_id) ' +
            'SELECT c.photo_id,c.version_id,c.workspace_id,c.project_id,c.album_id,c.rating_state,c.rating_value,' +
            'c.label_state,c.label_value,c.decision,c.expected_revision+1,c.id ' +
            'FROM photographer_recommendation_commands c WHERE c.id=? AND ?=1 ' +
            'AND NOT EXISTS(SELECT 1 FROM photographer_photo_metadata m WHERE m.photo_id=c.photo_id AND m.version_id=c.version_id)',
        )
        .bind(commandId, changed ? 1 : 0);
      const stateUpdate = this.db
        .prepare(
          'UPDATE photographer_photo_metadata SET ' +
            'rating_state=(SELECT c.rating_state FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'rating_value=(SELECT c.rating_value FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'label_state=(SELECT c.label_state FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'label_value=(SELECT c.label_value FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'decision=(SELECT c.decision FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'revision=(SELECT c.expected_revision+1 FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'last_command_id=? WHERE photo_id=(SELECT c.photo_id FROM photographer_recommendation_commands c WHERE c.id=?) ' +
            'AND version_id=(SELECT c.version_id FROM photographer_recommendation_commands c WHERE c.id=?) ' +
            'AND revision=(SELECT c.expected_revision FROM photographer_recommendation_commands c WHERE c.id=?) AND ?=1',
        )
        .bind(
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          changed ? 1 : 0,
        );
      await this.db.batch([
        command,
        stateInsert,
        stateUpdate,
        this.resultInsert(
          commandId,
          beforeJson,
          afterJson,
          resultJson,
          changed,
        ),
        this.auditInsert(commandId, changed),
      ]);
    } catch (error) {
      const raced = await this.findPrior(value.requestId);
      if (raced)
        return this.priorPhoto(raced, photoId, value.versionId, payloadJson);
      translateFailure(error);
    }
    return parseResult(resultJson, setPhotographerPhotoMetadataResultSchema);
  }

  async importFromVerifiedSource(input: unknown) {
    await this.assertReady();
    const parsed = importPhotographerMetadataRequestSchema.safeParse(input);
    if (!parsed.success) invalidInput();
    const value: ImportPhotographerMetadataRequest = parsed.data;
    this.assertMetadataMime(value);
    const scope = await this.loadAlbumScope(value.albumId);
    assertLive(scope);
    if (
      scope.workspaceId !== value.workspaceId ||
      scope.projectId !== value.projectId
    )
      throw new WorkspaceFailure('NOT_FOUND', 404);
    const payloadJson = JSON.stringify({
      requestId: value.requestId,
      expectedRevision: value.expectedRevision,
      workspaceId: value.workspaceId,
      projectId: value.projectId,
      albumId: value.albumId,
      photoId: value.photoId,
      versionId: value.versionId,
      assetId: value.assetId,
      sourceSha256: value.sourceSha256,
      sourceMime: value.sourceMime,
      metadata: value.metadata,
    });
    const prior = await this.findPrior(value.requestId);
    if (prior)
      return this.priorImport(
        prior,
        value.albumId,
        value.photoId,
        value.versionId,
        payloadJson,
      );
    if (!(await this.loadVerifiedSource(value)))
      throw new WorkspaceFailure('PHOTOGRAPHER_METADATA_SOURCE_CONFLICT', 409);

    const row = await this.loadPhoto(value.photoId, value.versionId);
    const policy = await this.loadPolicy(value.albumId);
    const before = buildPhoto(row, policy);
    if (before.revision !== value.expectedRevision)
      throw new WorkspaceFailure(
        'PHOTOGRAPHER_METADATA_REVISION_CONFLICT',
        409,
      );
    const metadataJson = JSON.stringify(value.metadata);
    const existingSource = before.source;
    const sourceMatches =
      existingSource !== null &&
      existingSource.assetId === value.assetId &&
      existingSource.sha256 === value.sourceSha256 &&
      existingSource.mime === value.sourceMime;
    const changed = !sourceMatches || row.importedMetadataJson !== metadataJson;
    const now = Date.now();
    const after = changed
      ? this.derivePhoto(
          {
            ...before,
            revision: before.revision + (changed ? 1 : 0),
            source: {
              assetId: value.assetId,
              sha256: value.sourceSha256,
              mime: value.sourceMime,
              importedAt: new Date(now).toISOString(),
            },
            rating: {
              ...before.rating,
              imported: this.importedRating(value.metadata),
            },
            label: {
              ...before.label,
              imported: this.importedLabel(value.metadata),
            },
          },
          policy,
        )
      : before;
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    const commandId = crypto.randomUUID().toLowerCase();
    const resultJson = JSON.stringify({
      photo: after,
      changed,
      eventId: changed ? commandId : null,
    });
    try {
      const command = this.db
        .prepare(
          'INSERT INTO photographer_recommendation_commands(' +
            'id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,version_id,' +
            'expected_revision,source_asset_id,source_sha256,source_mime,imported_metadata_json,payload_json,' +
            'before_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          commandId,
          this.actorId,
          this.sessionId,
          value.requestId,
          'photo.photographer_metadata.import',
          value.workspaceId,
          value.projectId,
          value.albumId,
          value.photoId,
          value.versionId,
          value.expectedRevision,
          value.assetId,
          value.sourceSha256,
          value.sourceMime,
          metadataJson,
          payloadJson,
          beforeJson,
          now,
        );
      const stateInsert = this.db
        .prepare(
          'INSERT INTO photographer_photo_metadata(' +
            'photo_id,version_id,workspace_id,project_id,album_id,source_asset_id,source_sha256,source_mime,' +
            'imported_metadata_json,imported_at_ms,rating_state,label_state,decision,revision,last_command_id) ' +
            'SELECT c.photo_id,c.version_id,c.workspace_id,c.project_id,c.album_id,c.source_asset_id,' +
            'c.source_sha256,c.source_mime,c.imported_metadata_json,c.created_at_ms,' +
            "'inherit','inherit','inherit',c.expected_revision+1,c.id " +
            'FROM photographer_recommendation_commands c WHERE c.id=? AND ?=1 ' +
            'AND NOT EXISTS(SELECT 1 FROM photographer_photo_metadata m WHERE m.photo_id=c.photo_id AND m.version_id=c.version_id)',
        )
        .bind(commandId, changed ? 1 : 0);
      const stateUpdate = this.db
        .prepare(
          'UPDATE photographer_photo_metadata SET ' +
            'source_asset_id=(SELECT c.source_asset_id FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'source_sha256=(SELECT c.source_sha256 FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'source_mime=(SELECT c.source_mime FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'imported_metadata_json=(SELECT c.imported_metadata_json FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'imported_at_ms=(SELECT c.created_at_ms FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'revision=(SELECT c.expected_revision+1 FROM photographer_recommendation_commands c WHERE c.id=?),' +
            'last_command_id=? WHERE photo_id=(SELECT c.photo_id FROM photographer_recommendation_commands c WHERE c.id=?) ' +
            'AND version_id=(SELECT c.version_id FROM photographer_recommendation_commands c WHERE c.id=?) ' +
            'AND revision=(SELECT c.expected_revision FROM photographer_recommendation_commands c WHERE c.id=?) AND ?=1',
        )
        .bind(
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          commandId,
          changed ? 1 : 0,
        );
      await this.db.batch([
        command,
        stateInsert,
        stateUpdate,
        this.resultInsert(
          commandId,
          beforeJson,
          afterJson,
          resultJson,
          changed,
        ),
        this.auditInsert(commandId, changed),
      ]);
    } catch (error) {
      const raced = await this.findPrior(value.requestId);
      if (raced)
        return this.priorImport(
          raced,
          value.albumId,
          value.photoId,
          value.versionId,
          payloadJson,
        );
      translateFailure(error);
    }
    return parseResult(resultJson, importPhotographerMetadataResultSchema);
  }

  private async assertReady() {
    if (!this.enabled)
      throw new WorkspaceFailure('PHOTOGRAPHER_RECOMMENDATIONS_DISABLED', 409);
    if (!(await this.capability())) unavailable();
  }

  private async assertCurrentOwner() {
    let row: { authorized: number } | null;
    try {
      row = await this.db
        .prepare(ownerCheckSql)
        .bind(this.sessionId, this.actorId)
        .first();
    } catch {
      unavailable();
    }
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async loadAlbumScope(albumId: string): Promise<AlbumScope> {
    let row: AlbumScope | null;
    try {
      row = await this.db
        .prepare(albumScopeSql)
        .bind(this.sessionId, this.actorId, albumId)
        .first<AlbumScope>();
    } catch (error) {
      translateFailure(error);
    }
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return row;
  }

  private async loadPolicy(
    albumId: string,
  ): Promise<PhotographerRecommendationPolicy> {
    let row: PolicyRow | null;
    try {
      row = await this.db
        .prepare(policySelectSql)
        .bind(albumId)
        .first<PolicyRow>();
    } catch (error) {
      translateFailure(error);
    }
    return asPolicy(row, albumId);
  }

  private async loadPhoto(
    photoId: string,
    versionId: string | null,
  ): Promise<PhotoRow> {
    const sql =
      photoSelectPrefix +
      (versionId === null
        ? ' AND ph.id=? AND v.id=h.version_id'
        : ' AND ph.id=? AND v.id=?');
    let row: PhotoRow | null;
    try {
      row = await this.db
        .prepare(sql)
        .bind(
          this.actorId,
          this.sessionId,
          photoId,
          ...(versionId === null ? [] : [versionId]),
        )
        .first<PhotoRow>();
    } catch (error) {
      translateFailure(error);
    }
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return row;
  }

  private async findPrior(requestId: string): Promise<CommandResultRow | null> {
    try {
      return await this.db
        .prepare(
          'SELECT c.operation,c.payload_json AS payloadJson,c.album_id AS albumId,' +
            'c.photo_id AS photoId,c.version_id AS versionId,r.result_json AS resultJson ' +
            'FROM photographer_recommendation_commands c ' +
            'LEFT JOIN photographer_recommendation_results r ON r.command_id=c.id ' +
            'WHERE c.actor_id=? AND lower(c.request_id)=lower(?)',
        )
        .bind(this.actorId, requestId)
        .first<CommandResultRow>();
    } catch (error) {
      translateFailure(error);
    }
  }

  private priorPolicy(
    prior: CommandResultRow,
    albumId: string,
    payload: string,
  ) {
    if (
      prior.operation !== 'album.photographer_recommendations.set' ||
      prior.albumId !== albumId ||
      prior.payloadJson !== payload
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    return parseResult(
      prior.resultJson,
      photographerRecommendationPolicyResultSchema,
    );
  }
  private priorPhoto(
    prior: CommandResultRow,
    photoId: string,
    versionId: string,
    payload: string,
  ) {
    if (
      prior.operation !== 'photo.photographer_metadata.set' ||
      prior.photoId !== photoId ||
      prior.versionId !== versionId ||
      prior.payloadJson !== payload
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    return parseResult(
      prior.resultJson,
      setPhotographerPhotoMetadataResultSchema,
    );
  }
  private priorImport(
    prior: CommandResultRow,
    albumId: string,
    photoId: string,
    versionId: string,
    payload: string,
  ) {
    if (
      prior.operation !== 'photo.photographer_metadata.import' ||
      prior.albumId !== albumId ||
      prior.photoId !== photoId ||
      prior.versionId !== versionId ||
      prior.payloadJson !== payload
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    return parseResult(
      prior.resultJson,
      importPhotographerMetadataResultSchema,
    );
  }

  private async loadVerifiedSource(
    value: ImportPhotographerMetadataRequest,
  ): Promise<boolean> {
    try {
      const row = await this.db
        .prepare(
          'SELECT 1 AS verified FROM workspaces w ' +
            'JOIN projects p ON p.id=? AND p.workspace_id=w.id ' +
            'JOIN albums a ON a.id=? AND a.project_id=p.id AND a.workspace_id=w.id ' +
            'JOIN photos ph ON ph.id=? AND ph.album_id=a.id AND ph.project_id=p.id AND ph.workspace_id=w.id ' +
            'JOIN photo_versions v ON v.id=? AND v.photo_id=ph.id AND v.workspace_id=w.id ' +
            'JOIN photo_assets asset ON asset.id=? AND asset.version_id=v.id AND asset.photo_id=ph.id ' +
            "AND asset.workspace_id=w.id AND asset.asset_kind='original' AND asset.state='private' " +
            'AND asset.checksum_sha256=? AND asset.mime=? AND v.source_hash_sha256=asset.checksum_sha256 ' +
            'AND v.mime=asset.mime JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 ' +
            "JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 " +
            "WHERE w.id=? AND w.owner_user_id=? AND p.status NOT IN('archived','deleting','deleted') " +
            "AND a.state NOT IN('archived','deleting','deleted')",
        )
        .bind(
          value.projectId,
          value.albumId,
          value.photoId,
          value.versionId,
          value.assetId,
          value.sourceSha256,
          value.sourceMime,
          this.sessionId,
          value.workspaceId,
          this.actorId,
        )
        .first<{ verified: number }>();
      return row?.verified === 1;
    } catch (error) {
      translateFailure(error);
    }
  }

  private assertMetadataMime(value: ImportPhotographerMetadataRequest) {
    const format =
      value.sourceMime === 'image/jpeg'
        ? 'jpeg'
        : value.sourceMime === 'image/png'
          ? 'png'
          : 'webp';
    if (
      value.metadata.status === 'supported' &&
      value.metadata.format !== format
    )
      invalidInput();
  }

  private photoPayload(
    value: z.infer<typeof setPhotographerPhotoMetadataSchema>,
  ) {
    return JSON.stringify({
      requestId: value.requestId,
      expectedRevision: value.expectedRevision,
      expectedHeadRevision: value.expectedHeadRevision,
      versionId: value.versionId,
      ratingState: value.rating.state,
      ratingValue: value.rating.state === 'set' ? value.rating.value : null,
      labelState: value.label.state,
      labelValue: value.label.state === 'set' ? value.label.value : null,
      decision: value.decision,
    });
  }

  private importedRating(value: PhotographerMetadataResult) {
    return value.status === 'unsupported_format'
      ? { state: 'unsupported_format' as const }
      : { state: 'imported' as const, field: value.rating };
  }
  private importedLabel(value: PhotographerMetadataResult) {
    return value.status === 'unsupported_format'
      ? { state: 'unsupported_format' as const }
      : { state: 'imported' as const, field: value.label };
  }

  private derivePhoto(
    input: PhotographerPhotoRecommendation,
    policy: PhotographerRecommendationPolicy,
  ): PhotographerPhotoRecommendation {
    const rating =
      input.rating.manual.state === 'set'
        ? input.rating.manual.value
        : input.rating.manual.state === 'clear'
          ? null
          : input.rating.imported.state === 'imported' &&
              input.rating.imported.field.status === 'value'
            ? input.rating.imported.field.value
            : null;
    const label =
      input.label.manual.state === 'set'
        ? input.label.manual.value
        : input.label.manual.state === 'clear'
          ? null
          : input.label.imported.state === 'imported' &&
              input.label.imported.field.status === 'value'
            ? input.label.imported.field.value
            : null;
    const matches =
      (policy.minRating !== null &&
        rating !== null &&
        rating >= policy.minRating) ||
      (policy.allowedLabels.length > 0 &&
        label !== null &&
        policy.allowedLabels.includes(label));
    const manual = input.decision.manual;
    const decision =
      manual === 'recommend'
        ? { manual, recommended: true, source: 'manual' as const }
        : manual === 'exclude'
          ? { manual, recommended: false, source: 'manual' as const }
          : matches
            ? { manual, recommended: true, source: 'criteria' as const }
            : { manual, recommended: false, source: 'none' as const };
    return {
      ...input,
      rating: { ...input.rating, effective: rating },
      label: { ...input.label, effective: label },
      decision,
    };
  }

  private resultInsert(
    commandId: string,
    beforeJson: string,
    afterJson: string,
    resultJson: string,
    changed: boolean,
  ) {
    return this.db
      .prepare(
        'INSERT INTO photographer_recommendation_results(' +
          'command_id,before_json,after_json,result_json,changed,event_id,occurred_at_utc) ' +
          'SELECT c.id,?,?,?, ?,CASE WHEN ?=1 THEN c.id ELSE NULL END,' +
          "strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch') " +
          'FROM photographer_recommendation_commands c WHERE c.id=?',
      )
      .bind(
        beforeJson,
        afterJson,
        resultJson,
        changed ? 1 : 0,
        changed ? 1 : 0,
        commandId,
      );
  }

  private auditInsert(commandId: string, changed: boolean) {
    return this.db
      .prepare(
        'INSERT INTO audit_events(' +
          'event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,' +
          'action,before_json,after_json,request_id,occurred_at_utc) ' +
          "SELECT r.event_id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,c.album_id," +
          'c.photo_id,c.version_id,CASE c.operation ' +
          "WHEN 'album.photographer_recommendations.set' THEN 'album.photographer_recommendations.changed' " +
          "WHEN 'photo.photographer_metadata.set' THEN 'photo.photographer_metadata.changed' " +
          "ELSE 'photo.photographer_metadata.imported' END,r.before_json,r.after_json,c.request_id,r.occurred_at_utc " +
          'FROM photographer_recommendation_commands c ' +
          'JOIN photographer_recommendation_results r ON r.command_id=c.id ' +
          'WHERE c.id=? AND r.event_id IS NOT NULL AND ?=1',
      )
      .bind(commandId, changed ? 1 : 0);
  }
}

export async function readPhotographerRecommendationBadges(
  db: D1Database,
  albumIdInput: string,
  photos: readonly { id: string; versionId: string }[],
): Promise<Set<string>> {
  const empty = () => new Set<string>();
  const albumId = uuidSchema.safeParse(albumIdInput);
  if (!albumId.success || photos.length === 0 || photos.length > 24)
    return empty();
  const pairs: Array<{ id: string; versionId: string }> = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    const id = uuidSchema.safeParse(photo?.id);
    const versionId = uuidSchema.safeParse(photo?.versionId);
    if (!id.success || !versionId.success) return empty();
    const normalizedId = id.data.toLowerCase();
    const normalizedVersionId = versionId.data.toLowerCase();
    if (seen.has(normalizedId)) return empty();
    seen.add(normalizedId);
    pairs.push({ id: normalizedId, versionId: normalizedVersionId });
  }
  try {
    const policyRow = await db
      .prepare(
        'SELECT visible AS visibleValue,min_rating AS minRating,' +
          'allowed_labels_json AS allowedLabelsJson,revision ' +
          'FROM album_photographer_recommendation_policy WHERE album_id=?',
      )
      .bind(albumId.data.toLowerCase())
      .first<PolicyRow>();
    if (!policyRow || policyRow.visibleValue !== 1) return empty();
    const policy = asPolicy(policyRow, albumId.data.toLowerCase());
    const predicates = pairs.map(() => '(ph.id=? AND v.id=?)').join(' OR ');
    const values = pairs.flatMap((pair) => [pair.id, pair.versionId]);
    const query = [
      'SELECT ph.id AS photoId,ph.workspace_id AS workspaceId,',
      'ph.project_id AS projectId,ph.album_id AS albumId,',
      'v.id AS versionId,v.version_no AS versionNo,',
      'h.version_id AS headVersionId,h.revision AS headRevision,m.revision,',
      'm.source_asset_id AS sourceAssetId,m.source_sha256 AS sourceSha256,',
      'm.source_mime AS sourceMime,m.imported_metadata_json AS importedMetadataJson,',
      'm.imported_at_ms AS importedAtMs,m.rating_state AS ratingState,',
      'm.rating_value AS ratingValue,m.label_state AS labelState,',
      'm.label_value AS labelValue,m.decision',
      'FROM photos ph JOIN albums a ON a.id=ph.album_id AND a.workspace_id=ph.workspace_id',
      "AND a.project_id=ph.project_id AND a.state='active'",
      'JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id',
      "AND p.status NOT IN('archived','deleting','deleted')",
      'JOIN photo_version_heads h ON h.photo_id=ph.id AND h.workspace_id=ph.workspace_id',
      'JOIN photo_versions v ON v.id=h.version_id AND v.photo_id=ph.id',
      'AND v.workspace_id=ph.workspace_id',
      'LEFT JOIN photographer_photo_metadata m ON m.photo_id=ph.id AND m.version_id=v.id',
      'WHERE ph.album_id=? AND (' + predicates + ')',
    ].join(' ');
    const result = await db
      .prepare(query)
      .bind(albumId.data.toLowerCase(), ...values)
      .all<PhotoRow>();
    const recommended = new Set<string>();
    for (const row of result.results) {
      const item = buildPhoto(row, policy);
      if (item.decision.recommended) recommended.add(item.photoId);
    }
    return recommended;
  } catch {
    // A missing 0059 schema, malformed historical row, or query failure hides
    // recommendation badges without weakening the already-authorized gallery.
    return empty();
  }
}
